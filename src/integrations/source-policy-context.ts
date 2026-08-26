import { AsyncLocalStorage } from "node:async_hooks";
import {
  intersectSourceIntegrationPolicies,
  resolveSourceIntegrationPolicyManifest,
  type SourceIntegrationPolicyManifest,
} from "./source-policy.ts";

const sourceIntegrationPolicyStorage = new AsyncLocalStorage<SourceIntegrationPolicyManifest>();
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const AsyncLocalStoragePrototype = AsyncLocalStorage.prototype;
const AsyncLocalStorageDisable = AsyncLocalStoragePrototype.disable;
const AsyncLocalStorageEnterWith = AsyncLocalStoragePrototype.enterWith;
const AsyncLocalStorageGetStore = AsyncLocalStoragePrototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStoragePrototype.run;
IntrinsicObjectDefineProperty(sourceIntegrationPolicyStorage, "disable", {
  configurable: false,
  value: AsyncLocalStorageDisable,
  writable: false,
});
IntrinsicObjectDefineProperty(sourceIntegrationPolicyStorage, "enterWith", {
  configurable: false,
  value: AsyncLocalStorageEnterWith,
  writable: false,
});
IntrinsicObjectDefineProperty(sourceIntegrationPolicyStorage, "getStore", {
  configurable: false,
  value: AsyncLocalStorageGetStore,
  writable: false,
});
IntrinsicObjectDefineProperty(sourceIntegrationPolicyStorage, "run", {
  configurable: false,
  value: AsyncLocalStorageRun,
  writable: false,
});

/** Return the restriction established for the exact project source executing this run. */
export function getActiveSourceIntegrationPolicy():
  | SourceIntegrationPolicyManifest
  | undefined {
  return IntrinsicReflectApply(
    AsyncLocalStorageGetStore,
    sourceIntegrationPolicyStorage,
    [],
  ) as SourceIntegrationPolicyManifest | undefined;
}

/** Require the exact-source policy before crossing an isolated execution boundary. */
export function requireActiveSourceIntegrationPolicy(): SourceIntegrationPolicyManifest {
  const policy = getActiveSourceIntegrationPolicy();
  if (!policy) {
    throw new Error("Isolated project execution requires an exact source integration policy");
  }
  return policy;
}

/**
 * Establish the policy belonging to an exact source target.
 *
 * Nested exact-source selection replaces the outer source. Runtime boundary
 * manifests are intersected separately by `resolveEffectiveSourceIntegrationPolicy`.
 */
export function runWithExactSourceIntegrationPolicy<T>(
  policy: SourceIntegrationPolicyManifest,
  fn: () => T,
): T {
  return IntrinsicReflectApply(AsyncLocalStorageRun, sourceIntegrationPolicyStorage, [
    policy,
    fn,
  ]) as T;
}

/** Resolve the one effective restriction consumed by an agent runtime. */
export function resolveEffectiveSourceIntegrationPolicy(
  explicitBoundaryPolicy: unknown,
): SourceIntegrationPolicyManifest | undefined {
  const activeSourcePolicy = getActiveSourceIntegrationPolicy();
  const boundaryPolicy = resolveSourceIntegrationPolicyManifest(explicitBoundaryPolicy);

  if (!activeSourcePolicy) return boundaryPolicy;
  if (!boundaryPolicy) return activeSourcePolicy;
  return intersectSourceIntegrationPolicies(activeSourcePolicy, boundaryPolicy);
}

/** Run a nested operation without allowing its explicit policy to widen the active source. */
export function runWithEffectiveSourceIntegrationPolicy<T>(
  explicitBoundaryPolicy: unknown,
  fn: () => T,
): T {
  const effectivePolicy = resolveEffectiveSourceIntegrationPolicy(explicitBoundaryPolicy);
  return effectivePolicy === undefined
    ? fn()
    : runWithExactSourceIntegrationPolicy(effectivePolicy, fn);
}
