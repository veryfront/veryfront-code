/**
 * SSR Context State
 * @module rendering/ssr-globals/context
 *
 * Startup defaults remain process-wide for compatibility. Production request
 * handlers use AsyncLocalStorage settings so concurrent server instances do
 * not overwrite one another's port or client-only fetching behavior.
 */

import { AsyncLocalStorage } from "#veryfront/platform/compat/async-local-storage.ts";

export interface SSRRequestGlobals {
  clientOnlyFetching: boolean;
  serverPort: number;
}

let ssrGlobalsInitialized = false;
let ssrServerPort: number | null = null;
let ssrProjectDomain: string | null = null;
let ssrClientOnlyFetching = false;
const ssrRequestGlobals = new AsyncLocalStorage<SSRRequestGlobals>();

export const originalFetch = globalThis.fetch;

export function isSSRGlobalsActive(): boolean {
  return ssrGlobalsInitialized;
}

export function markSSRGlobalsInitialized(): void {
  ssrGlobalsInitialized = true;
}

export function getSSRServerPort(): number | null {
  return ssrRequestGlobals.getStore()?.serverPort ?? ssrServerPort;
}

/** Run one request with server-specific SSR settings. */
export function runWithSSRRequestGlobals<T>(
  globals: SSRRequestGlobals,
  callback: () => T,
): T {
  const serverPort = globals.serverPort;
  const clientOnlyFetching = globals.clientOnlyFetching;
  if (
    !Number.isInteger(serverPort) || serverPort < 0 ||
    serverPort > 65_535
  ) {
    throw new TypeError("SSR server port must be an integer between 0 and 65535");
  }
  if (typeof clientOnlyFetching !== "boolean") {
    throw new TypeError("SSR client-only fetching flag must be a boolean");
  }
  if (typeof callback !== "function") {
    throw new TypeError("SSR request globals callback must be a function");
  }
  return ssrRequestGlobals.run({ clientOnlyFetching, serverPort }, callback);
}

/**
 * Set the process-wide fallback SSR server port.
 * Request-scoped settings take precedence when present.
 */
export function setSSRServerPort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("SSR server port must be an integer between 0 and 65535");
  }
  ssrServerPort = port;
}

export function getSSRProjectDomain(): string | null {
  return ssrProjectDomain;
}

export function isSSRClientOnlyFetching(): boolean {
  return ssrRequestGlobals.getStore()?.clientOnlyFetching ?? ssrClientOnlyFetching;
}

/**
 * Enable client-only fetching mode. Intended to be called once at server startup.
 * Idempotent. Subsequent calls are no-ops and are safe for test restarts.
 */
export function enableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = true;
}

export function disableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = false;
}

/**
 * Reset all SSR globals state. Used in tests only.
 * @internal
 */
export function resetSSRGlobalsState(): void {
  ssrGlobalsInitialized = false;
  ssrServerPort = null;
  ssrProjectDomain = null;
  ssrClientOnlyFetching = false;
}
