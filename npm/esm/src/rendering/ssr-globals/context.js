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
import * as dntShim from "../../../_dnt.shims.js";
let ssrGlobalsInitialized = false;
let ssrServerPort = null;
let ssrProjectDomain = null;
let ssrClientOnlyFetching = false;
export const originalFetch = dntShim.dntGlobalThis.fetch;
export function isSSRGlobalsActive() {
    return ssrGlobalsInitialized;
}
export function markSSRGlobalsInitialized() {
    ssrGlobalsInitialized = true;
}
export function getSSRServerPort() {
    return ssrServerPort;
}
/**
 * Set the SSR server port. Intended to be called once at server startup.
 * In production each pod has one server, so this is naturally called once.
 * In tests multiple servers may start in the same process with different
 * ports — the last value wins, which is correct for test isolation.
 */
export function setSSRServerPort(port) {
    ssrServerPort = port;
}
export function getSSRProjectDomain() {
    return ssrProjectDomain;
}
/**
 * @deprecated Not called from any active code path. The getter is used by the
 * fetch interceptor but always returns null. If per-project domain rewriting is
 * needed, pass the domain through RenderContext instead.
 */
export function setSSRProjectDomain(domain) {
    ssrProjectDomain = domain;
}
export function isSSRClientOnlyFetching() {
    return ssrClientOnlyFetching;
}
/**
 * Enable client-only fetching mode. Intended to be called once at server startup.
 * Idempotent — subsequent calls are no-ops (safe for test restarts).
 */
export function enableSSRClientOnlyFetching() {
    ssrClientOnlyFetching = true;
}
export function disableSSRClientOnlyFetching() {
    ssrClientOnlyFetching = false;
}
/**
 * Reset all SSR globals state. Used in tests only.
 * @internal
 */
export function resetSSRGlobalsState() {
    ssrGlobalsInitialized = false;
    ssrServerPort = null;
    ssrProjectDomain = null;
    ssrClientOnlyFetching = false;
}
