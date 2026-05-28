export const ESM_CDN_BASE = "https://esm.sh";
export const JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
export const DENO_STD_BASE = "https://deno.land";

export const REACT_VERSION_17 = "17.0.2";
export const REACT_VERSION_18_2 = "18.2.0";
export const REACT_VERSION_18_3 = "18.3.1";
export const REACT_VERSION_19_RC = "19.0.0-rc.0";
export const REACT_VERSION_19 = "19.2.4";

/** Shared React default version value. */
export const REACT_DEFAULT_VERSION = REACT_VERSION_19;

import {
  buildReactUrl,
  getReactImportMap as buildReactImportMap,
  TAILWIND_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";

export function esmShReact(
  pkg: string,
  version: string,
  path = "",
  external = false,
): string {
  return buildReactUrl(
    pkg as "react" | "react-dom",
    version,
    path || undefined,
    external,
  );
}

export function getReactUrls(version = REACT_DEFAULT_VERSION): Record<string, string> {
  return {
    react: buildReactUrl("react", version),
    "react-dom": buildReactUrl("react-dom", version, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", version, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", version, "/server", true),
    "react/jsx-runtime": buildReactUrl("react", version, "/jsx-runtime", true),
    "react/jsx-dev-runtime": buildReactUrl("react", version, "/jsx-dev-runtime", true),
  };
}

/** Return React import map. */
export function getReactImportMap(version = REACT_DEFAULT_VERSION): Record<string, string> {
  return buildReactImportMap(version);
}

export function getReactCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version).react!;
}

export function getReactDOMCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react-dom"]!;
}

export function getReactDOMClientCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react-dom/client"]!;
}

export function getReactDOMServerCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react-dom/server"]!;
}

export function getReactJSXRuntimeCDNUrl(version = REACT_DEFAULT_VERSION): string {
  return getReactUrls(version)["react/jsx-runtime"]!;
}

export function getReactJSXDevRuntimeCDNUrl(
  version = REACT_DEFAULT_VERSION,
): string {
  return getReactUrls(version)["react/jsx-dev-runtime"]!;
}

/** Default value for allowed cdn hosts. */
export const DEFAULT_ALLOWED_CDN_HOSTS = [ESM_CDN_BASE, DENO_STD_BASE];

export const DENO_STD_VERSION = "0.220.0";

/** Return Deno std node base. */
export function getDenoStdNodeBase(): string {
  return `${DENO_STD_BASE}/std@${DENO_STD_VERSION}/node`;
}

export { TAILWIND_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";

export function getTailwindCSSUrl(): string {
  return `${ESM_CDN_BASE}/tailwindcss@${TAILWIND_VERSION}/index.css`;
}

export { VERSION as VERYFRONT_VERSION } from "../version-constant.ts";
