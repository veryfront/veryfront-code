/**
 * Runtime-compatible, no-hook value introspection.
 *
 * `Error.isError()` is the standard brand check on newer runtimes. The Node
 * compatibility implementation keeps the same semantics on supported older
 * runtimes and also provides the only available synchronous Proxy brand check.
 */
import { types as nodeUtilTypes } from "node:util";

const apply = Reflect.apply;
const standardIsError = Object.getOwnPropertyDescriptor(Error, "isError")?.value;
const nativeErrorBrandCheck: (value: unknown) => boolean = typeof standardIsError === "function"
  ? (value) => apply(standardIsError, Error, [value]) as boolean
  : (value) => nodeUtilTypes.isNativeError(value);
const nativeProxyBrandCheck = nodeUtilTypes.isProxy;
const nativePromiseBrandCheck = nodeUtilTypes.isPromise;

/**
 * Identify native Error values without evaluating project-owned Proxy traps.
 */
export function isNativeErrorWithoutHooks(value: unknown): value is Error {
  return nativeErrorBrandCheck(value);
}

/** Identify a Proxy without evaluating any trap on the proxied value. */
export function isProxyWithoutHooks(value: unknown): boolean {
  return nativeProxyBrandCheck(value);
}

/** Identify a genuine Promise across realms without reading instance fields. */
export function isNativePromiseWithoutHooks(
  value: unknown,
): value is Promise<unknown> {
  return nativePromiseBrandCheck(value);
}
