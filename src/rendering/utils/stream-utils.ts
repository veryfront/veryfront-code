import { SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { rendererLogger as logger } from "#veryfront/utils";

export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

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
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function withTimeoutThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logger.error("TIMEOUT_HARD operation timed out (throwing)", { label, timeoutMs });
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export class StreamTimeoutError extends Error {
  readonly partialContent: string;

  constructor(timeoutMs: number, partialContent: string) {
    super(`Stream read timed out after ${timeoutMs}ms`);
    this.name = "StreamTimeoutError";
    this.partialContent = partialContent;
  }
}

const MAX_SSR_STREAM_BYTES = 16 * 1024 * 1024;

export async function streamToString(
  stream: ReadableStream,
  timeoutMs: number = SSR_TIMEOUT_MS,
  maxBytes: number = MAX_SSR_STREAM_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_SSR_STREAM_BYTES) {
    throw new RangeError(`Stream byte limit must be between 0 and ${MAX_SSR_STREAM_BYTES}`);
  }

  const reader = stream.getReader();
  let totalBytes = 0;
  let content = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    reader.cancel("Stream read timeout").catch(() => {
      /* SILENT: stream already closed */
    });
  }, timeoutMs);

  function throwTimeout(): never {
    logger.error("STREAM_TIMEOUT stream read timed out", {
      timeoutMs,
      partialLength: content.length,
    });
    throw new StreamTimeoutError(timeoutMs, content);
  }

  try {
    while (true) {
      if (timedOut) throwTimeout();

      const { done, value } = await reader.read();

      if (timedOut) throwTimeout();
      if (done) break;

      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Stream byte limit exceeded").catch(() => undefined);
        throw new RangeError(`Stream exceeds the byte limit of ${maxBytes}`);
      }
      content += decoder.decode(value, { stream: true });
    }

    return content + decoder.decode();
  } finally {
    clearTimeout(timeoutId);
    try {
      reader.releaseLock();
    } catch (_) {
      /* expected: reader lock may already be released */
    }
  }
}
