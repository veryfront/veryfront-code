import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const fallbackAbortReasons = new WeakMap<AbortSignal, DOMException>();
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;
const ReflectApply = Reflect.apply;
const AbortSignalPrototype = AbortSignal.prototype;
const AbortSignalAny = AbortSignal.any;
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
const DOMExceptionConstructor = DOMException;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;

export function isAbortSignalAborted(signal: AbortSignal): boolean {
  return ReflectApply(AbortSignalAbortedGetter!, signal, []) as boolean;
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

/** Validate a caller signal without consulting overridable instance fields. */
export function snapshotAbortSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    value === null || typeof value !== "object" || isProxyWithoutHooks(value) ||
    ObjectGetPrototypeOf(value) !== AbortSignalPrototype ||
    !AbortSignalAbortedGetter || !AbortSignalReasonGetter
  ) {
    throw new TypeError("Data fetch signal must be an AbortSignal instance");
  }
  try {
    ReflectApply(AbortSignalAbortedGetter, value, []);
  } catch {
    throw new TypeError("Data fetch signal must be an AbortSignal instance");
  }
  return value as AbortSignal;
}

export function getAbortReason(signal: AbortSignal): unknown {
  // `AbortController.abort(null)` intentionally exposes `null` as its reason.
  // Nullish coalescing would replace that exact reason and make the later
  // identity check in isCallerAbort classify caller cancellation as a
  // dependency failure. Only runtimes that do not expose a reason at all need
  // a fallback, and that fallback must remain stable for the signal.
  const reason = ReflectApply(AbortSignalReasonGetter!, signal, []);
  if (reason !== undefined) return reason;

  let fallback = ReflectApply(WeakMapGet, fallbackAbortReasons, [signal]) as
    | DOMException
    | undefined;
  if (!fallback) {
    fallback = new DOMExceptionConstructor("The operation was aborted", "AbortError");
    ReflectApply(WeakMapSet, fallbackAbortReasons, [signal, fallback]);
  }
  return fallback;
}

export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const unique: AbortSignal[] = [];
  for (let signalIndex = 0; signalIndex < signals.length; signalIndex++) {
    const signal = signals[signalIndex];
    if (signal === undefined) continue;
    let alreadyPresent = false;
    for (let index = 0; index < unique.length; index++) {
      if (unique[index] === signal) {
        alreadyPresent = true;
        break;
      }
    }
    if (!alreadyPresent) {
      ObjectDefineProperty(unique, unique.length, {
        configurable: true,
        enumerable: true,
        value: signal,
        writable: true,
      });
    }
  }
  if (unique.length === 0) return undefined;
  if (unique.length === 1) return unique[0];
  return ReflectApply(AbortSignalAny, AbortSignal, [unique]) as AbortSignal;
}

/**
 * Stop waiting when the caller disconnects without cancelling shared or
 * dependency-accounted work. The producer remains observed, so a later
 * rejection cannot become unhandled.
 */
export function raceWithCallerAbort<T>(
  producer: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return producer;
  if (isAbortSignalAborted(signal)) return Promise.reject(getAbortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      removeAbortListener(signal, abort);
      reject(getAbortReason(signal));
    };
    addAbortListener(signal, abort);

    producer.then(
      (value) => {
        removeAbortListener(signal, abort);
        resolve(value);
      },
      (error: unknown) => {
        removeAbortListener(signal, abort);
        reject(error);
      },
    );
  });
}

/** Whether a dependency rejection was caused by this exact caller signal. */
export function isCallerAbort(error: unknown, signal?: AbortSignal): boolean {
  if (!signal || !isAbortSignalAborted(signal)) return false;
  return error === getAbortReason(signal);
}
