import { decodeVeryfrontErrorData, type VeryfrontErrorData } from "./veryfront-error.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

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
    if (!descriptor || !("value" in descriptor)) return null;

    return decodeVeryfrontErrorData(
      descriptor.value,
      isProxyWithoutHooks,
    );
  } catch {
    return null;
  }
}
