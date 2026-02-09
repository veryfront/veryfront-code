/**
 * Per-request environment variable overlay using AsyncLocalStorage.
 *
 * Allows each request to have its own set of environment variables
 * without leaking between concurrent requests.
 *
 * @module server/project-env/storage
 */

import { AsyncLocalStorage } from "node:async_hooks";

const projectEnvStorage = new AsyncLocalStorage<Record<string, string>>();

/**
 * Run a function with project-specific environment variables.
 * Within the callback, `getProjectEnv()` will return values from `vars`.
 */
export function runWithProjectEnv<T>(vars: Record<string, string>, fn: () => T): T {
  return projectEnvStorage.run(vars, fn);
}

/**
 * Get a project-scoped environment variable from the current request context.
 * Returns undefined if no project env overlay is active.
 */
export function getProjectEnv(key: string): string | undefined {
  return projectEnvStorage.getStore()?.[key];
}

// Register on globalThis so process.ts can access without circular imports.
// process.ts is low-level (platform/compat), project-env is high-level (server/).
(globalThis as Record<string, unknown>).__vfProjectEnvGetter = getProjectEnv;
