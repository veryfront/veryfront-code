/**
 * Per-request environment variable overlay using AsyncLocalStorage.
 *
 * Allows each request to have its own set of environment variables
 * without leaking between concurrent requests.
 *
 * @module server/project-env/storage
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { registerTrustedProjectEnvSnapshot } from "#veryfront/platform/compat/process/env.ts";
import { createProjectEnvSnapshot, type ProjectEnvSnapshot } from "./snapshot.ts";

export interface TrustedProjectEnvIdentity {
  projectId?: string;
  projectSlug?: string;
  environmentId?: string;
}

interface ProjectEnvStore {
  snapshot: ProjectEnvSnapshot;
  identity?: Readonly<TrustedProjectEnvIdentity>;
}

const projectEnvStorage = new AsyncLocalStorage<ProjectEnvStore>();
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const IntrinsicObjectFreeze = Object.freeze;
const AsyncLocalStoragePrototype = AsyncLocalStorage.prototype;
const AsyncLocalStorageDisable = AsyncLocalStoragePrototype.disable;
const AsyncLocalStorageEnterWith = AsyncLocalStoragePrototype.enterWith;
const AsyncLocalStorageGetStore = AsyncLocalStoragePrototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStoragePrototype.run;

IntrinsicObjectDefineProperty(projectEnvStorage, "disable", {
  configurable: false,
  value: AsyncLocalStorageDisable,
  writable: false,
});
IntrinsicObjectDefineProperty(projectEnvStorage, "enterWith", {
  configurable: false,
  value: AsyncLocalStorageEnterWith,
  writable: false,
});
IntrinsicObjectDefineProperty(projectEnvStorage, "getStore", {
  configurable: false,
  value: AsyncLocalStorageGetStore,
  writable: false,
});
IntrinsicObjectDefineProperty(projectEnvStorage, "run", {
  configurable: false,
  value: AsyncLocalStorageRun,
  writable: false,
});

function getProjectEnvStore(): ProjectEnvStore | undefined {
  return IntrinsicReflectApply(AsyncLocalStorageGetStore, projectEnvStorage, []) as
    | ProjectEnvStore
    | undefined;
}

/**
 * Run a function with project-specific environment variables.
 * Within the callback, `getProjectEnv()` will return values from `vars`.
 */
export function runWithProjectEnv<T>(
  vars: Readonly<Record<string, string>>,
  fn: () => T,
): T {
  return IntrinsicReflectApply(AsyncLocalStorageRun, projectEnvStorage, [
    { snapshot: createProjectEnvSnapshot(vars) },
    fn,
  ]) as T;
}

/** Run with project env values plus identity resolved at the authenticated runtime boundary. */
export function runWithTrustedProjectEnv<T>(
  vars: Readonly<Record<string, string>>,
  identity: TrustedProjectEnvIdentity,
  fn: () => T,
): T {
  return IntrinsicReflectApply(AsyncLocalStorageRun, projectEnvStorage, [
    {
      snapshot: createProjectEnvSnapshot(vars),
      identity: IntrinsicObjectFreeze({ ...identity }),
    },
    fn,
  ]) as T;
}

/** Return only the runtime-owned identity, never project-provided environment values. */
export function getTrustedProjectEnvIdentity(): Readonly<TrustedProjectEnvIdentity> | undefined {
  return getProjectEnvStore()?.identity;
}

/**
 * Get a project-scoped environment variable from the current request context.
 * Returns undefined if no project env overlay is active or key is not present.
 */
export function getProjectEnv(key: string): string | undefined {
  return getProjectEnvStore()?.snapshot[key];
}

/**
 * Check whether a project env overlay is currently active.
 * When true, getEnv() should NOT fall through to host process env
 * to prevent remote projects from reading host-level secrets.
 */
export function isProjectEnvActive(): boolean {
  return getProjectEnvStore() !== undefined;
}

/**
 * Get a snapshot of the current project env overlay.
 * Returns undefined if no overlay is active.
 * Used to forward env vars to isolated workers in proxy mode.
 */
export function getProjectEnvSnapshot(): ProjectEnvSnapshot | undefined {
  return getProjectEnvStore()?.snapshot;
}

registerTrustedProjectEnvSnapshot(getProjectEnvSnapshot);

// Preserve the legacy lookup bridges used by the compiled-binary runtime shim
// and the snapshot bridge used by isolated route workers. Host process
// compatibility code uses the trusted closure-registration bridge above and
// never relies on mutable global state for project isolation.
(globalThis as Record<string, unknown>).__vfProjectEnvGetter = getProjectEnv;
(globalThis as Record<string, unknown>).__vfProjectEnvActiveChecker = isProjectEnvActive;
(globalThis as Record<string, unknown>).__vfProjectEnvSnapshotGetter = getProjectEnvSnapshot;
