/**
 * SSR Context State
 * @module rendering/ssr-globals/context
 *
 * These are process-wide globals set ONCE at server startup.
 * They are NOT per-request state. Do not call setters from request handlers.
 * In production, each pod runs a single server instance, so setters are
 * naturally called once. In tests, multiple servers may share a process —
 * call {@link resetSSRGlobalsState} between tests to avoid stale state.
 */

let ssrGlobalsInitialized = false;
let ssrServerPort: number | null = null;
let ssrProjectDomain: string | null = null;
let ssrClientOnlyFetching = false;

export const originalFetch = globalThis.fetch;

export function isSSRGlobalsActive(): boolean {
  return ssrGlobalsInitialized;
}

export function markSSRGlobalsInitialized(): void {
  ssrGlobalsInitialized = true;
}

export function getSSRServerPort(): number | null {
  return ssrServerPort;
}

/**
 * Set the SSR server port. Intended to be called once at server startup.
 * In production each pod has one server, so this is naturally called once.
 * In tests multiple servers may start in the same process with different
 * ports — the last value wins, which is correct for test isolation.
 */
export function setSSRServerPort(port: number): void {
  ssrServerPort = port;
}

/**
 * Clear the process-wide server port owned by a retiring server generation.
 * When `expectedPort` is provided, a stale cleanup cannot erase a newer value.
 */
export function clearSSRServerPort(expectedPort?: number): boolean {
  if (expectedPort !== undefined && ssrServerPort !== expectedPort) return false;
  const changed = ssrServerPort !== null;
  ssrServerPort = null;
  return changed;
}

export function getSSRProjectDomain(): string | null {
  return ssrProjectDomain;
}

export function isSSRClientOnlyFetching(): boolean {
  return ssrClientOnlyFetching;
}

/**
 * Enable client-only fetching mode. Intended to be called once at server startup.
 * Idempotent — subsequent calls are no-ops (safe for test restarts).
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
