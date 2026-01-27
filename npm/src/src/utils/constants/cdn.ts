export const ESM_CDN_BASE = "https://esm.sh";
export const JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
export const DENO_STD_BASE = "https://deno.land";

export const REACT_VERSION_17 = "17.0.2";
export const REACT_VERSION_18_2 = "18.2.0";
export const REACT_VERSION_18_3 = "18.3.1";
export const REACT_VERSION_19_RC = "19.0.0-rc.0";
export const REACT_VERSION_19 = "19.1.1";

export const REACT_DEFAULT_VERSION = REACT_VERSION_19;

// Re-export from package-registry.ts - the SINGLE SOURCE OF TRUTH for React URLs.
// This ensures all React URLs include deps=csstype and match exactly.
// DO NOT add duplicate URL builders here - use package-registry.ts instead.
import * as ReactRegistry from "../../transforms/esm/package-registry.js";

export const esmShReact = ReactRegistry.esmShReact;
export const getReactImportMap = ReactRegistry.getReactImportMap;
export const getReactUrls = ReactRegistry.getReactUrls;

// Named getters for convenience - delegate to ReactRegistry
export const getReactCDNUrl = (version = REACT_DEFAULT_VERSION) =>
  ReactRegistry.getReactUrls(version).react!;

export const getReactDOMCDNUrl = (version = REACT_DEFAULT_VERSION) =>
  ReactRegistry.getReactUrls(version)["react-dom"]!;

export const getReactDOMClientCDNUrl = (version = REACT_DEFAULT_VERSION) =>
  ReactRegistry.getReactUrls(version)["react-dom/client"]!;

export const getReactDOMServerCDNUrl = (version = REACT_DEFAULT_VERSION) =>
  ReactRegistry.getReactUrls(version)["react-dom/server"]!;

export const getReactJSXRuntimeCDNUrl = (version = REACT_DEFAULT_VERSION) =>
  ReactRegistry.getReactUrls(version)["react/jsx-runtime"]!;

export const getReactJSXDevRuntimeCDNUrl = (version = REACT_DEFAULT_VERSION) =>
  ReactRegistry.getReactUrls(version)["react/jsx-dev-runtime"]!;

export const DEFAULT_ALLOWED_CDN_HOSTS = [ESM_CDN_BASE, DENO_STD_BASE];

export const DENO_STD_VERSION = "0.220.0";

export function getDenoStdNodeBase(): string {
  return `${DENO_STD_BASE}/std@${DENO_STD_VERSION}/node`;
}

export const TAILWIND_VERSION = "4.1.8";

export function getTailwindCSSUrl(): string {
  return `${ESM_CDN_BASE}/tailwindcss@${TAILWIND_VERSION}/index.css`;
}

export { VERSION as VERYFRONT_VERSION } from "../version.js";
