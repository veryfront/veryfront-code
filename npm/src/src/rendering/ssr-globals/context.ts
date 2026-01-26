/**
 * SSR Context State
 * @module rendering/ssr-globals/context
 */
import * as dntShim from "../../../_dnt.shims.js";


let ssrGlobalsInitialized = false;
let ssrServerPort: number | null = null;
let ssrProjectDomain: string | null = null;
let ssrClientOnlyFetching = false;

export const originalFetch = dntShim.dntGlobalThis.fetch;

export function isSSRGlobalsActive(): boolean {
  return ssrGlobalsInitialized;
}

export function markSSRGlobalsInitialized(): void {
  ssrGlobalsInitialized = true;
}

export function getSSRServerPort(): number | null {
  return ssrServerPort;
}

export function setSSRServerPort(port: number): void {
  ssrServerPort = port;
}

export function getSSRProjectDomain(): string | null {
  return ssrProjectDomain;
}

export function setSSRProjectDomain(domain: string | null): void {
  ssrProjectDomain = domain;
}

export function isSSRClientOnlyFetching(): boolean {
  return ssrClientOnlyFetching;
}

export function enableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = true;
}

export function disableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = false;
}

export function resetSSRGlobalsState(): void {
  ssrGlobalsInitialized = false;
  ssrServerPort = null;
  ssrProjectDomain = null;
  ssrClientOnlyFetching = false;
}
