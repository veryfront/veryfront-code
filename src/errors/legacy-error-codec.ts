import { decodeVeryfrontErrorData, type VeryfrontErrorData } from "./veryfront-error.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

/**
 * Decode legacy Veryfront error data attached by `toError()`.
 *
 * Only a genuine Error with an own data-valued `context` property is accepted.
 * Structural lookalikes, Error proxies, accessors, nested proxies, cycles, and
 * values above the snapshot limits fail closed. The returned data is a
 * defensive deep snapshot.
 */
export function fromError(error: unknown): VeryfrontErrorData | null {
  try {
    if (!isNativeErrorWithoutHooks(error)) return null;
    const descriptor = getOwnPropertyDescriptor(error, "context");
    if (!descriptor || !hasOwn(descriptor, "value")) return null;

    return decodeVeryfrontErrorData(
      descriptor.value,
      isProxyWithoutHooks,
    );
  } catch {
    return null;
  }
}
