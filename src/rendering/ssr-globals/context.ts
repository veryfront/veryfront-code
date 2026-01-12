/**
 * SSR Context State
 * @module rendering/ssr-globals/context
 */

// Track if globals have been set up
let ssrGlobalsInitialized = false;

// Track SSR server port and project domain for fetch rewriting
let ssrServerPort: number | null = null;
let ssrProjectDomain: string | null = null;
let ssrClientOnlyFetching = false;

// Store original fetch for restoration
export const originalFetch = globalThis.fetch;

/**
 * Check if SSR globals are active
 */
export function isSSRGlobalsActive(): boolean {
  return ssrGlobalsInitialized;
}

/**
 * Mark SSR globals as initialized
 */
export function markSSRGlobalsInitialized(): void {
  ssrGlobalsInitialized = true;
}

/**
 * Get the SSR server port
 */
export function getSSRServerPort(): number | null {
  return ssrServerPort;
}

/**
 * Set the SSR server port for fetch URL rewriting.
 * Called by the dev server when starting.
 */
export function setSSRServerPort(port: number): void {
  ssrServerPort = port;
}

/**
 * Get the current project domain
 */
export function getSSRProjectDomain(): string | null {
  return ssrProjectDomain;
}

/**
 * Set the current project domain for fetch URL rewriting.
 * Called during SSR request handling.
 */
export function setSSRProjectDomain(domain: string | null): void {
  ssrProjectDomain = domain;
}

/**
 * Check if client-only fetching is enabled
 */
export function isSSRClientOnlyFetching(): boolean {
  return ssrClientOnlyFetching;
}

/**
 * Enable client-only fetching mode.
 * When enabled, API fetches (starting with /api/) during SSR return
 * promises that never resolve, causing React Query to suspend and
 * render fallbacks. This prevents hydration mismatches.
 */
export function enableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = true;
}

/**
 * Disable client-only fetching mode.
 */
export function disableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = false;
}
