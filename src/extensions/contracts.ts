/**
 * Contract registry — runtime resolution of extension-provided implementations.
 *
 * @module extensions/contracts
 */

import { MISSING_EXTENSION_ERROR } from "./errors.ts";
import { getRecommendation } from "./recommendations.ts";
import { assertCanonicalNonEmptyString } from "./runtime-validation.ts";
import {
  registerUnmanagedContract,
  resetContractRegistry,
  tryResolveRegisteredContract,
  unregisterContract,
} from "./contract-registry-internal.ts";

/** Resolve path segments to an absolute path. */
export function resolve<T>(name: string): T {
  assertCanonicalNonEmptyString(name, "Contract name");
  const impl = tryResolveRegisteredContract<T>(name);
  if (impl === undefined) {
    const recommendation = getRecommendation(name);
    const installCommand = recommendation === undefined
      ? undefined
      : `deno add npm:${recommendation}`;
    throw MISSING_EXTENSION_ERROR.create({
      message: installCommand
        ? `Missing extension for contract "${name}". Install it with: ${installCommand}`
        : `Missing extension for contract "${name}"`,
      detail: installCommand ? `Install it with: ${installCommand}` : undefined,
    });
  }
  return impl;
}

/** Try to resolve. */
export function tryResolve<T>(name: string): T | undefined {
  assertCanonicalNonEmptyString(name, "Contract name");
  return tryResolveRegisteredContract<T>(name);
}

/** Register. */
export function register<T>(name: string, impl: T): void {
  assertCanonicalNonEmptyString(name, "Contract name");
  if (impl === undefined) {
    throw new TypeError(`Contract "${name}" implementation must not be undefined`);
  }
  registerUnmanagedContract(name, impl);
}

/** Unregister. */
export function unregister(name: string): void {
  assertCanonicalNonEmptyString(name, "Contract name");
  unregisterContract(name);
}

/** Reset. */
export function reset(): void {
  resetContractRegistry();
}
