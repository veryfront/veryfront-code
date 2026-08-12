import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";

const MAX_RESPONSE_BODY_CHUNKS = 65_536;
const INITIAL_RESPONSE_BUFFER_BYTES = 8 * 1024;
const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

export type ProxyResponseBodyFailure =
  | "invalid-content-length"
  | "invalid-utf8"
  | "too-large"
  | "too-many-chunks";

export class ProxyResponseBodyError extends Error {
  constructor(readonly failure: ProxyResponseBodyFailure) {
    super(`Invalid proxy upstream response body: ${failure}`);
    this.name = "ProxyResponseBodyError";
  }
}

/**
 * Discard a response while retaining producer ownership until cancellation
 * itself settles. Admission-controlled producers must await this operation
 * before releasing capacity.
 */
export async function settleProxyResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The boundary error remains authoritative, but the cancellation attempt
    // has reached a terminal state so producer ownership may now be released.
  }
}

function validateMaximumBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Proxy response byte limit must be a non-negative safe integer");
  }
}

async function declaredResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<number | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) return null;

  const normalized = contentLength.trim();
  if (!/^\d+$/.test(normalized)) {
    await settleProxyResponseBody(response);
    throw new ProxyResponseBodyError("invalid-content-length");
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > maxBytes) {
    await settleProxyResponseBody(response);
    throw new ProxyResponseBodyError("too-large");
  }
  return parsed;
}

function nextCapacity(current: number, required: number, maximum: number): number {
  let capacity = Math.max(1, current);
  while (capacity < required) {
    capacity = Math.min(maximum, capacity * 2);
    if (capacity < required && capacity === maximum) {
      throw new ProxyResponseBodyError("too-large");
    }
  }
  return capacity;
}

/**
 * Read one upstream response into a bounded contiguous byte snapshot.
 *
 * Both declared and streamed sizes are enforced. Chunk count is bounded
 * separately so an adversarial one-byte/zero-byte stream cannot turn a modest
 * byte limit into unbounded scheduling and allocation work.
 */
export async function readProxyResponseBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  validateMaximumBytes(maxBytes);
  if (signal?.aborted) {
    await settleProxyResponseBody(response);
    throw abortReason(signal);
  }
  const declaredBytes = await declaredResponseBytes(response, maxBytes);
  if (!response.body) return new Uint8Array();

  let bytes = new Uint8Array(
    Math.min(
      maxBytes,
      declaredBytes ?? Math.min(INITIAL_RESPONSE_BUFFER_BYTES, maxBytes),
    ),
  );
  const reader = response.body.getReader();
  let chunkCount = 0;
  let totalBytes = 0;
  let abortFailure: Error | undefined;
  let cancellation: Promise<void> | undefined;
  const cancelReader = (reason: unknown): Promise<void> => {
    try {
      return reader.cancel(reason).then(
        () => {},
        () => {
          // Preserve the boundary error after cancellation reaches a terminal
          // state. A pending read is still awaited by the producer below.
        },
      );
    } catch {
      return Promise.resolve();
    }
  };
  const onAbort = (): void => {
    abortFailure ??= abortReason(signal!);
    cancellation ??= cancelReader(abortFailure);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal?.aborted) onAbort();
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array<ArrayBufferLike>>;
      try {
        result = await reader.read();
      } catch (error) {
        if (abortFailure) {
          await cancellation;
          throw abortFailure;
        }
        throw error;
      }
      if (abortFailure) {
        await cancellation;
        throw abortFailure;
      }
      const { done, value } = result;
      if (done) break;
      chunkCount++;
      if (chunkCount > MAX_RESPONSE_BODY_CHUNKS) {
        await cancelReader("Proxy upstream response emitted too many chunks");
        throw new ProxyResponseBodyError("too-many-chunks");
      }
      if (!value || value.byteLength === 0) continue;

      const requiredBytes = totalBytes + value.byteLength;
      if (
        !Number.isSafeInteger(requiredBytes) ||
        requiredBytes > maxBytes
      ) {
        await cancelReader("Proxy upstream response exceeds the byte limit");
        throw new ProxyResponseBodyError("too-large");
      }

      if (requiredBytes > bytes.byteLength) {
        const expanded = new Uint8Array(
          nextCapacity(bytes.byteLength, requiredBytes, maxBytes),
        );
        expanded.set(bytes.subarray(0, totalBytes));
        bytes = expanded;
      }
      bytes.set(value, totalBytes);
      totalBytes = requiredBytes;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (cancellation) await cancellation;
    try {
      reader.releaseLock();
    } catch {
      // An abort can leave a read pending briefly. Cancellation has already
      // been requested, so there is no useful recovery action for this reader.
    }
  }

  return bytes.slice(0, totalBytes);
}

export async function readProxyResponseText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const bytes = await readProxyResponseBytes(response, maxBytes, signal);
  try {
    return strictTextDecoder.decode(bytes);
  } catch {
    throw new ProxyResponseBodyError("invalid-utf8");
  }
}

export async function readProxyResponseJson(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return JSON.parse(await readProxyResponseText(response, maxBytes, signal)) as unknown;
}

function abortReason(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Proxy upstream response read was aborted", "AbortError");
}
