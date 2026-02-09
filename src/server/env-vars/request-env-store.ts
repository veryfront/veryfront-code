/**
 * Request-Scoped Environment Variable Store
 *
 * Uses AsyncLocalStorage to provide per-request environment variable isolation.
 * Each API route request runs within its own context, ensuring multi-tenant safety.
 *
 * @module server/env-vars/request-env-store
 */

import { AsyncLocalStorage } from "node:async_hooks";

const envStore = new AsyncLocalStorage<Record<string, string>>();

/**
 * Run a function with request-scoped environment variables.
 * The provided vars are available via getRequestEnv() within the callback
 * and any async operations it initiates.
 */
export function runWithEnv<T>(vars: Record<string, string>, fn: () => T): T {
  return envStore.run(vars, fn);
}

/**
 * Get a request-scoped environment variable.
 * Returns undefined if not in a request context or if the key doesn't exist.
 */
export function getRequestEnv(key: string): string | undefined {
  return envStore.getStore()?.[key];
}
