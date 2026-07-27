import { createValidationError, VeryfrontError } from "./errors.ts";
import { DEFAULT_LIMITS, type RequestLimits } from "./types.ts";

const REQUEST_BODY_TOO_LARGE_DETAIL = "Request body exceeds size limit";
const BODY_COALESCE_BLOCK_BYTES = 64 * 1024;
const BODY_READ_YIELD_CHUNKS = 256;
const MAX_CONSECUTIVE_EMPTY_BODY_CHUNKS = 4_096;

export interface ReadBodyLimitOptions {
  /** Abort the read and cancel the underlying stream when the caller deadline expires. */
  signal?: AbortSignal;
}

export function isRequestBodyTooLargeError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError &&
    error.slug === "input-validation-failed" &&
    error.detail === REQUEST_BODY_TOO_LARGE_DETAIL;
}

export function validateRequestLimits(
  request: Request,
  limits: RequestLimits = {},
): void {
  const { maxUrlLength, maxBodySize, maxHeaderSize } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };

  validateUrlLength(request.url, maxUrlLength);
  validateContentLength(request, maxBodySize);
  validateHeaderSize(request, maxHeaderSize);
}

function validateUrlLength(url: string, maxLength: number): void {
  if (url.length <= maxLength) return;

  throw createValidationError("URL too long", {
    maxLength,
    actualLength: url.length,
  });
}

function validateContentLength(request: Request, maxSize: number): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return;

  const size = parseContentLength(contentLength);
  if (size <= maxSize) return;

  throw createValidationError("Request body too large", {
    maxSize,
    actualSize: size,
  });
}

function parseContentLength(contentLength: string): number {
  if (!/^\d+$/.test(contentLength)) {
    throw createValidationError("Invalid Content-Length header");
  }

  return Number(contentLength);
}

function requireBodySizeLimit(maxSize: number): number {
  if (!Number.isSafeInteger(maxSize) || maxSize < 0) {
    throw new RangeError("Request body size limit must be a non-negative safe integer");
  }
  return maxSize;
}

function createBodyTooLargeError(
  maxSize: number,
  actualSize: number,
  source: "content-length" | "stream",
): VeryfrontError {
  return createValidationError(REQUEST_BODY_TOO_LARGE_DETAIL, {
    maxSize,
    actualSize,
    source,
    ...(source === "content-length" ? { contentLength: actualSize } : { bytesRead: actualSize }),
  });
}

function cancelBody(
  body: ReadableStream<Uint8Array> | null,
  reason: unknown,
): void {
  if (!body || body.locked) return;
  try {
    void body.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort. A hostile or broken stream must not keep
    // the caller waiting after the body has already been rejected.
  }
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // The rejection reason remains authoritative if cancellation itself fails.
  }
}

function yieldToTaskQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function validateHeaderSize(request: Request, maxSize: number): void {
  let headerSize = 0;

  for (const [key, value] of request.headers) {
    headerSize += key.length + value.length + 4; // ": " and "\r\n"
  }

  if (headerSize <= maxSize) return;

  throw createValidationError("Headers too large", {
    maxSize,
    actualSize: headerSize,
  });
}

export function validateContentType(request: Request, expected: string | string[]): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const label = allowed.join(" or ");
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    throw createValidationError(`Missing Content-Type header, expected ${label}`);
  }
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!allowed.includes(mediaType)) {
    throw createValidationError(`Invalid Content-Type: expected ${label}`, {
      expected: allowed,
      actual: contentType,
    });
  }
}

export async function readBodyWithLimit(
  request: Request,
  maxSize: number = DEFAULT_LIMITS.maxBodySize,
): Promise<string> {
  const bytes = await readBodyBytesWithLimit(request, maxSize);
  return new TextDecoder().decode(bytes);
}

/**
 * Read a request body without accepting more than the configured byte limit.
 *
 * Content-Length is an early rejection hint only. The streamed byte count is
 * always authoritative, which also bounds chunked and dishonest requests.
 * Tiny transport chunks are coalesced into fixed-size blocks so chunk metadata
 * cannot grow independently of the byte limit.
 */
