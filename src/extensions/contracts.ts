/**
 * Contract registry — runtime resolution of extension-provided implementations.
 *
 * @module extensions/contracts
 */

import { MISSING_EXTENSION_ERROR } from "./errors.ts";
import { getRecommendation } from "./recommendations.ts";

const contracts = new Map<string, unknown>();

export function resolve<T>(name: string): T {
  const impl = contracts.get(name);
  if (impl === undefined) {
    const recommendation = getRecommendation(name);
    throw MISSING_EXTENSION_ERROR.create({
      message: `Missing extension for contract "${name}"${
        recommendation ? `. Recommended: ${recommendation}` : ""
      }`,
      detail: recommendation ? `Install it with: deno add ${recommendation}` : undefined,
    });
  }
  return impl as T;
}

export function tryResolve<T>(name: string): T | undefined {
  return contracts.get(name) as T | undefined;
}

export function register<T>(name: string, impl: T): void {
  contracts.set(name, impl);
}

export function reset(): void {
  contracts.clear();
}
