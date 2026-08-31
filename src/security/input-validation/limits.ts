import { createValidationError, VeryfrontError } from "./errors.ts";
import { DEFAULT_LIMITS, type RequestLimits } from "./types.ts";

const REQUEST_BODY_TOO_LARGE_DETAIL = "Request body exceeds size limit";
const BODY_COALESCE_BLOCK_BYTES = 64 * 1024;
const BODY_READ_YIELD_CHUNKS = 256;
const MAX_CONSECUTIVE_EMPTY_BODY_CHUNKS = 4_096;
const textEncoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const REQUEST_LIMIT_KEYS = new Set([
  "maxBodySize",
  "maxUrlLength",
  "maxHeaderSize",
  "maxFileSize",
]);
const READ_BODY_OPTION_KEYS = new Set(["signal"]);
const IntrinsicReflectApply = Reflect.apply;
const NativeRequest = Request;
const NativeHeaders = Headers;
const NativeReadableStream = ReadableStream;
const NativeReadableStreamDefaultReader = ReadableStreamDefaultReader;
const RequestBodyGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "body")?.get;
const RequestBodyUsedGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "bodyUsed")
  ?.get;
const RequestHeadersGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")?.get;
const RequestSignalGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "signal")?.get;
const RequestUrlGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "url")?.get;
const HeadersGet = NativeHeaders.prototype.get;
const ReadableStreamCancel = NativeReadableStream.prototype.cancel;
const ReadableStreamGetReader = NativeReadableStream.prototype.getReader;
const ReadableStreamLockedGet = Object.getOwnPropertyDescriptor(
  NativeReadableStream.prototype,
  "locked",
)?.get;
const ReaderCancel = NativeReadableStreamDefaultReader.prototype.cancel;
const ReaderRead = NativeReadableStreamDefaultReader.prototype.read;
const ReaderReleaseLock = NativeReadableStreamDefaultReader.prototype.releaseLock;

export interface ReadBodyLimitOptions {
  /** Abort the read and cancel the underlying stream when the caller deadline expires. */
  signal?: AbortSignal;
}

function readNativeRequestValue<T>(
  request: Request,
  getter: ((this: Request) => T) | undefined,
  name: string,
): T {
  if (!getter) throw new TypeError(`Request accessor ${name} is unavailable`);
  return IntrinsicReflectApply(getter, request, []);
}

export function getNativeRequestBody(request: Request): ReadableStream<Uint8Array> | null {
  return readNativeRequestValue(request, RequestBodyGet, "body");
}

function getNativeRequestBodyUsed(request: Request): boolean {
  return readNativeRequestValue(request, RequestBodyUsedGet, "bodyUsed");
}

function getNativeRequestHeaders(request: Request): Headers {
  return readNativeRequestValue(request, RequestHeadersGet, "headers");
}

function getNativeRequestSignal(request: Request): AbortSignal {
  return readNativeRequestValue(request, RequestSignalGet, "signal");
}

function getNativeRequestUrl(request: Request): string {
  return readNativeRequestValue(request, RequestUrlGet, "url");
}

function getRequestUrlForValidation(request: Request): string {
  try {
    return getNativeRequestUrl(request);
  } catch {
    // Keep the lightweight request-shaped fixture accepted by this legacy
    // validation helper. Credential-bearing body reads remain native-only.
    return request.url;
  }
}

function getRequestHeadersForValidation(request: Request): Headers {
  try {
    return getNativeRequestHeaders(request);
  } catch {
    return request.headers;
  }
}

function getNativeHeader(headers: Headers, name: string): string | null {
  return IntrinsicReflectApply(HeadersGet, headers, [name]);
}

function getNativeReader(
  stream: ReadableStream<Uint8Array>,
): ReadableStreamDefaultReader<Uint8Array> {
  return IntrinsicReflectApply(ReadableStreamGetReader, stream, []) as ReadableStreamDefaultReader<
    Uint8Array
  >;
}

function requireByteLimit(name: string, value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function snapshotOwnOptions(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  let prototype: object | null;
  let keys: Array<string | symbol>;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} could not be inspected safely`);
  }
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError(
        `${label} contains an unsupported ${typeof key === "string" ? `option: ${key}` : "symbol"}`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label}.${key} could not be inspected safely`);
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/** Resolve and validate every request-boundary limit before it is used. */
export function resolveRequestLimits(
  limits: RequestLimits = {},
): Required<RequestLimits> {
  const snapshot = snapshotOwnOptions(limits, "Request limits", REQUEST_LIMIT_KEYS);
  return {
    maxBodySize: requireByteLimit(
      "Request body size limit",
      snapshot.maxBodySize === undefined ? DEFAULT_LIMITS.maxBodySize : snapshot.maxBodySize,
    ),
    maxUrlLength: requireByteLimit(
      "Request URL size limit",
      snapshot.maxUrlLength === undefined ? DEFAULT_LIMITS.maxUrlLength : snapshot.maxUrlLength,
    ),
    maxHeaderSize: requireByteLimit(
      "Request header size limit",
      snapshot.maxHeaderSize === undefined ? DEFAULT_LIMITS.maxHeaderSize : snapshot.maxHeaderSize,
    ),
    maxFileSize: requireByteLimit(
      "Request file size limit",
      snapshot.maxFileSize === undefined ? DEFAULT_LIMITS.maxFileSize : snapshot.maxFileSize,
    ),
  };
}

