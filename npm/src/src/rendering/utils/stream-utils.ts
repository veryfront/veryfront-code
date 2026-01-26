import * as dntShim from "../../../_dnt.shims.js";
import { SSR_TIMEOUT_MS } from "../../config/defaults.js";
import { rendererLogger as logger } from "../../utils/index.js";

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
  let timeoutId: ReturnType<typeof dntShim.setTimeout> | undefined;

  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = dntShim.setTimeout(() => {
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
  let timeoutId: ReturnType<typeof dntShim.setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = dntShim.setTimeout(() => {
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
  const binaryChunks: Uint8Array[] = [];
  let totalBytes = 0;

  let timedOut = false;
  const timeoutId = dntShim.setTimeout(() => {
    timedOut = true;
    reader.cancel("Stream read timeout").catch(() => {});
  }, timeoutMs);

  const throwTimeout = (): never => {
    const partial = new TextDecoder().decode(concatUint8Arrays(binaryChunks, totalBytes));
    logger.error("STREAM_TIMEOUT stream read timed out", {
      timeoutMs,
      partialLength: partial.length,
    });
    throw new StreamTimeoutError(timeoutMs, partial);
  };

  try {
    while (true) {
      if (timedOut) throwTimeout();

      const { done, value } = await reader.read();

      if (timedOut) throwTimeout();
      if (done) break;

      if (value) {
        binaryChunks.push(value);
        totalBytes += value.byteLength;
      }
    }

    return new TextDecoder().decode(concatUint8Arrays(binaryChunks, totalBytes));
  } finally {
    clearTimeout(timeoutId);
    try {
      reader.releaseLock();
    } catch {
      // Ignore if already released
    }
  }
}
