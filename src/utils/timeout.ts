import {
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { logger } from "./logger/logger.ts";
import { normalizeTimerDurationMs } from "./timer.ts";

const timeoutLogger = logger.component("timeout");
const AbortSignalPrototype = AbortSignal.prototype;
const AbortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignalPrototype,
  "aborted",
)?.get;
const AbortSignalReasonGetter = Object.getOwnPropertyDescriptor(
  AbortSignalPrototype,
  "reason",
)?.get;
const EventTargetAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const PromiseConstructor = Promise;
const PromisePrototype = Promise.prototype;
const PromisePrototypeThen = PromisePrototype.then;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectOwnKeys = Reflect.ownKeys;
const fallbackAbortReasons = new WeakMap<AbortSignal, DOMException>();

interface TimeoutOptionsSnapshot {
  readonly signal?: AbortSignal;
  readonly onAbort?: (reason: unknown) => void;
  readonly onTimeout?: (error: TimeoutError) => void;
}

const EMPTY_TIMEOUT_OPTIONS: TimeoutOptionsSnapshot = Object.freeze({});

function snapshotOperationPromise<T>(value: unknown): Promise<T> {
  if (
    isProxyWithoutHooks(value) || !isNativePromiseWithoutHooks(value) ||
    ObjectGetPrototypeOf(value) !== PromisePrototype
  ) {
    throw new TypeError("Timeout operation must be an unwrapped native Promise");
  }
  for (const field of ["then", "constructor"] as const) {
    if (ReflectGetOwnPropertyDescriptor(value, field) !== undefined) {
      throw new TypeError(`Timeout operation must not override ${field}`);
    }
  }
  return value as Promise<T>;
}

function observePromise<T>(
  promise: Promise<T>,
  onFulfilled: ((value: T) => void) | undefined,
  onRejected: ((reason: unknown) => void) | undefined,
): void {
  ReflectApply(PromisePrototypeThen, promise, [onFulfilled, onRejected]);
}

function snapshotAbortSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    value === null || typeof value !== "object" || isProxyWithoutHooks(value) ||
    ObjectGetPrototypeOf(value) !== AbortSignalPrototype ||
    !AbortSignalAbortedGetter || !AbortSignalReasonGetter
  ) {
    throw new TypeError("Timeout signal must be an AbortSignal instance");
  }

  for (
    const field of ["aborted", "reason", "addEventListener", "removeEventListener"] as const
  ) {
    if (ReflectGetOwnPropertyDescriptor(value, field) !== undefined) {
      throw new TypeError(`Timeout signal must not override ${field}`);
    }
  }

  try {
    ReflectApply(AbortSignalAbortedGetter, value, []);
    ReflectApply(AbortSignalReasonGetter, value, []);
  } catch {
    throw new TypeError("Timeout signal must be an AbortSignal instance");
  }
  return value as AbortSignal;
}

function snapshotTimeoutOptions(value: unknown): TimeoutOptionsSnapshot {
  if (value === undefined) return EMPTY_TIMEOUT_OPTIONS;
  if (
    value === null || typeof value !== "object" || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    throw new TypeError("Timeout options must be a plain object");
  }
  const prototype = ObjectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Timeout options must be a plain object");
  }

  let signalValue: unknown;
  let onAbortValue: unknown;
  let onTimeoutValue: unknown;
  const keys = ReflectOwnKeys(value);
  if (keys.length > 3) {
    throw new TypeError("Timeout options contain unknown properties");
  }
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      (key !== "signal" && key !== "onAbort" && key !== "onTimeout")
    ) {
      throw new TypeError(`Unknown timeout option: ${String(key)}`);
    }
    const descriptor = ReflectGetOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError(
        `Timeout option ${key} must be an own enumerable data property`,
      );
    }
    if (key === "signal") signalValue = descriptor.value;
    else if (key === "onAbort") onAbortValue = descriptor.value;
    else onTimeoutValue = descriptor.value;
  }

  if (onAbortValue !== undefined && typeof onAbortValue !== "function") {
    throw new TypeError("Timeout onAbort must be a function");
  }
  if (onTimeoutValue !== undefined && typeof onTimeoutValue !== "function") {
    throw new TypeError("Timeout onTimeout must be a function");
  }

  return Object.freeze({
    signal: snapshotAbortSignal(signalValue),
    onAbort: onAbortValue as TimeoutOptionsSnapshot["onAbort"],
    onTimeout: onTimeoutValue as TimeoutOptionsSnapshot["onTimeout"],
  });
}

