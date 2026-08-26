import { AsyncLocalStorage } from "node:async_hooks";
import {
  consumeVerifiedControlPlaneCacheCredential,
  type VerifiedControlPlaneCacheCredential,
  type VerifiedControlPlaneRequestClaims,
} from "#veryfront/internal-agents/control-plane-auth.ts";

const verifiedCredentialStorage = new AsyncLocalStorage<
  VerifiedControlPlaneCacheCredential | null
>();
const IntrinsicReflectApply = Reflect.apply;
const AsyncLocalStoragePrototypeRun = AsyncLocalStorage.prototype.run;
const AsyncLocalStoragePrototypeGetStore = AsyncLocalStorage.prototype.getStore;

function runWithCredentialStore<T>(
  store: VerifiedControlPlaneCacheCredential | null,
  fn: () => T,
): T {
  return IntrinsicReflectApply(AsyncLocalStoragePrototypeRun, verifiedCredentialStorage, [
    store,
    fn,
  ]) as T;
}

/**
 * Runs framework work with the exact cache API credential from a verified
 * control-plane request body. Keep this helper on internal import surfaces.
 */
export function runWithVerifiedCacheApiCredential<T>(
  claims: VerifiedControlPlaneRequestClaims,
  fn: () => T,
): T {
  return runWithCredentialStore(consumeVerifiedControlPlaneCacheCredential(claims), fn);
}

/** Wraps project-authored work so it cannot inherit a verified user credential. */
export function withoutVerifiedCacheApiCredential<T>(fn: () => T): () => T {
  return () => runWithCredentialStore(null, fn);
}

export function getVerifiedCacheApiCredential():
  | VerifiedControlPlaneCacheCredential
  | undefined {
  return IntrinsicReflectApply(
    AsyncLocalStoragePrototypeGetStore,
    verifiedCredentialStorage,
    [],
  ) || undefined;
}
