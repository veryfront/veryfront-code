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
  /** Aborted when a local deadline or the caller-owned signal is reached. */
  signal: AbortSignal;
  /** Reset the idle deadline after a concrete unit of work completes. */
  mark(label: string): void;
}

export interface ProgressTimeoutOptions {
  label: string;
  idleTimeoutMs: number;
  /** Optional local hard cap. Omit when the caller already owns the total deadline. */
  hardTimeoutMs?: number;
  /** Optional deadline owned by the operation's caller. */
  signal?: AbortSignal;
}

export interface TimeoutOptions {
  /** Optional caller-owned abort signal that should reject the waiter immediately. */
  signal?: AbortSignal;
  /** Called when the caller-owned signal aborts, before the waiter rejects. */
  onAbort?: (reason: unknown) => void;
  /** Called exactly when this helper's local timeout fires. */
  onTimeout?: (error: TimeoutError) => void;
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
  options?: TimeoutOptions,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logger.error("TIMEOUT_HARD operation timed out (throwing)", { label, timeoutMs });
      const error = new TimeoutError(label, timeoutMs);
      options?.onTimeout?.(error);
      reject(error);
    }, timeoutMs);
  });

  const abortSignal = options?.signal;
  const abortPromise = abortSignal
    ? new Promise<never>((_, reject) => {
      const abort = (): void => {
        const reason = abortSignal.reason ??
          new DOMException("The operation was aborted", "AbortError");
        options?.onAbort?.(reason);
        reject(reason);
      };
      if (abortSignal.aborted) {
        abort();
        return;
      }
      abortSignal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => abortSignal.removeEventListener("abort", abort);
    })
    : undefined;

  try {
    return await Promise.race(
      abortPromise ? [promise, timeoutPromise, abortPromise] : [promise, timeoutPromise],
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    removeAbortListener?.();
  }
}

/**
 * Run an operation with a resettable idle deadline and an optional hard cap.
 *
 * Callers must only call `mark` after meaningful progress. Use `hardTimeoutMs`
 * when this helper owns the total deadline. Omit it when an outer operation
 * already enforces that deadline. The supplied signal lets cooperative work
 * stop after either configured deadline.
 */
export async function withProgressTimeoutThrow<T>(
  operation: (control: ProgressTimeoutControl) => Promise<T>,
  options: ProgressTimeoutOptions,
): Promise<T> {
  const { label, idleTimeoutMs, hardTimeoutMs, signal: parentSignal } = options;
  if (
    idleTimeoutMs <= 0 ||
    (hardTimeoutMs !== undefined &&
      (hardTimeoutMs <= 0 || hardTimeoutMs < idleTimeoutMs))
  ) {
    throw new RangeError(
      "Progress timeout requires idleTimeoutMs > 0 and, when set, hardTimeoutMs >= idleTimeoutMs",
    );
  }

  const controller = new AbortController();
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  let lastProgress = "operation started";
  let rejectTimeout!: (error: unknown) => void;

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

  const abortFromParent = (): void => {
    if (!active || !parentSignal) return;
    active = false;
    const reason = parentSignal.reason ??
      new DOMException("The operation was aborted", "AbortError");
    controller.abort(reason);
    rejectTimeout(reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  if (active) scheduleIdleTimeout();
  const hardTimeoutId = !active || hardTimeoutMs === undefined
    ? undefined
    : setTimeout(() => fail("hard", hardTimeoutMs), hardTimeoutMs);

  try {
    if (!active) return await timeoutPromise;
    return await Promise.race([
      Promise.resolve().then(() => operation(control)),
      timeoutPromise,
    ]);
  } finally {
    active = false;
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    if (hardTimeoutId) clearTimeout(hardTimeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
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