export function isRequestBodyTooLargeError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError &&
    error.slug === "input-validation-failed" &&
    error.detail === REQUEST_BODY_TOO_LARGE_DETAIL;
}

export function validateRequestLimits(
  request: Request,
  limits: RequestLimits = {},
): Required<RequestLimits> {
  const resolved = resolveRequestLimits(limits);
  const { maxUrlLength, maxBodySize, maxHeaderSize } = resolved;

  validateUrlLength(getRequestUrlForValidation(request), maxUrlLength);
  validateContentLength(request, maxBodySize);
  validateHeaderSize(request, maxHeaderSize);
  return resolved;
}

function validateUrlLength(url: string, maxLength: number): void {
  const actualLength = textEncoder.encode(url).byteLength;
  if (actualLength <= maxLength) return;

  throw createValidationError("URL too long", {
    maxLength,
    actualLength,
  });
}

function validateContentLength(request: Request, maxSize: number): void {
  const contentLength = getNativeHeader(
    getRequestHeadersForValidation(request),
    "content-length",
  );
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

  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed)) {
    throw createValidationError("Invalid Content-Length header");
  }
  return parsed;
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
  if (!body) return;
  if (ReadableStreamLockedGet && IntrinsicReflectApply(ReadableStreamLockedGet, body, [])) return;
  if (!ReadableStreamCancel) return;
  try {
    void IntrinsicReflectApply(ReadableStreamCancel, body, [reason]).catch(() => undefined);
  } catch {
    // Cancellation is best effort. A hostile or broken stream must not keep
    // the caller waiting after the body has already been rejected.
  }
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  if (!ReaderCancel) return;
  try {
    void IntrinsicReflectApply(ReaderCancel, reader, [reason]).catch(() => undefined);
  } catch {
    // The rejection reason remains authoritative if cancellation itself fails.
  }
}

function yieldToTaskQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function validateHeaderSize(request: Request, maxSize: number): void {
  let headerSize = 0;

  for (const [key, value] of getRequestHeadersForValidation(request)) {
    headerSize += textEncoder.encode(key).byteLength +
      textEncoder.encode(value).byteLength +
      4; // ": " and "\r\n"
    if (headerSize > maxSize) break;
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
  const contentType = getNativeHeader(
    getRequestHeadersForValidation(request),
    "content-type",
  );
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
  return fatalUtf8Decoder.decode(bytes);
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
  const optionSnapshot = snapshotOwnOptions(
    options,
    "Request body read options",
    READ_BODY_OPTION_KEYS,
  );
  if (optionSnapshot.signal !== undefined && !(optionSnapshot.signal instanceof AbortSignal)) {
    throw new TypeError("Request body read options.signal must be an AbortSignal");
  }
  requireByteLimit("Request body size limit", maxSize);
  if (getNativeRequestBodyUsed(request)) {
    throw createValidationError("Request body has already been consumed");
  }

  const requestHeaders = getNativeRequestHeaders(request);
  const requestBody = getNativeRequestBody(request);
  const requestSignal = getNativeRequestSignal(request);
  const contentLength = getNativeHeader(requestHeaders, "content-length");
  if (contentLength !== null) {
    let declaredSize: number;
    try {
      declaredSize = parseContentLength(contentLength);
    } catch (error) {
      cancelBody(requestBody, error);
      throw error;
    }
    if (declaredSize > maxSize) {
      const error = createBodyTooLargeError(maxSize, declaredSize, "content-length");
      cancelBody(requestBody, error);
      throw error;
    }
  }

  const reader = requestBody ? getNativeReader(requestBody) : null;
  if (!reader) throw createValidationError("No request body");

  const blocks: Uint8Array[] = [];
  let currentBlock: Uint8Array | null = null;
  let currentBlockLength = 0;
  let allocatedCapacity = 0;
  let totalSize = 0;
  let chunksSinceYield = 0;
  let consecutiveEmptyChunks = 0;
  let abortReason: unknown;
  const optionSignal = optionSnapshot.signal as AbortSignal | undefined;
  const signal = optionSignal && optionSignal !== requestSignal
    ? AbortSignal.any([requestSignal, optionSignal])
    : requestSignal;
  const abort = (): void => {
    abortReason = signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
    cancelReader(reader, abortReason);
  };

  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      if (abortReason !== undefined) throw abortReason;
      const { done, value } = await IntrinsicReflectApply(ReaderRead, reader, []);
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
    IntrinsicReflectApply(ReaderReleaseLock, reader, []);
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
