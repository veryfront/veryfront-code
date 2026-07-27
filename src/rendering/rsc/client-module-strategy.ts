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
  /** Production release asset URLs keyed by source module path. */
  releaseAssetModules?: Record<string, string>;
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
  /**
   * Props returned by the page's `getServerData` — exposed reactively via
   * `usePageContext().data` so a hydrated client tree under an App/RSC page
   * reseeds with the same server data the server render used.
   */
  props?: Record<string, unknown>;
}

export interface ClientModuleUrlOptions {
  strategy: ClientModuleStrategy;
  rel: string;
  absPath?: string;
  version?: string;
  releaseAssetModules?: Record<string, string> | null;
}

const MAX_HYDRATION_DATA_UTF8_BYTES = 1024 * 1024;
const MAX_HYDRATION_STRING_CHARACTERS = 65_536;
const MAX_HYDRATION_PARAMS = 1_024;
const MAX_HYDRATION_PARAM_SEGMENTS = 1_024;
const MAX_RELEASE_ASSET_MODULES = 10_000;
const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1F || code === 0x7F) return true;
  }
  return false;
}

function isBoundedHydrationString(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_HYDRATION_STRING_CHARACTERS &&
    !hasControlCharacters(value);
}

function isSafeClientModuleUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_HYDRATION_STRING_CHARACTERS ||
    hasControlCharacters(value)
  ) {
    return false;
  }
  if (value.startsWith("/")) {
    try {
      const url = new URL(value, "https://veryfront.invalid");
      return !value.startsWith("//") &&
        url.origin === "https://veryfront.invalid" &&
        url.pathname.startsWith("/");
    } catch {
      return false;
    }
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function snapshotReleaseAssetModules(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError("Hydration release asset modules must be an object");
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_RELEASE_ASSET_MODULES) {
    throw new RangeError("Hydration release asset module limit was exceeded");
  }

  const snapshot = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !isBoundedHydrationString(key) ||
      !isSafeClientModuleUrl(descriptor.value)
    ) {
      throw new TypeError("Hydration release asset module entry is invalid");
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function validateHydrationParams(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new TypeError("Hydration params must be an object");

  const entries = Object.entries(value);
  if (entries.length > MAX_HYDRATION_PARAMS) {
    throw new RangeError("Hydration param limit was exceeded");
  }
  for (const [key, param] of entries) {
    if (!isBoundedHydrationString(key)) {
      throw new TypeError("Hydration param name is invalid");
    }
    if (typeof param === "string") {
      if (!isBoundedHydrationString(param)) {
        throw new TypeError("Hydration param value is invalid");
      }
      continue;
    }
    if (
      !Array.isArray(param) ||
      param.length > MAX_HYDRATION_PARAM_SEGMENTS ||
      !param.every(isBoundedHydrationString)
    ) {
      throw new TypeError("Hydration catch-all param is invalid");
    }
  }
}

function parseClientRuntimeHydrationData(
  value: unknown,
): ClientRuntimeHydrationData | null {
  try {
    if (!isRecord(value)) return null;
    if (
      value.clientModuleStrategy !== undefined &&
      value.clientModuleStrategy !== "fs" &&
      value.clientModuleStrategy !== "rsc-module"
    ) {
      return null;
    }
    for (const field of ["pagePath", "reactVersion", "slug"] as const) {
      if (value[field] !== undefined && !isBoundedHydrationString(value[field])) {
        return null;
      }
    }
    for (const field of ["isolatedClientPage", "dev"] as const) {
      if (value[field] !== undefined && typeof value[field] !== "boolean") {
        return null;
      }
    }
    if (value.frontmatter !== undefined && !isRecord(value.frontmatter)) return null;
    if (value.props !== undefined && !isRecord(value.props)) return null;
    validateHydrationParams(value.params);

    return {
      ...(value as ClientRuntimeHydrationData),
      releaseAssetModules: snapshotReleaseAssetModules(
        value.releaseAssetModules,
      ),
    };
  } catch {
    return null;
  }
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
    const serialized = el.textContent || "{}";
    if (
      serialized.length > MAX_HYDRATION_DATA_UTF8_BYTES ||
      textEncoder.encode(serialized).byteLength > MAX_HYDRATION_DATA_UTF8_BYTES
    ) {
      throw new RangeError("Hydration data byte limit was exceeded");
    }
    return parseClientRuntimeHydrationData(JSON.parse(serialized) as unknown);
  } catch (e) {
    rscLogger.debug("hydration data parse failed", e);
    return null;
  }
}

export function resolveClientModuleStrategy(
  hydrationData: ClientRuntimeHydrationData | null,
): ClientModuleStrategy {
  if (hydrationData?.clientModuleStrategy === "fs") return "fs";
  if (hydrationData?.clientModuleStrategy === "rsc-module") return "rsc-module";

  return hydrationData?.dev === true ? "fs" : "rsc-module";
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

function normalizeReleaseAssetModulePath(path: string): string {
  return path
    .replace(/^\/+_vf_modules\//, "")
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "")
    .replace(/\.js$/, "");
}

const RELEASE_ASSET_SOURCE_EXTENSION = /\.(tsx|ts|jsx|mdx|js)$/;

function releaseAssetModuleCandidates(path: string): string[] {
  if (!isBoundedHydrationString(path) || path.length === 0) return [];
  const normalized = normalizeReleaseAssetModulePath(path);
  const candidates = [path, normalized];
  if (!RELEASE_ASSET_SOURCE_EXTENSION.test(normalized)) {
    candidates.push(
      `${normalized}.tsx`,
      `${normalized}.ts`,
      `${normalized}.jsx`,
      `${normalized}.mdx`,
      `${normalized}.js`,
    );
  }
  return Array.from(new Set(candidates));
}

export function resolveReleaseAssetModuleUrl(
  releaseAssetModules: Record<string, string> | null | undefined,
  path: string,
): string | null {
  if (!isRecord(releaseAssetModules)) return null;

  for (const candidate of releaseAssetModuleCandidates(path)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        releaseAssetModules,
        candidate,
      );
      if (
        descriptor &&
        Object.hasOwn(descriptor, "value") &&
        isSafeClientModuleUrl(descriptor.value)
      ) {
        return descriptor.value;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function buildClientModuleUrl(options: ClientModuleUrlOptions): string | null {
  if (options.strategy === "fs") {
    const fsPath = options.absPath ?? options.rel;
    return fsPath ? buildFsClientModuleUrl(fsPath, options.version) : null;
  }

  const releaseAssetUrl = resolveReleaseAssetModuleUrl(
    options.releaseAssetModules,
    options.rel,
  );
  if (releaseAssetUrl) return releaseAssetUrl;

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
