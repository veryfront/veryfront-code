/** Shared cancellation/deadline budget for one skill file operation. */

import {
  addAbortSignalListenerOnce,
  getAbortSignalReason,
  isAbortSignalAborted,
  isAbortSignalWithoutHooks,
  removeAbortSignalListener,
} from "#veryfront/platform/compat/abort-signal.ts";

const NativeDOMException = DOMException;
const NativePromise = Promise;
const apply = Reflect.apply;
const clearScheduledTimeout = clearTimeout;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const mathCeil = Math.ceil;
const mathMax = Math.max;
const monotonicClock = performance;
const monotonicNow = performance.now;
const scheduleTimeout = setTimeout;

function now(): number {
  return apply(monotonicNow, monotonicClock, []) as number;
}

export interface SkillOperationBudget {
  readonly abortSignal?: AbortSignal;
  readonly timeoutMs?: number;
  /** One immutable timeout reason shared by every deadline observation. */
  readonly timeoutError?: SkillOperationTimeoutError;
  remainingMs(): number | undefined;
  throwIfTerminated(): void;
  run<T>(operation: (abortSignal: AbortSignal | undefined) => Promise<T>): Promise<T>;
}

export class SkillOperationTimeoutError extends Error {
  readonly timeoutMs!: number;

  constructor(timeoutMs: number) {
    super(`Skill operation timed out after ${timeoutMs}ms`);
    defineOwnProperty(this, "name", {
      configurable: false,
      enumerable: false,
      value: "SkillOperationTimeoutError",
      writable: false,
    });
    defineOwnProperty(this, "timeoutMs", {
      configurable: false,
      enumerable: true,
      value: timeoutMs,
      writable: false,
    });
    freeze(this);
  }
}

async function observeRejection(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (_) {
    // The caller intentionally abandoned this settlement after cancellation.
  }
}

function racePromises<T>(left: Promise<T>, right: Promise<never>): Promise<T> {
  return new NativePromise<T>((resolve, reject) => {
    void (async () => {
      try {
        resolve(await left);
      } catch (error) {
        reject(error);
      }
    })();
    void (async () => {
      try {
        resolve(await right);
      } catch (error) {
        reject(error);
      }
    })();
  });
}

function abortReason(signal: AbortSignal): unknown {
  const reason = getAbortSignalReason(signal);
  return reason === undefined
    ? new NativeDOMException("The operation was aborted", "AbortError")
    : reason;
}

/** Create one monotonic budget at the outermost skill-tool boundary. */
export function createSkillOperationBudget(options: {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
} = {}): SkillOperationBudget {
  const abortSignal = options.abortSignal;
  if (abortSignal !== undefined && !isAbortSignalWithoutHooks(abortSignal)) {
    throw new TypeError("Skill operation abortSignal must be an AbortSignal");
  }
  const timeoutMs = options.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new RangeError("Skill operation timeout must be a positive safe integer");
  }
  const timeoutError = timeoutMs === undefined
    ? undefined
    : new SkillOperationTimeoutError(timeoutMs);
  const deadline = timeoutMs === undefined ? undefined : now() + timeoutMs;

  const remainingMs = (): number | undefined =>
    deadline === undefined ? undefined : mathMax(0, mathCeil(deadline - now()));

  const throwIfTerminated = (): void => {
    if (abortSignal && isAbortSignalAborted(abortSignal)) {
      throw abortReason(abortSignal);
    }
    if (remainingMs() === 0) {
      throw timeoutError!;
    }
  };

  return freeze({
    ...(abortSignal === undefined ? {} : { abortSignal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(timeoutError === undefined ? {} : { timeoutError }),
    remainingMs,
    throwIfTerminated,
    async run<T>(
      operation: (abortSignal: AbortSignal | undefined) => Promise<T>,
    ): Promise<T> {
      throwIfTerminated();
      let promise: Promise<T>;
      try {
        promise = operation(abortSignal);
      } catch (error) {
        throwIfTerminated();
        throw error;
      }
      try {
        throwIfTerminated();
      } catch (error) {
        void observeRejection(promise);
        throw error;
      }
      if (deadline === undefined && abortSignal === undefined) {
        return await promise;
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      const termination = new NativePromise<never>((_resolve, reject) => {
        const remaining = remainingMs();
        if (remaining !== undefined) {
          timeoutId = scheduleTimeout(
            () => reject(timeoutError!),
            remaining,
          );
        }
        if (abortSignal) {
          abortListener = () => reject(abortReason(abortSignal));
          addAbortSignalListenerOnce(abortSignal, abortListener);
          if (isAbortSignalAborted(abortSignal)) {
            abortListener();
          }
        }
      });

      try {
        let result: T;
        try {
          result = await racePromises(promise, termination);
        } catch (error) {
          throwIfTerminated();
          throw error;
        }
        throwIfTerminated();
        return result;
      } finally {
        if (timeoutId !== undefined) clearScheduledTimeout(timeoutId);
        if (abortSignal && abortListener) {
          removeAbortSignalListener(abortSignal, abortListener);
        }
      }
    },
  });
}
