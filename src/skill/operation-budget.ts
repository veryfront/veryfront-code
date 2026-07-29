/** Shared cancellation/deadline budget for one skill file operation. */

export interface SkillOperationBudget {
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  remainingMs(): number | undefined;
  throwIfTerminated(): void;
  run<T>(operation: (abortSignal: AbortSignal | undefined) => Promise<T>): Promise<T>;
}

export class SkillOperationTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Skill operation timed out after ${timeoutMs}ms`);
    this.name = "SkillOperationTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted", "AbortError")
    : signal.reason;
}

/** Create one monotonic budget at the outermost skill-tool boundary. */
export function createSkillOperationBudget(options: {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
} = {}): SkillOperationBudget {
  const timeoutMs = options.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new RangeError("Skill operation timeout must be a positive safe integer");
  }
  const deadline = timeoutMs === undefined ? undefined : performance.now() + timeoutMs;

  const remainingMs = (): number | undefined =>
    deadline === undefined ? undefined : Math.max(0, Math.ceil(deadline - performance.now()));

  const throwIfTerminated = (): void => {
    if (options.abortSignal?.aborted) {
      throw abortReason(options.abortSignal);
    }
    if (remainingMs() === 0) {
      throw new SkillOperationTimeoutError(timeoutMs!);
    }
  };

  return Object.freeze({
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    remainingMs,
    throwIfTerminated,
    async run<T>(
      operation: (abortSignal: AbortSignal | undefined) => Promise<T>,
    ): Promise<T> {
      throwIfTerminated();
      let promise: Promise<T>;
      try {
        promise = Promise.resolve(operation(options.abortSignal));
      } catch (error) {
        throwIfTerminated();
        throw error;
      }
      try {
        throwIfTerminated();
      } catch (error) {
        void promise.catch(() => undefined);
        throw error;
      }
      if (deadline === undefined && options.abortSignal === undefined) {
        return await promise;
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      const termination = new Promise<never>((_resolve, reject) => {
        const remaining = remainingMs();
        if (remaining !== undefined) {
          timeoutId = setTimeout(
            () => reject(new SkillOperationTimeoutError(timeoutMs!)),
            remaining,
          );
        }
        if (options.abortSignal) {
          abortListener = () => reject(abortReason(options.abortSignal!));
          options.abortSignal.addEventListener("abort", abortListener, { once: true });
          if (options.abortSignal.aborted) {
            abortListener();
          }
        }
      });

      try {
        let result: T;
        try {
          result = await Promise.race([promise, termination]);
        } catch (error) {
          throwIfTerminated();
          throw error;
        }
        throwIfTerminated();
        return result;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (abortListener) {
          options.abortSignal?.removeEventListener("abort", abortListener);
        }
      }
    },
  });
}
