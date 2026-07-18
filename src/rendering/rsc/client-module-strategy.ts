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
import { rscLogger } from "../client/browser-logger.ts";

export type ClientModuleStrategy = "fs" | "rsc-module";

export interface ClientModuleStrategyOptions {
  isLocalProject?: boolean;
  environment?: "preview" | "production";
}

export interface ClientRuntimeHydrationData {
  pagePath?: string;
  clientModuleStrategy?: ClientModuleStrategy;
  isolatedClientPage?: boolean;
  dev?: boolean;
  /** React version used for both server rendering and browser hydration. */
  reactVersion?: string;
  /** Route slug for the current page (from the route match). */
  slug?: string;
  /** Route params from the initial match — used to seed the reactive router. */
  params?: Record<string, string | string[]>;
  /** Page frontmatter — exposed reactively via `usePageContext()`. */
  frontmatter?: Record<string, unknown>;
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
  // Only emit the `fs` strategy when the server is backed by a real on-disk
  // project (server-trusted `isLocalProject` signal). The `/_veryfront/fs/`
  // handler that serves those modules was narrowed to local projects only
  // under VULN-SRV-1/2: honoring a client-reachable `environment === "preview"`
  // here would advertise a dev-only endpoint that returns 404 in preview pods
  // and — more importantly — mixes the preview-mode signal (environment) with
  // the local-filesystem signal (isLocalProject). Preview pods serve the same
  // compiled client modules as production, via the RSC module endpoint.
  return options.isLocalProject ? "fs" : "rsc-module";
}

export function readHydrationData(
  doc: Document = document,
): ClientRuntimeHydrationData | null {
  try {
    const el = doc.getElementById(HYDRATION_DATA_ID);
    if (!el) return null;
    return JSON.parse(el.textContent || "{}") as ClientRuntimeHydrationData;
  } catch (e) {
    rscLogger.debug("hydration data parse failed", e);
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

export function appendClientModuleVersion(url: string, version?: string): string {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

export function buildFsClientModuleUrl(path: string, version?: string): string {
  return appendClientModuleVersion(
    `${FS_PATH_PREFIX}${base64urlEncode(path)}.js`,
    version,
  );
}

export function buildRSCModuleUrl(rel: string, version?: string): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : "";
  return `${RSC_PATH_PREFIX}module?rel=${encodeURIComponent(rel)}${v}`;
}

export function buildClientModuleUrl(options: ClientModuleUrlOptions): string | null {
  if (options.strategy === "fs") {
    const fsPath = options.absPath ?? options.rel;
    return fsPath ? buildFsClientModuleUrl(fsPath, options.version) : null;
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

/**
 * The import specifier for the framework router module, or `null` if the page's
 * import map does not own it. Returned as a value (not a literal) so callers can
 * `import(specifier)` and have the bundler leave it as a runtime import — the
 * module resolves to the app's React instance, which is required for the
 * provider's hooks to run under the same React as the hydrated component.
 */
export function getHydrationRouterImportSpecifier(doc: Document = document): string | null {
  const imports = getDocumentImportMapImports(doc);
  return importMapOwnsSpecifier("veryfront/router", imports) ? "veryfront/router" : null;
}
