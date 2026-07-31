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
import {
  FS_PATH_PREFIX,
  HYDRATION_DATA_ID,
  RSC_DEPENDENCY_PINNING_HEADER,
  RSC_PATH_PREFIX,
} from "./constants.ts";
import { rscLogger } from "../client/browser-logger.ts";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";
import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";
import { admitDependencySnapshot } from "./dependency-snapshot-admission.ts";

export type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";

export interface ClientModuleStrategyOptions {
  isLocalProject?: boolean;
  /** Whether the active server registry exposes development module routes. */
  allowDevelopmentModuleServing?: boolean;
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
  /** Request-scoped dependency snapshot used to version browser module URLs. */
  dependencyPinningCacheKey?: string;
}

export interface ClientRuntimeHydrationSnapshot {
  readonly data: ClientRuntimeHydrationData | null;
  readonly valid: boolean;
}

export interface ClientModuleUrlOptions {
  strategy: ClientModuleStrategy;
  rel: string;
  absPath?: string;
  version?: string;
  dependencyPinningCacheKey?: string;
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
    if (
      value.dependencyPinningCacheKey !== undefined &&
      value.dependencyPinningCacheKey !== "off" &&
      (
        typeof value.dependencyPinningCacheKey !== "string" ||
        !isCanonicalDependencyPinningCacheKey(value.dependencyPinningCacheKey)
      )
    ) {
      return null;
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
  // Filesystem module URLs are valid only when both independent authorities
  // agree: the request selected a local project and the active registry
  // actually exposes development module routes. Missing authority fails closed.
  return options.allowDevelopmentModuleServing === true &&
      options.isLocalProject === true
    ? "fs"
    : "rsc-module";
}

export function readHydrationData(
  doc: Document = document,
): ClientRuntimeHydrationData | null {
  return readHydrationDataSnapshot(doc).data;
}

export function readHydrationDataSnapshot(
  doc: Document = document,
): ClientRuntimeHydrationSnapshot {
  try {
    const el = doc.getElementById(HYDRATION_DATA_ID);
    if (!el) return { data: null, valid: true };
    const serialized = el.textContent || "{}";
    if (
      serialized.length > MAX_HYDRATION_DATA_UTF8_BYTES ||
      textEncoder.encode(serialized).byteLength > MAX_HYDRATION_DATA_UTF8_BYTES
    ) {
      throw new RangeError("Hydration data byte limit was exceeded");
    }
    const data = parseClientRuntimeHydrationData(JSON.parse(serialized) as unknown);
    if (!data) throw new TypeError("Hydration data failed admission");
    return { data, valid: true };
  } catch (e) {
    rscLogger.debug("hydration data parse failed", e);
    return { data: null, valid: false };
  }
}

/**
 * Compatibility verifier for callers that previously seeded transport state.
 * The document is now the request authority and is never overwritten.
 */
export function seedHydrationDependencyPins(
  doc: Document,
  dependencyPinningCacheKey: string | null | undefined,
): boolean {
  if (
    typeof dependencyPinningCacheKey !== "string" ||
    !isCanonicalDependencyPinningCacheKey(dependencyPinningCacheKey)
  ) return false;

  const snapshot = readHydrationDataSnapshot(doc);
  if (!snapshot.valid) return false;
  const current = snapshot.data?.dependencyPinningCacheKey;
  return admitDependencySnapshot(
    {
      requestedDependencyPinningCacheKey: current,
      currentDependencyPinningCacheKey: current,
      responseHeaderDependencyPinningCacheKey: dependencyPinningCacheKey,
      requireResponseHeader: true,
    },
    () => false,
  ) !== null;
}

export function resolveClientModuleStrategy(
  hydrationData: ClientRuntimeHydrationData | null,
): ClientModuleStrategy {
  if (hydrationData?.clientModuleStrategy === "fs") return "fs";
  return "rsc-module";
}

export function appendClientModuleVersion(url: string, version?: string): string {
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

export function appendClientModuleDependencyPins(
  url: string,
  dependencyPinningCacheKey?: string,
): string {
  if (!dependencyPinningCacheKey?.startsWith("on:")) return url;

  const hashIndex = url.indexOf("#");
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(
    queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1),
  );

  params.set("pins", dependencyPinningCacheKey);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

export function buildFsClientModuleUrl(path: string, version?: string): string {
  return appendClientModuleVersion(
    `${FS_PATH_PREFIX}${base64urlEncode(path)}.js`,
    version,
  );
}

export function buildRSCModuleUrl(
  rel: string,
  version?: string,
  dependencyPinningCacheKey?: string,
): string {
  const v = version ? `&v=${encodeURIComponent(version)}` : "";
  return appendClientModuleDependencyPins(
    `${RSC_PATH_PREFIX}module?rel=${encodeURIComponent(rel)}${v}`,
    dependencyPinningCacheKey,
  );
}

/**
 * Build headers for fetch-capable RSC transports. Application query parameters
 * remain application-owned; only dynamic import URLs carry snapshots in their
 * query string because import() cannot attach request headers.
 */
export function buildRSCTransportHeaders(
  hydrationData: ClientRuntimeHydrationData | null,
): Record<string, string> {
  const dependencyPinningCacheKey = hydrationData?.dependencyPinningCacheKey;
  return dependencyPinningCacheKey?.startsWith("on:")
    ? { [RSC_DEPENDENCY_PINNING_HEADER]: dependencyPinningCacheKey }
    : {};
}

export function buildRSCActionUrl(
  _hydrationData: ClientRuntimeHydrationData | null,
): string {
  return `${RSC_PATH_PREFIX}action`;
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
    return fsPath
      ? appendClientModuleDependencyPins(
        buildFsClientModuleUrl(fsPath, options.version),
        options.dependencyPinningCacheKey,
      )
      : null;
  }

  const releaseAssetUrl = resolveReleaseAssetModuleUrl(
    options.releaseAssetModules,
    options.rel,
  );
  if (releaseAssetUrl) return releaseAssetUrl;

  return buildRSCModuleUrl(
    options.rel,
    options.version,
    options.dependencyPinningCacheKey,
  );
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