function isAbortSignalAborted(signal: AbortSignal): boolean {
  return ReflectApply(AbortSignalAbortedGetter!, signal, []) as boolean;
}

function getAbortReason(signal: AbortSignal): unknown {
  const reason = ReflectApply(AbortSignalReasonGetter!, signal, []);
  if (reason !== undefined) return reason;

  let fallback = fallbackAbortReasons.get(signal);
  if (!fallback) {
    fallback = new DOMException("The operation was aborted", "AbortError");
    fallbackAbortReasons.set(signal, fallback);
  }
  return fallback;
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(EventTargetAddEventListener, signal, [
    "abort",
    listener,
    { once: true },
  ]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  ReflectApply(EventTargetRemoveEventListener, signal, ["abort", listener]);
}

/** Error raised when a locally owned operation deadline expires. */
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

/** Cancellation and cleanup hooks for {@link withTimeoutThrow}. */
export interface TimeoutOptions {
  /** Optional caller-owned abort signal that should reject the waiter immediately. */
  signal?: AbortSignal;
  /** Called when the caller-owned signal aborts; failures do not replace the abort reason. */
  onAbort?: (reason: unknown) => void;
  /** Called when the local timeout fires; failures do not replace the timeout error. */
  onTimeout?: (error: TimeoutError) => void;
}

/**
 * Await a promise until it settles, a local deadline expires, or the caller
 * aborts. The primitive does not cancel the supplied promise; cooperative
 * callers can use the hooks to stop the underlying work.
 */
export async function withTimeoutThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  options?: TimeoutOptions,
): Promise<T> {
  const observedPromise = snapshotOperationPromise<T>(promise);
  let normalizedTimeoutMs: number;
  let snapshot: TimeoutOptionsSnapshot;
  try {
    if (typeof label !== "string") {
      throw new TypeError("Timeout label must be a string");
    }
    normalizedTimeoutMs = normalizeTimerDurationMs(timeoutMs, "Timeout duration");
    snapshot = snapshotTimeoutOptions(options);
  } catch (error) {
    // An invalid boundary must not leave a caller-started promise unobserved.
    observePromise(observedPromise, undefined, () => {});
    throw error;
  }

  return await new PromiseConstructor<T>((resolve, reject) => {
    const abortSignal = snapshot.signal;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortListenerAttached = false;
    let settled = false;

    const cleanup = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (abortSignal && abortListenerAttached) {
        removeAbortListener(abortSignal, abort);
        abortListenerAttached = false;
      }
    };

    const settleResolve = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
    };

    const abort = (): void => {
      if (settled || !abortSignal) return;
      const reason = getAbortReason(abortSignal);
      try {
        snapshot.onAbort?.(reason);
      } catch (callbackError) {
        timeoutLogger.error("TIMEOUT_HARD onAbort callback failed", {
          label,
          error: callbackError instanceof Error ? callbackError.message : String(callbackError),
        });
      } finally {
        settleReject(reason);
      }
    };

    // Observe the caller-started operation even when cancellation is already
    // visible, so a later producer rejection cannot become unhandled.
    observePromise(observedPromise, settleResolve, settleReject);

    if (abortSignal) {
      if (isAbortSignalAborted(abortSignal)) {
        abort();
        return;
      }
      addAbortListener(abortSignal, abort);
      abortListenerAttached = true;
      // Abort can occur between the first brand-safe state read and listener
      // registration. The second read closes that lost-notification window.
      if (isAbortSignalAborted(abortSignal)) {
        abort();
        return;
      }
    }

    timeoutId = setTimeout(() => {
      // A caller cancellation already visible at this deadline owns the
      // outcome; never reclassify it as a dependency timeout.
      if (abortSignal && isAbortSignalAborted(abortSignal)) {
        abort();
        return;
      }
      if (settled) return;

      timeoutLogger.error("TIMEOUT_HARD operation timed out (throwing)", {
        label,
        timeoutMs: normalizedTimeoutMs,
      });
      const error = new TimeoutError(label, normalizedTimeoutMs);
      try {
        snapshot.onTimeout?.(error);
      } catch (callbackError) {
        timeoutLogger.error("TIMEOUT_HARD onTimeout callback failed", {
          label,
          error: callbackError instanceof Error ? callbackError.message : String(callbackError),
        });
      } finally {
        settleReject(error);
      }
    }, normalizedTimeoutMs);
  });
}
