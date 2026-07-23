/**
 * Contract registry for runtime resolution of extension-provided implementations.
 *
 * @module extensions/contracts
 */

import { EXTENSION_VALIDATION_ERROR, MISSING_EXTENSION_ERROR } from "./errors.ts";
import { identifierIssue, MAX_CONTRACT_NAME_LENGTH } from "./identifiers.ts";
import { getRecommendation } from "./recommendations.ts";
import {
  clearRegisteredContracts,
  deleteRegisteredContract,
  getRegisteredContract,
  getRegisteredContractCount,
  hasRegisteredContract,
  setRegisteredContract,
} from "./contract-registry-state.ts";

const MAX_REGISTERED_CONTRACTS = 4_096;

function assertContractName(name: unknown): asserts name is string {
  const issue = identifierIssue(name, MAX_CONTRACT_NAME_LENGTH);
  if (issue) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Contract name ${issue}`,
    });
  }
}

/** Resolve path segments to an absolute path. */
export function resolve<T>(name: string): T {
  assertContractName(name);
  const impl = getRegisteredContract(name);
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
  assertContractName(name);
  return getRegisteredContract(name) as T | undefined;
}

/** Register. */
export function register<T>(name: string, impl: T): void {
  assertContractName(name);
  if (impl === undefined) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Contract implementation cannot be undefined",
    });
  }
  if (
    !hasRegisteredContract(name) &&
    getRegisteredContractCount() >= MAX_REGISTERED_CONTRACTS
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `You can register at most ${MAX_REGISTERED_CONTRACTS} extension contracts`,
    });
  }
  setRegisteredContract(name, impl);
}

/** Unregister. */
export function unregister(name: string): void {
  assertContractName(name);
  deleteRegisteredContract(name);
}

/** Reset. */
export function reset(): void {
  clearRegisteredContracts();
}
