import {
  InvalidResponseBodyUtf8Error,
  readResponseTextPrefix,
} from "#veryfront/utils/response-body.ts";

/** Base class for deterministic HTTP module body validation failures. */
export class HttpModuleBodyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HttpModuleBodyError";
  }
}

/** Raised when an HTTP module exceeds its caller-owned response limit. */
export class HttpModuleBodyTooLargeError extends HttpModuleBodyError {
  constructor(readonly maxBytes: number) {
    super(`HTTP module response exceeds ${maxBytes} bytes`);
    this.name = "HttpModuleBodyTooLargeError";
  }
}

/** Raised when an HTTP module is not valid UTF-8 source text. */
export class HttpModuleBodyEncodingError extends HttpModuleBodyError {
  constructor(options?: ErrorOptions) {
    super("HTTP module response is not valid UTF-8", options);
    this.name = "HttpModuleBodyEncodingError";
  }
}

function cancelResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => undefined);
  } catch {
    /* cancellation is best-effort cleanup */
  }
}

function requireMaxBytes(maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("HTTP module response limit must be a positive safe integer");
  }
  return maxBytes;
}

/**
 * Read one HTTP module response as strict UTF-8 without buffering more than
 * `maxBytes + 1`. The extra probe byte distinguishes an exact-limit body from
 * an oversized body while the shared prefix reader cancels unread data.
 */
export async function readHttpModuleText(
  response: Response,
  maxBytes: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  const limit = requireMaxBytes(maxBytes);
  if (abortSignal?.aborted) {
    cancelResponseBody(response);
    abortSignal.throwIfAborted();
  }

  const rawContentLength = response.headers.get("content-length");
  if (rawContentLength && /^\d+$/.test(rawContentLength)) {
    const contentLength = Number(rawContentLength);
    if (Number.isSafeInteger(contentLength) && contentLength > limit) {
      cancelResponseBody(response);
      throw new HttpModuleBodyTooLargeError(limit);
    }
  }

  try {
    const { text, truncated } = await readResponseTextPrefix(
      response,
      limit + 1,
      abortSignal,
      { fatalUtf8: true },
    );
    if (truncated) throw new HttpModuleBodyTooLargeError(limit);
    return text;
  } catch (cause) {
    if (cause instanceof InvalidResponseBodyUtf8Error) {
      throw new HttpModuleBodyEncodingError({ cause });
    }
    throw cause;
  }
}
