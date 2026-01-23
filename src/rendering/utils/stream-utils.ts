import { SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { rendererLogger as logger } from "#veryfront/utils";

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Wrap a promise with timeout protection.
 * Returns undefined if timeout occurs (non-throwing for optional operations).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn("TIMEOUT_SOFT operation timed out (returning undefined)", {
        label,
        timeoutMs,
      });
      resolve(undefined);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Wrap a promise with timeout protection (throwing version).
 * Throws TimeoutError if timeout occurs.
 */
export async function withTimeoutThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logger.error("TIMEOUT_HARD operation timed out (throwing)", { label, timeoutMs });
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Error thrown when stream reading times out.
 */
export class StreamTimeoutError extends Error {
  constructor(timeoutMs: number, partialContent: string) {
    super(`Stream read timed out after ${timeoutMs}ms`);
    this.name = "StreamTimeoutError";
    this.partialContent = partialContent;
  }
  readonly partialContent: string;
}

/**
 * Convert a ReadableStream to string with timeout protection.
 *
 * If the stream doesn't complete within the timeout, throws StreamTimeoutError
 * with partial content that was read so far.
 *
 * @param stream - The stream to read
 * @param timeoutMs - Timeout in milliseconds (default: SSR_TIMEOUT_MS)
 */
/**
 * Concatenate Uint8Array chunks into a single array.
 * More efficient than string concatenation for binary data.
 */
function concatUint8Arrays(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function streamToString(
  stream: ReadableStream,
  timeoutMs: number = SSR_TIMEOUT_MS,
): Promise<string> {
  const reader = stream.getReader();
  // Accumulate binary chunks instead of decoded strings
  // This avoids multiple TextDecoder calls with { stream: true } overhead
  const binaryChunks: Uint8Array[] = [];
  let totalBytes = 0;

  // Set up timeout
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    reader.cancel("Stream read timeout").catch(() => {
      // Ignore cancel errors
    });
  }, timeoutMs);

  try {
    while (true) {
      // Check before AND after read - cancel() may cause read() to return done=true
      if (timedOut) {
        // Decode partial content only when needed (timeout path)
        const decoder = new TextDecoder();
        const partial = decoder.decode(concatUint8Arrays(binaryChunks, totalBytes));
        logger.error("STREAM_TIMEOUT stream read timed out", {
          timeoutMs,
          partialLength: partial.length,
        });
        throw new StreamTimeoutError(timeoutMs, partial);
      }

      const { done, value } = await reader.read();

      // Check again after read - timeout may have fired during await
      if (timedOut) {
        const decoder = new TextDecoder();
        const partial = decoder.decode(concatUint8Arrays(binaryChunks, totalBytes));
        logger.error("STREAM_TIMEOUT stream read timed out", {
          timeoutMs,
          partialLength: partial.length,
        });
        throw new StreamTimeoutError(timeoutMs, partial);
      }

      if (done) break;
      if (value) {
        binaryChunks.push(value);
        totalBytes += value.byteLength;
      }
    }

    // Single decode at the end - handles multi-byte characters correctly
    const decoder = new TextDecoder();
    return decoder.decode(concatUint8Arrays(binaryChunks, totalBytes));
  } finally {
    clearTimeout(timeoutId);
    // Ensure reader is released
    try {
      reader.releaseLock();
    } catch {
      // Ignore if already released
    }
  }
}
