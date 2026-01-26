/**
 * SSR Context State
 * @module rendering/ssr-globals/context
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
export function setSSRServerPort(port) {
    ssrServerPort = port;
}
export function getSSRProjectDomain() {
    return ssrProjectDomain;
}
export function setSSRProjectDomain(domain) {
    ssrProjectDomain = domain;
}
export function isSSRClientOnlyFetching() {
    return ssrClientOnlyFetching;
}
export function enableSSRClientOnlyFetching() {
    ssrClientOnlyFetching = true;
}
export function disableSSRClientOnlyFetching() {
    ssrClientOnlyFetching = false;
}
export function resetSSRGlobalsState() {
    ssrGlobalsInitialized = false;
    ssrServerPort = null;
    ssrProjectDomain = null;
    ssrClientOnlyFetching = false;
}
