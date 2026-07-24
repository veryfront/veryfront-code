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

const projectEnvStorage = new AsyncLocalStorage<ProjectEnvSnapshot>();

/**
 * Run a function with project-specific environment variables.
 * Within the callback, `getProjectEnv()` will return values from `vars`.
 */
export function runWithProjectEnv<T>(
  vars: Readonly<Record<string, string>>,
  fn: () => T,
): T {
  return projectEnvStorage.run(createProjectEnvSnapshot(vars), fn);
}

/**
 * Get a project-scoped environment variable from the current request context.
 * Returns undefined if no project env overlay is active or key is not present.
 */
export function getProjectEnv(key: string): string | undefined {
  return projectEnvStorage.getStore()?.[key];
}

/**
 * Check whether a project env overlay is currently active.
 * When true, getEnv() should NOT fall through to host process env
 * to prevent remote projects from reading host-level secrets.
 */
export function isProjectEnvActive(): boolean {
  return projectEnvStorage.getStore() !== undefined;
}

/**
 * Get a snapshot of the current project env overlay.
 * Returns undefined if no overlay is active.
 * Used to forward env vars to isolated workers in proxy mode.
 */
export function getProjectEnvSnapshot(): ProjectEnvSnapshot | undefined {
  return projectEnvStorage.getStore();
}

registerTrustedProjectEnvSnapshot(getProjectEnvSnapshot);

// Preserve the two legacy lookup bridges still consumed by lower-level
// process compatibility code. Worker snapshotting uses the trusted
// closure-registration bridge above and is never published as mutable global
// state.
(globalThis as Record<string, unknown>).__vfProjectEnvGetter = getProjectEnv;
(globalThis as Record<string, unknown>).__vfProjectEnvActiveChecker = isProjectEnvActive;
