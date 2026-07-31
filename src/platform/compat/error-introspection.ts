/**
 * Runtime-compatible, no-hook value introspection.
 *
 * The Node compatibility implementation exposes runtime internal-slot checks
 * across supported runtimes without consulting mutable global constructors.
 */
import {
  isAsyncFunction as nativeAsyncFunctionBrandCheck,
  isNativeError as nativeErrorBrandCheck,
  isPromise as nativePromiseBrandCheck,
  isProxy as nativeProxyBrandCheck,
  isUint8Array as nativeUint8ArrayBrandCheck,
} from "node:util/types";

const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const deleteProperty = Reflect.deleteProperty;
const apply = Reflect.apply;
const NativeError = Error;
const NativeAsyncFunctionPrototype = getPrototypeOf(async function () {});
const toStringTagSymbol = Symbol.toStringTag;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

function createDataDescriptor(value: unknown): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = true;
  return descriptor;
}

function clonePropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const clone = createObject(null) as PropertyDescriptor;
  for (
    const key of [
      "configurable",
      "enumerable",
      "get",
      "set",
      "value",
      "writable",
    ] as const
  ) {
    if (hasOwn(descriptor, key)) clone[key] = descriptor[key] as never;
  }
  return clone;
}

/**
 * Probe the runtime's actual stack-descriptor behavior without trusting a
 * mutable version or feature flag. A temporary own `prepareStackTrace` value
 * shadows both own and inherited project hooks for the synchronous probe and
 * the original descriptor is restored before this function returns.
 */
function detectSafeErrorStackDescriptorInspection(): boolean {
  let originalFormatter: PropertyDescriptor | undefined;
  try {
    const descriptor = getOwnPropertyDescriptor(NativeError, "prepareStackTrace");
    originalFormatter = descriptor ? clonePropertyDescriptor(descriptor) : undefined;
  } catch (_) {
    return false;
  }

  let installed = false;
  let restored = false;
  let stackDescriptor: PropertyDescriptor | undefined;
  try {
    defineProperty(
      NativeError,
      "prepareStackTrace",
      createDataDescriptor(undefined),
    );
    installed = true;
    stackDescriptor = getOwnPropertyDescriptor(new NativeError(), "stack");
  } catch (_) {
    // A non-configurable formatter or hostile runtime disables stack capture.
  } finally {
    if (installed) {
      try {
        restored = originalFormatter
          ? (defineProperty(NativeError, "prepareStackTrace", originalFormatter), true)
          : deleteProperty(NativeError, "prepareStackTrace");
      } catch (_) {
        restored = false;
      }
    }
  }

  if (!restored || !stackDescriptor || !hasOwn(stackDescriptor, "get")) return false;
  return typeof stackDescriptor.get === "function";
}

/** True when own stack descriptors can be inspected without formatting them. */
export const canInspectErrorStackDescriptorWithoutHooks =
  detectSafeErrorStackDescriptorInspection();

/**
 * Identify native Error values without evaluating project-owned Proxy traps.
 */
export function isNativeErrorWithoutHooks(value: unknown): value is Error {
  return nativeErrorBrandCheck(value);
}

function readOwnDataString(
  value: object,
  key: PropertyKey,
): string | undefined {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
  return typeof descriptor.value === "string" && descriptor.value ? descriptor.value : undefined;
}

function readCustomErrorConstructorName(
  prototype: object,
): string | undefined {
  const constructorDescriptor = getOwnPropertyDescriptor(
    prototype,
    "constructor",
  );
  if (
    !constructorDescriptor ||
    !hasOwn(constructorDescriptor, "value") ||
    typeof constructorDescriptor.value !== "function" ||
    nativeProxyBrandCheck(constructorDescriptor.value)
  ) {
    return undefined;
  }
  return readOwnDataString(constructorDescriptor.value, "name");
}

/**
 * Read a native Error's display name without executing instance, prototype, or
 * constructor accessors. Custom subclasses use their own data-valued
 * prototype name or constructor name; unreadable/exotic shapes fail closed.
 */
export function readNativeErrorNameWithoutHooks(error: Error): string {
  try {
    const ownNameDescriptor = getOwnPropertyDescriptor(error, "name");
    if (ownNameDescriptor) {
      if (!hasOwn(ownNameDescriptor, "value")) return "Error";
      return typeof ownNameDescriptor.value === "string" && ownNameDescriptor.value
        ? ownNameDescriptor.value
        : "Error";
    }

    const prototype = getPrototypeOf(error);
    if (prototype === null || nativeProxyBrandCheck(prototype)) return "Error";
    return readOwnDataString(prototype, "name") ??
      readCustomErrorConstructorName(prototype) ??
      "Error";
  } catch (_) {
    return "Error";
  }
}

/** Identify a Proxy without evaluating any trap on the proxied value. */
export function isProxyWithoutHooks(value: unknown): boolean {
  return nativeProxyBrandCheck(value);
}

/** Identify a genuine Uint8Array without evaluating project-owned hooks. */
export function isUint8ArrayWithoutHooks(value: unknown): value is Uint8Array {
  return nativeUint8ArrayBrandCheck(value);
}

/** Identify a genuine Promise across realms without reading instance fields. */
export function isNativePromiseWithoutHooks(
  value: unknown,
): value is Promise<unknown> {
  return nativePromiseBrandCheck(value);
}

/**
 * Identify native and bound async functions across realms without invoking
 * project hooks. The descriptor fallback is deliberately conservative because
 * runtime brand checks do not recognize bound async functions.
 */
export function isNativeAsyncFunctionWithoutHooks(
  value: unknown,
): value is (...args: unknown[]) => Promise<unknown> {
  if (nativeAsyncFunctionBrandCheck(value)) return true;
  if (typeof value !== "function" || nativeProxyBrandCheck(value)) return false;

  try {
    const prototype = getPrototypeOf(value);
    if (prototype === NativeAsyncFunctionPrototype) return true;
    if (prototype === null || nativeProxyBrandCheck(prototype)) return false;

    const tag = getOwnPropertyDescriptor(prototype, toStringTagSymbol);
    return tag !== undefined &&
      hasOwn(tag, "value") &&
      tag.value === "AsyncFunction";
  } catch (_) {
    return false;
  }
}
