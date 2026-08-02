/** Captured AbortSignal operations for hostile JavaScript boundaries. */
const apply = Reflect.apply;
const createObject = Object.create;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const NativeTypeError = TypeError;
const abortedGetter = getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const reasonGetter = getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
const addEventListener = EventTarget.prototype.addEventListener;
const removeEventListener = EventTarget.prototype.removeEventListener;

const onceOptions = createObject(null) as AddEventListenerOptions;
defineOwnProperty(onceOptions, "once", {
  configurable: false,
  enumerable: true,
  value: true,
  writable: false,
});
freeze(onceOptions);

/** Test the native AbortSignal brand without reading overridable properties. */
export function isAbortSignalWithoutHooks(value: unknown): value is AbortSignal {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    typeof abortedGetter !== "function"
  ) return false;
  try {
    return typeof apply(abortedGetter, value, []) === "boolean";
  } catch {
    return false;
  }
}

export function isAbortSignalAborted(signal: AbortSignal): boolean {
  if (typeof abortedGetter !== "function") {
    throw new NativeTypeError("AbortSignal is unavailable in this runtime");
  }
  return apply(abortedGetter, signal, []) as boolean;
}

export function getAbortSignalReason(signal: AbortSignal): unknown {
  if (typeof reasonGetter !== "function") return undefined;
  return apply(reasonGetter, signal, []);
}

export function addAbortSignalListenerOnce(signal: AbortSignal, listener: () => void): void {
  apply(addEventListener, signal, ["abort", listener, onceOptions]);
}

export function removeAbortSignalListener(signal: AbortSignal, listener: () => void): void {
  apply(removeEventListener, signal, ["abort", listener]);
}
