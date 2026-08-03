import { AsyncLocalStorage } from "node:async_hooks";
import {
  consumeVerifiedControlPlaneCacheCredential,
  type VerifiedControlPlaneCacheCredential,
  type VerifiedControlPlaneRequestClaims,
} from "#veryfront/internal-agents/control-plane-auth.ts";

const verifiedCredentialStorage = new AsyncLocalStorage<
  VerifiedControlPlaneCacheCredential | null
>();

/**
 * Runs framework work with the exact cache API credential from a verified
 * control-plane request body. Keep this helper on internal import surfaces.
 */
export function runWithVerifiedCacheApiCredential<T>(
  claims: VerifiedControlPlaneRequestClaims,
  fn: () => T,
): T {
  return verifiedCredentialStorage.run(
    consumeVerifiedControlPlaneCacheCredential(claims),
    fn,
  );
}

export function getVerifiedCacheApiCredential():
  | VerifiedControlPlaneCacheCredential
  | undefined {
  return verifiedCredentialStorage.getStore() || undefined;
}
