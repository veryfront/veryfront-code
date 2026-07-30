import type { VeryfrontErrorData } from "./veryfront-error.ts";

const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const NativeError = Error;
const captureStackTraceDescriptor = getOwnPropertyDescriptor(
  NativeError,
  "captureStackTrace",
);
const captureStackTrace = captureStackTraceDescriptor &&
    apply(objectHasOwnProperty, captureStackTraceDescriptor, ["value"]) &&
    typeof captureStackTraceDescriptor.value === "function"
  ? captureStackTraceDescriptor.value as (
    targetObject: object,
    constructorOpt?: (...args: never[]) => unknown,
  ) => void
  : undefined;

/** Return one legacy serializable error-data value unchanged. */
export function createError(error: VeryfrontErrorData): VeryfrontErrorData {
  return error;
}

/** Convert legacy serializable error data into a throwable Error. */
export function toError(veryfrontError: VeryfrontErrorData): Error;
export function toError<T extends Error>(
  veryfrontError: VeryfrontErrorData,
  ErrorType: new (message?: string) => T,
): T;
export function toError(
  veryfrontError: VeryfrontErrorData,
  ErrorType: new (message?: string) => Error = NativeError,
): Error {
  const error = new ErrorType(veryfrontError.message);
  defineProperty(error, "name", {
    configurable: true,
    enumerable: false,
    value: `VeryfrontError[${veryfrontError.type}]`,
    writable: true,
  });

  if (captureStackTrace) {
    apply(captureStackTrace, NativeError, [error, toError]);
  }

  defineProperty(error, "context", {
    configurable: true,
    enumerable: false,
    value: veryfrontError,
  });

  return error;
}
