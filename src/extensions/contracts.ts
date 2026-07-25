/**
 * Contract registry — runtime resolution of extension-provided implementations.
 *
 * @module extensions/contracts
 */

import { MISSING_EXTENSION_ERROR } from "./errors.ts";
import { getRecommendation } from "./recommendations.ts";
import { assertCanonicalNonEmptyString } from "./runtime-validation.ts";

const contracts = new Map<string, unknown>();

/** Resolve path segments to an absolute path. */
export function resolve<T>(name: string): T {
  assertCanonicalNonEmptyString(name, "Contract name");
  const impl = contracts.get(name);
  if (impl === undefined) {
    const recommendation = getRecommendation(name);
    throw MISSING_EXTENSION_ERROR.create({
      message: recommendation
        ? `Missing extension for contract "${name}". Install it with: deno add ${recommendation}`
        : `Missing extension for contract "${name}"`,
      detail: recommendation ? `Install it with: deno add ${recommendation}` : undefined,
    });
  }
  return impl as T;
}

/** Try to resolve. */
export function tryResolve<T>(name: string): T | undefined {
  assertCanonicalNonEmptyString(name, "Contract name");
  return contracts.get(name) as T | undefined;
}

/** Register. */
export function register<T>(name: string, impl: T): void {
  assertCanonicalNonEmptyString(name, "Contract name");
  if (impl === undefined) {
    throw new TypeError(`Contract "${name}" implementation must not be undefined`);
  }
  contracts.set(name, impl);
}

/** Unregister. */
export function unregister(name: string): void {
  assertCanonicalNonEmptyString(name, "Contract name");
  contracts.delete(name);
}

/** Reset. */
export function reset(): void {
  contracts.clear();
}
