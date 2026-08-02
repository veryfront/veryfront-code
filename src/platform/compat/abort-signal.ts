/**
 * Captured AbortSignal operations for hostile JavaScript boundaries.
 *
 * Callers can shadow instance properties or mutate public prototypes after
 * module initialization. These helpers validate the native brand and dispatch
 * through captured intrinsics so cancellation cannot execute those hooks.
 *
 * @module
 */

import { isProxyWithoutHooks } from "./error-introspection.ts";

const apply = Reflect.apply;
const createObject = Object.create;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const NativeTypeError = TypeError;
const abortSignalAbortedGetter = getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalReasonGetter = getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "reason",
)?.get;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;

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
    isProxyWithoutHooks(value) ||
    typeof abortSignalAbortedGetter !== "function"
  ) {
    return false;
  }
  try {
    return typeof apply(abortSignalAbortedGetter, value, []) === "boolean";
  } catch {
    return false;
  }
}

/** Read cancellation state through the captured native getter. */
export function isAbortSignalAborted(signal: AbortSignal): boolean {
  if (typeof abortSignalAbortedGetter !== "function") {
    throw new NativeTypeError("AbortSignal is unavailable in this runtime");
  }
  return apply(abortSignalAbortedGetter, signal, []) as boolean;
}

/** Read the native cancellation reason without consulting an own accessor. */
export function getAbortSignalReason(signal: AbortSignal): unknown {
  if (typeof abortSignalReasonGetter !== "function") return undefined;
  return apply(abortSignalReasonGetter, signal, []);
}

/** Attach one native abort listener without consulting instance methods. */
export function addAbortSignalListenerOnce(
  signal: AbortSignal,
  listener: () => void,
): void {
  apply(eventTargetAddEventListener, signal, ["abort", listener, onceOptions]);
}

/** Remove a native abort listener without consulting instance methods. */
export function removeAbortSignalListener(
  signal: AbortSignal,
  listener: () => void,
): void {
  apply(eventTargetRemoveEventListener, signal, ["abort", listener]);
}
