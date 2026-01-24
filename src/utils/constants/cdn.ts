export const ESM_CDN_BASE = "https://esm.sh";
export const JSDELIVR_CDN_BASE = "https://cdn.jsdelivr.net";
export const DENO_STD_BASE = "https://deno.land";

export const REACT_VERSION_17 = "17.0.2";
export const REACT_VERSION_18_2 = "18.2.0";
export const REACT_VERSION_18_3 = "18.3.1";
export const REACT_VERSION_19_RC = "19.0.0-rc.0";
export const REACT_VERSION_19 = "19.1.1";

export const REACT_DEFAULT_VERSION = REACT_VERSION_19;

function getReactBase(version: string = REACT_DEFAULT_VERSION): string {
  return `${ESM_CDN_BASE}/react@${version}`;
}

function getReactDOMBase(version: string = REACT_DEFAULT_VERSION): string {
  return `${ESM_CDN_BASE}/react-dom@${version}`;
}

export function getReactCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return getReactBase(version);
}

export function getReactDOMCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return getReactDOMBase(version);
}

export function getReactDOMClientCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return `${getReactDOMBase(version)}/client`;
}

export function getReactDOMServerCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return `${getReactDOMBase(version)}/server`;
}

export function getReactJSXRuntimeCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return `${getReactBase(version)}/jsx-runtime`;
}

export function getReactJSXDevRuntimeCDNUrl(version: string = REACT_DEFAULT_VERSION): string {
  return `${getReactBase(version)}/jsx-dev-runtime`;
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
