import { SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { rendererLogger as logger } from "#veryfront/utils";

export class TimeoutError extends Error {
  readonly timeoutKind?: "idle" | "hard";
  readonly lastProgress?: string;

  constructor(
    label: string,
    timeoutMs: number,
    details?: { kind?: "idle" | "hard"; lastProgress?: string },
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutKind = details?.kind;
    this.lastProgress = details?.lastProgress;
  }
}

export interface ProgressTimeoutControl {
  /** Aborted when either the idle deadline or hard cap is reached. */
  signal: AbortSignal;
  /** Reset the idle deadline after a concrete unit of work completes. */
  mark(label: string): void;
}

export interface ProgressTimeoutOptions {
  label: string;
  idleTimeoutMs: number;
  hardTimeoutMs: number;
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

/**
 * Run an operation with a resettable idle deadline and a non-resettable hard cap.
 *
 * Callers must only call `mark` after meaningful progress. The hard cap keeps a
 * noisy or buggy progress source from extending work forever. The supplied
 * signal lets cooperative operations stop after either deadline.
 */
export async function withProgressTimeoutThrow<T>(
  operation: (control: ProgressTimeoutControl) => Promise<T>,
  options: ProgressTimeoutOptions,
): Promise<T> {
  const { label, idleTimeoutMs, hardTimeoutMs } = options;
  if (idleTimeoutMs <= 0 || hardTimeoutMs <= 0 || hardTimeoutMs < idleTimeoutMs) {
    throw new RangeError("Progress timeout requires 0 < idleTimeoutMs <= hardTimeoutMs");
  }

  const controller = new AbortController();
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  let lastProgress = "operation started";
  let rejectTimeout!: (error: TimeoutError) => void;

  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });

  const fail = (kind: "idle" | "hard", timeoutMs: number): void => {
    if (!active) return;
    active = false;
    const error = new TimeoutError(label, timeoutMs, { kind, lastProgress });
    logger.error("TIMEOUT_PROGRESS operation timed out (throwing)", {
      label,
      timeoutKind: kind,
      timeoutMs,
      idleTimeoutMs,
      hardTimeoutMs,
      lastProgress,
    });
    controller.abort(error);
    rejectTimeout(error);
  };

  const scheduleIdleTimeout = (): void => {
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => fail("idle", idleTimeoutMs), idleTimeoutMs);
  };

  const control: ProgressTimeoutControl = {
    signal: controller.signal,
    mark(progressLabel: string): void {
      if (!active || controller.signal.aborted) return;
      lastProgress = progressLabel;
      scheduleIdleTimeout();
    },
  };

  scheduleIdleTimeout();
  const hardTimeoutId = setTimeout(() => fail("hard", hardTimeoutMs), hardTimeoutMs);

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(control)),
      timeoutPromise,
    ]);
  } finally {
    active = false;
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    if (hardTimeoutId) clearTimeout(hardTimeoutId);
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
  const decoder = new TextDecoder();

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    reader.cancel("Stream read timeout").catch(() => {
      /* SILENT: stream already closed */
    });
  }, timeoutMs);

  function throwTimeout(): never {
    const partial = decoder.decode(concatUint8Arrays(binaryChunks, totalBytes));
    logger.error("STREAM_TIMEOUT stream read timed out", {
      timeoutMs,
      partialLength: partial.length,
    });
    throw new StreamTimeoutError(timeoutMs, partial);
  }

  try {
    while (true) {
      if (timedOut) throwTimeout();

      const { done, value } = await reader.read();

      if (timedOut) throwTimeout();
      if (done) break;

      if (!value) continue;

      binaryChunks.push(value);
      totalBytes += value.byteLength;
    }

    return decoder.decode(concatUint8Arrays(binaryChunks, totalBytes));
  } finally {
    clearTimeout(timeoutId);
    try {
      reader.releaseLock();
    } catch (_) {
      /* expected: reader lock may already be released */
    }
  }
}
