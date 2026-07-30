export { createError, toError } from "./legacy-error-construction.ts";

const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const NativeError = Error;
const NativeString = String;
const nativeErrorCheckDescriptor = getOwnPropertyDescriptor(
  NativeError,
  "isError",
);
const nativeErrorCheck = nativeErrorCheckDescriptor &&
    apply(objectHasOwnProperty, nativeErrorCheckDescriptor, ["value"]) &&
    typeof nativeErrorCheckDescriptor.value === "function"
  ? nativeErrorCheckDescriptor.value as (value: unknown) => boolean
  : undefined;

function isBrowserError(value: unknown): value is Error {
  if (!nativeErrorCheck) return false;
  try {
    return apply(nativeErrorCheck, NativeError, [value]) === true;
  } catch {
    return false;
  }
}

function safeBrowserErrorMessage(value: unknown): string {
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) {
    return "Unknown error";
  }
  try {
    return NativeString(value);
  } catch {
    return "Unknown error";
  }
}

function readOwnBrowserErrorString(
  error: Error,
  key: PropertyKey,
): string | undefined {
  try {
    const descriptor = getOwnPropertyDescriptor(error, key);
    if (
      !descriptor ||
      !apply(objectHasOwnProperty, descriptor, ["value"]) ||
      typeof descriptor.value !== "string"
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function detachBrowserError(error: Error): Error {
  const detached = new NativeError(
    readOwnBrowserErrorString(error, "message") ?? "Unknown error",
  );
  const name = readOwnBrowserErrorString(error, "name");
  defineProperty(detached, "name", {
    configurable: true,
    enumerable: false,
    value: name && name.length > 0 ? name : "Error",
    writable: true,
  });
  return detached;
}

/** Normalize a caught browser value without importing server-only brands. */
export function ensureBrowserError(value: unknown): Error {
  return isBrowserError(value)
    ? detachBrowserError(value)
    : new NativeError(safeBrowserErrorMessage(value));
}