export async function readBodyBytesWithLimit(
  request: Request,
  maxSize: number = DEFAULT_LIMITS.maxBodySize,
  options: ReadBodyLimitOptions = {},
): Promise<Uint8Array> {
  requireBodySizeLimit(maxSize);
  if (request.bodyUsed) {
    throw createValidationError("Request body has already been consumed");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    let declaredSize: number;
    try {
      declaredSize = parseContentLength(contentLength);
    } catch (error) {
      cancelBody(request.body, error);
      throw error;
    }
    if (declaredSize > maxSize) {
      const error = createBodyTooLargeError(maxSize, declaredSize, "content-length");
      cancelBody(request.body, error);
      throw error;
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw createValidationError("No request body");

  const blocks: Uint8Array[] = [];
  let currentBlock: Uint8Array | null = null;
  let currentBlockLength = 0;
  let allocatedCapacity = 0;
  let totalSize = 0;
  let chunksSinceYield = 0;
  let consecutiveEmptyChunks = 0;
  let abortReason: unknown;
  const signal = options.signal && options.signal !== request.signal
    ? AbortSignal.any([request.signal, options.signal])
    : request.signal;
  const abort = (): void => {
    abortReason = signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
    cancelReader(reader, abortReason);
  };

  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      if (abortReason !== undefined) throw abortReason;
      const { done, value } = await reader.read();
      if (abortReason !== undefined) throw abortReason;
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        const error = createValidationError(
          "Request body stream produced a non-byte chunk",
        );
        cancelReader(reader, error);
        throw error;
      }

      if (value.byteLength > maxSize - totalSize) {
        const actualSize = totalSize + value.byteLength;
        const error = createBodyTooLargeError(maxSize, actualSize, "stream");
        cancelReader(reader, error);
        throw error;
      }

      chunksSinceYield++;
      if (value.byteLength === 0) {
        consecutiveEmptyChunks++;
        if (consecutiveEmptyChunks > MAX_CONSECUTIVE_EMPTY_BODY_CHUNKS) {
          const error = createValidationError(
            "Request body stream made no progress",
            { consecutiveEmptyChunks },
          );
          cancelReader(reader, error);
          throw error;
        }
      } else {
        consecutiveEmptyChunks = 0;
      }

      // A synchronously produced stream can otherwise monopolize the
      // microtask queue and prevent its own abort/deadline timer from firing.
      if (chunksSinceYield >= BODY_READ_YIELD_CHUNKS) {
        chunksSinceYield = 0;
        await yieldToTaskQueue();
        if (abortReason !== undefined) throw abortReason;
      }

      if (value.byteLength === 0) continue;

      totalSize += value.byteLength;
      let valueOffset = 0;
      while (valueOffset < value.byteLength) {
        if (currentBlock === null) {
          const nextCapacity = Math.min(
            BODY_COALESCE_BLOCK_BYTES,
            maxSize - allocatedCapacity,
          );
          currentBlock = new Uint8Array(nextCapacity);
          allocatedCapacity += nextCapacity;
        }

        const copyLength = Math.min(
          currentBlock.byteLength - currentBlockLength,
          value.byteLength - valueOffset,
        );
        currentBlock.set(
          value.subarray(valueOffset, valueOffset + copyLength),
          currentBlockLength,
        );
        currentBlockLength += copyLength;
        valueOffset += copyLength;

        if (currentBlockLength === currentBlock.byteLength) {
          blocks.push(currentBlock);
          currentBlock = null;
          currentBlockLength = 0;
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalSize);
  let offset = 0;

  for (const block of blocks) {
    combined.set(block, offset);
    offset += block.byteLength;
  }
  if (currentBlock !== null && currentBlockLength > 0) {
    combined.set(currentBlock.subarray(0, currentBlockLength), offset);
  }

  return combined;
}
