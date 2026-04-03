import {
  getReactCDNUrl,
  getReactDOMClientCDNUrl,
  REACT_DEFAULT_VERSION,
} from "#veryfront/utils/constants/cdn.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import {
  getDocumentImportMapImports,
  importMapOwnsSpecifier,
} from "#veryfront/utils/import-map.ts";
import { FS_PATH_PREFIX, HYDRATION_DATA_ID, RSC_PATH_PREFIX } from "./constants.ts";

export type ClientModuleStrategy = "fs" | "rsc-module";

export interface ClientModuleStrategyOptions {
  isLocalProject?: boolean;
  environment?: "preview" | "production";
}

export interface ClientRuntimeHydrationData {
  pagePath?: string;
  clientModuleStrategy?: ClientModuleStrategy;
  dev?: boolean;
}

export interface ClientModuleUrlOptions {
  strategy: ClientModuleStrategy;
  rel: string;
  absPath?: string;
  version?: string;
}

export function determineClientModuleStrategy(
  options: ClientModuleStrategyOptions,
): ClientModuleStrategy {
  return options.isLocalProject || options.environment === "preview" ? "fs" : "rsc-module";
}

export function readHydrationData(
  doc: Document = document,
): ClientRuntimeHydrationData | null {
  try {
    const el = doc.getElementById(HYDRATION_DATA_ID);
    if (!el) return null;
    return JSON.parse(el.textContent || "{}") as ClientRuntimeHydrationData;
  } catch (e) {
    console.debug?.("[RSC] hydration data parse failed", e);
    return null;
  }
}

export function resolveClientModuleStrategy(
  hydrationData: ClientRuntimeHydrationData | null,
): ClientModuleStrategy {
  if (hydrationData?.clientModuleStrategy) {
    return hydrationData.clientModuleStrategy;
  }

  return hydrationData?.dev ? "fs" : "rsc-module";
}

export function buildFsClientModuleUrl(path: string): string {
  return `${FS_PATH_PREFIX}${base64urlEncode(path)}.js`;
}

export function buildRSCModuleUrl(rel: string, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : "";
  return `${RSC_PATH_PREFIX}module?rel=${encodeURIComponent(rel)}${v}`;
}

export function buildClientModuleUrl(options: ClientModuleUrlOptions): string | null {
  if (options.strategy === "fs") {
    const fsPath = options.absPath ?? options.rel;
    return fsPath ? buildFsClientModuleUrl(fsPath) : null;
  }

  return buildRSCModuleUrl(options.rel, options.version);
}

export function getHydrationReactImportSpecifiers(
  doc: Document = document,
  version: string = REACT_DEFAULT_VERSION,
): { react: string; reactDomClient: string } {
  const imports = getDocumentImportMapImports(doc);

  return {
    react: importMapOwnsSpecifier("react", imports) ? "react" : getReactCDNUrl(version),
    reactDomClient: importMapOwnsSpecifier("react-dom/client", imports)
      ? "react-dom/client"
      : getReactDOMClientCDNUrl(version),
  };
}
