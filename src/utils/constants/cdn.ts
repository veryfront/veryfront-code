export const ESM_CDN_BASE = "https://esm.sh";
export const JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
export const DENO_STD_BASE = "https://deno.land";

export const REACT_VERSION_17 = "17.0.2";
export const REACT_VERSION_18_2 = "18.2.0";
export const REACT_VERSION_18_3 = "18.3.1";
export const REACT_VERSION_19_RC = "19.0.0-rc.0";
export const REACT_VERSION_19 = "19.1.1";

export const REACT_DEFAULT_VERSION = REACT_VERSION_19;

/**
 * esm.sh URL builder with consistent query params.
 *
 * For React packages (react-dom, jsx-runtime), we only need external=react:
 * - react-dom depends on react → external=react makes it import "react" as bare specifier
 * - react-dom doesn't need external=react-dom because it IS react-dom
 * - jsx-runtime depends on react core → external=react
 *
 * Third-party packages (e.g., @tanstack/react-query) need external=react,react-dom
 * because they may depend on BOTH. That's handled by bundleHttpImports() separately.
 */
function esmSh(pkg: string, version: string, path = "", external = false): string {
  const params = ["target=es2022"];
  if (external) params.push("external=react");
  return `${ESM_CDN_BASE}/${pkg}@${version}${path}?${params.join("&")}`;
}

export function getReactCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return esmSh("react", version);
}

export function getReactDOMCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return esmSh("react-dom", version, "", true);
}

export function getReactDOMClientCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return esmSh("react-dom", version, "/client", true);
}

export function getReactDOMServerCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return esmSh("react-dom", version, "/server", true);
}

export function getReactJSXRuntimeCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return esmSh("react", version, "/jsx-runtime", true);
}

export function getReactJSXDevRuntimeCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return esmSh("react", version, "/jsx-dev-runtime", true);
}

export function getReactImportMap(version: string = REACT_DEFAULT_VERSION): Record<string, string> {
  return {
    react: getReactCDNUrl(version),
    "react-dom": getReactDOMCDNUrl(version),
    "react-dom/client": getReactDOMClientCDNUrl(version),
    "react-dom/server": getReactDOMServerCDNUrl(version),
    "react/jsx-runtime": getReactJSXRuntimeCDNUrl(version),
    "react/jsx-dev-runtime": getReactJSXDevRuntimeCDNUrl(version),
  };
}

export const DEFAULT_ALLOWED_CDN_HOSTS = [ESM_CDN_BASE, DENO_STD_BASE];

export const DENO_STD_VERSION = "0.220.0";

export function getDenoStdNodeBase(): string {
  return `${DENO_STD_BASE}/std@${DENO_STD_VERSION}/node`;
}

export const TAILWIND_VERSION = "4.1.8";

export function getTailwindCSSUrl(): string {
  return `${ESM_CDN_BASE}/tailwindcss@${TAILWIND_VERSION}/index.css`;
}

export { VERSION as VERYFRONT_VERSION } from "../version.ts";
