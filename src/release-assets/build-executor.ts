/**
 * Release Asset Manifest — builder executor.
 *
 * Runs inside the project runtime as the `task:release-asset-build` handler.
 * Materializes a release's file set, transforms every browser module through
 * the SAME pipeline `serveModule` uses (byte parity with the JIT fallback is a
 * hard requirement), compiles route CSS where reachable, content-addresses and
 * uploads each asset, then assembles and PUTs the manifest (→ ready).
 *
 * Defensive by construction:
 * - Browser graph failures that can fall back to JIT are recorded as gaps.
 * - Other build failures (list/hash/upload/PUT) report `failed`.
 * - The temp dir is always cleaned up by the caller.
 *
 * @module release-assets/build-executor
 */

import {
  defineConfig,
  defineConfigWithEnv,
  type EnvironmentConfig,
  mergeConfigs as mergeProjectConfigs,
  validateVeryfrontConfig,
  type VeryfrontConfig,
  type VeryfrontConfigInput,
} from "#veryfront/config";
import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
import { createConfigShimModule } from "#veryfront/config/config-shim.ts";
import { mergeConfigs as mergeLoadedConfig } from "#veryfront/config/loader.ts";
import { serverLogger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import {
  FRAMEWORK_EMBEDDED_SRC_DIR,
  FRAMEWORK_SRC_DIR,
  resolveFrameworkSourcePath,
  resolveRelativeFrameworkSourceImport,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { cacheHttpImportsToLocal, normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache.ts";
import { extractSourceUrl } from "#veryfront/transforms/esm/source-url-embed.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import {
  getReactUrls,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { PLATFORM_UTILITIES } from "#veryfront/html/utils.ts";
import { ensureDefaultBundlerContracts } from "../extensions/bundler/defaults.ts";
import { register, tryResolve } from "../extensions/contracts.ts";
import type { Plugin } from "veryfront/extensions/bundler";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { extractCandidatesFromFiles } from "#veryfront/html/styles-builder/candidate-extractor.ts";
import { FRAMEWORK_CANDIDATES } from "#veryfront/server/handlers/dev/framework-candidates.generated.ts";
import { validatePathSync } from "#veryfront/security/path-validation.ts";
import {
  collectCssImportPaths,
  CSS_IMPORTING_SOURCE_EXTENSIONS,
} from "#veryfront/html/styles-builder/css-import-extraction.ts";
import { computeHashBytes } from "#veryfront/utils";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_PENDING_BYTES,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
  type ReleaseAssetContentType,
  releaseAssetUrl,
} from "./constants.ts";
import {
  configuredRoutePath,
  normalizeLogicalPath as normalizeRouteLogicalPath,
  routeForConfiguredPage,
  routeForPage,
} from "./route-path.ts";
export { routeForPage } from "./route-path.ts";
import { hasControlCharacters } from "./string-validation.ts";
import {
  parseReleaseAssetManifest,
  type ReleaseAssetCssEntry,
  type ReleaseAssetManifest,
  type ReleaseAssetRouteEntry,
} from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-build");

/** Browser module source extensions eligible for transform. */
const BROWSER_MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
/** Directories used as browser graph entry seeds. Imports may reach any project directory. */
const BROWSER_MODULE_DIRS = ["components/", "layouts/", "lib/", "src/"];
const PROJECT_IMPORT_ROOTS = ["app/", "pages/", ...BROWSER_MODULE_DIRS];
const FRAMEWORK_MODULE_URL_PREFIX = "/_vf_modules/_veryfront/";
const REACT_IMPORT_MAP_DEPENDENCIES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;
const MAX_RELEASE_FILES = 50_000;
const MAX_RELEASE_FILE_PATH_LENGTH = RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength;
const MAX_RELEASE_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_CSS_CANDIDATES = 100_000;
const MAX_CSS_INPUT_BYTES = RELEASE_ASSET_MAX_SIZE_BYTES;
const MAX_BUILD_IDENTIFIER_LENGTH = RELEASE_ASSET_MANIFEST_LIMITS.identifierLength;
const MAX_STYLE_PROFILE_HASH_LENGTH = RELEASE_ASSET_MANIFEST_LIMITS.styleProfileHashLength;
const MAX_DEPENDENCY_MODULES = RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries;
const MAX_DEPENDENCY_SPECIFIERS = RELEASE_ASSET_MANIFEST_LIMITS.dependencySpecifiers;
const MAX_DEPENDENCY_SOURCE_BYTES = RELEASE_ASSET_MAX_PENDING_BYTES;
const MAX_DEPENDENCY_DIRECTORY_DEPTH = 64;
const MAX_DEPENDENCY_SPECIFIER_LENGTH = RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength;
const FRAMEWORK_DEPENDENCY_ENTRY_RESERVE = Object.keys(PLATFORM_UTILITIES).length;
const MAX_HTTP_DEPENDENCY_ENTRIES = Math.max(
  0,
  RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries - FRAMEWORK_DEPENDENCY_ENTRY_RESERVE,
);
const textEncoder = new TextEncoder();

function isDependencyImportMapEnabled(): boolean {
  return getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
}

/** Inputs required to build and publish one release asset manifest generation. */
export interface ReleaseAssetBuildInput {
  /** Project reference (slug or id) used for API calls. */
  projectReference: string;
  /** Project UUID. */
  projectId: string;
  /** Release UUID. */
  releaseId: string;
  /** Release version (integer). */
  releaseVersion: number;
  /** Release version string used for API path segments. */
  releaseVersionRef: string;
  /** React version for transforms. */
  reactVersion?: string;
  /**
   * Fallback Tailwind stylesheet path (relative to the project root). The
   * release's own veryfront.config.* from the materialized file set is
   * preferred; when absent, this path and then conventional defaults are tried.
   */
  stylesheetPath?: string;
  /** Authenticated, project-scoped API client. */
  client: ReleaseAssetBuildClient;
  /** Runtime adapter used by the transform pipeline. */
  adapter: RuntimeAdapter;
  /**
   * Transform function. Defaults to the same `transformToESM` pipeline
   * `serveModule` uses (browser, non-SSR) — byte parity is a hard requirement.
   * Injectable for tests.
   */
  transform?: ReleaseAssetTransform;
  /**
   * Optional HTTP dependency vendor. Defaults to the existing HTTP module cache
   * and is injectable so tests do not depend on live package CDN behavior.
   */
  vendorHttpImports?: ReleaseAssetHttpDependencyVendor;
}

/** Browser transform contract shared with the module-serving pipeline. */
export type ReleaseAssetTransform = (
  source: string,
  sourceFile: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options: { projectId: string; dev: boolean; ssr: boolean; reactVersion?: string },
) => Promise<string>;

/** One vendored dependency and the source identity represented by its code. */
export interface ReleaseAssetVendorDependency {
  /** Specifier currently used by transformed code after vendoring. */
  specifier: string;
  /** Stable manifest key, normally the original HTTP source URL. */
  manifestKey: string;
  /** Absolute local cache path when the dependency came from disk. */
  sourcePath?: string;
  /** Browser ESM source for this dependency. */
  code: string;
}

/** Rewritten module code plus every dependency needed by that rewrite. */
export interface ReleaseAssetVendorResult {
  code: string;
  dependencies: ReleaseAssetVendorDependency[];
}

/** Injectable HTTP dependency vendoring contract. */
export type ReleaseAssetHttpDependencyVendor = (
  code: string,
  options: {
    tempDir: string;
    reactVersion?: string;
  },
) => Promise<ReleaseAssetVendorResult>;

/** Subset of the API client used by the builder (eases testing). */
export interface ReleaseAssetBuildClient {
  beginReleaseAssetManifestBuild(
    version: string,
  ): Promise<{ id: string; manifest_version: number; state: string }>;
  listAllReleaseFiles(
    version: string,
  ): Promise<Array<{ path: string; content?: string }>>;
  uploadReleaseAsset(
    version: string,
    contentHash: string,
    contentType: ReleaseAssetContentType,
    bytes: Uint8Array,
  ): Promise<{ stored: boolean; existed: boolean }>;
  putReleaseAssetManifest(
    version: string,
    manifest: unknown,
  ): Promise<{ state: string; manifest_version?: number }>;
  reportReleaseAssetManifestState(
    version: string,
    state: "partial" | "failed",
    error?: string,
  ): Promise<unknown>;
  /**
   * Optional project CSS compiler; when absent, css:[] is recorded.
   *
   * Receives the Tailwind class candidates extracted from the release source
   * plus the resolved project stylesheet (so the implementation can compile
   * without re-fetching the file set). Returns `null` on any failure so the
   * executor keeps a CSS gap and proceeds.
   */
  compileProjectCss?(
    candidates: Set<string>,
    stylesheet: string | undefined,
    options?: { config?: VeryfrontConfig },
  ): Promise<{ css: string; styleProfileHash: string | null } | null>;
}

/** Observable outcome of a release asset build attempt. */
export interface ReleaseAssetBuildResult {
  success: boolean;
  state: "ready" | "partial" | "failed";
  moduleCount: number;
  cssCount: number;
  routeCount: number;
  gaps: string[];
  error?: string;
}

interface PreparedAsset {
  logicalPath: string;
  contentHash: string;
  size: number;
  contentType: ReleaseAssetContentType;
}

/** Prepared content-addressed asset bytes ready for upload. */
export interface PreparedReleaseAsset extends PreparedAsset {
  bytes: Uint8Array;
}

interface TransformedProjectModule {
  logicalPath: string;
  code: string;
  unvendoredCode: string;
}

interface DependencyModule {
  manifestKey: string;
  specifiers: Set<string>;
  sourcePath?: string;
  code: string;
  codeSize: number;
}

interface DependencyModuleCollection {
  modules: Map<string, DependencyModule>;
  specifierCount: number;
  sourceBytes: number;
}

interface FinalizedDependencyModules {
  assets: Record<string, PreparedAsset>;
  fallbackUrls: Map<string, string>;
}

interface PendingAssetStore {
  entries: Map<
    string,
    {
      bytes: Uint8Array<ArrayBuffer>;
      contentType: ReleaseAssetContentType;
    }
  >;
  totalBytes: number;
}

interface FrameworkBuildContext {
  projectId: string;
  adapter: RuntimeAdapter;
  reactVersion?: string;
}

function createPendingAssetStore(): PendingAssetStore {
  return { entries: new Map(), totalBytes: 0 };
}

function pendingAssetKey(
  contentHash: string,
  contentType: ReleaseAssetContentType,
): string {
  return JSON.stringify([contentHash, contentType]);
}

function rememberPendingAsset(
  store: PendingAssetStore,
  asset: PreparedAsset,
  bytes: Uint8Array<ArrayBuffer>,
): boolean {
  const key = pendingAssetKey(asset.contentHash, asset.contentType);
  const existing = store.entries.get(key);
  if (existing) {
    if (!bytesEqual(existing.bytes, bytes)) {
      throw new Error("Release asset hash collision detected");
    }
    return false;
  }

  if (store.totalBytes + bytes.byteLength > RELEASE_ASSET_MAX_PENDING_BYTES) {
    throw new Error(
      `Pending release assets exceed ${RELEASE_ASSET_MAX_PENDING_BYTES} bytes`,
    );
  }

  store.entries.set(key, { bytes, contentType: asset.contentType });
  store.totalBytes += bytes.byteLength;
  return true;
}

function getPendingAsset(
  store: PendingAssetStore,
  asset: PreparedAsset,
): { bytes: Uint8Array<ArrayBuffer>; contentType: ReleaseAssetContentType } | undefined {
  return store.entries.get(pendingAssetKey(asset.contentHash, asset.contentType));
}

function forgetPendingAsset(store: PendingAssetStore, asset: PreparedAsset): void {
  const key = pendingAssetKey(asset.contentHash, asset.contentType);
  const existing = store.entries.get(key);
  if (!existing) return;
  store.entries.delete(key);
  store.totalBytes -= existing.bytes.byteLength;
}

function discardPendingAssetsSince(
  uploadQueue: PreparedAsset[],
  store: PendingAssetStore,
  startIndex: number,
): void {
  for (const asset of uploadQueue.splice(startIndex)) {
    forgetPendingAsset(store, asset);
  }
}

function bytesEqual(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

interface ReleaseRouterDirectories {
  app: string;
  pages: string;
}

function frameworkModuleUrlToSourceKey(moduleUrl: string): string | null {
  if (!moduleUrl.startsWith(FRAMEWORK_MODULE_URL_PREFIX)) return null;
  const sourceKey = moduleUrl
    .slice(FRAMEWORK_MODULE_URL_PREFIX.length)
    .replace(/\.(mjs|cjs|js|jsx|ts|tsx)$/, "");
  if (
    sourceKey.length === 0 ||
    sourceKey.length > RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength ||
    sourceKey.includes("\\") ||
    sourceKey.includes("?") ||
    sourceKey.includes("#") ||
    hasControlCharacters(sourceKey)
  ) {
    return null;
  }
  return normalizeLogicalPath(sourceKey) === sourceKey ? sourceKey : null;
}

function frameworkSourceKeyToModuleUrl(sourceKey: string): string {
  return `${FRAMEWORK_MODULE_URL_PREFIX}${sourceKey}.js`;
}

function embeddedFrameworkModuleCode(sourceKey: string): string | null {
  if (sourceKey === "_deno-config") {
    return `export default ${JSON.stringify({ version: VERSION })};\n`;
  }

  return null;
}

function frameworkSourcePathToSourceKey(sourcePath: string, lookupDirs: string[]): string | null {
  for (const lookupDir of lookupDirs) {
    if (!sourcePath.startsWith(`${lookupDir}/`)) continue;
    const relativePath = sourcePath.slice(lookupDir.length + 1)
      .replace(/\.src$/, "")
      .replace(/\.(tsx?|jsx?|mjs|mdx?|js)$/, "");
    return normalizeLogicalPath(relativePath);
  }

  return null;
}

/** Sanitize an error for state reporting (no internal paths / stack traces). */
function sanitizeError(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return String(message).replace(/\/[^\s]+/g, "<path>").slice(0, 300);
  } catch {
    return "Unknown release asset build error";
  }
}

/** True when a logical path is an eligible browser module. */
function isTransformableBrowserModule(path: string): boolean {
  if (!BROWSER_MODULE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (path.endsWith(".d.ts")) return false;
  return true;
}

/** True when a logical path should seed the browser module graph. */
function isBrowserModule(path: string, directories: ReleaseRouterDirectories): boolean {
  if (!isTransformableBrowserModule(path)) return false;
  if (routeForConfiguredPage(path, directories) !== null) return true;
  return isConfiguredAppRouterLayout(path, directories) ||
    BROWSER_MODULE_DIRS.some((dir) => path.startsWith(dir));
}

function isConfiguredAppRouterLayout(path: string, directories: ReleaseRouterDirectories): boolean {
  const appPath = configuredRoutePath(path, directories, "app");
  if (!appPath?.startsWith("app/")) return false;
  const withoutPrefix = appPath.slice("app/".length);
  const segments = withoutPrefix.split("/");
  const fileName = segments.pop();
  if (!fileName || !/^layout\.(tsx|ts|jsx|mdx|js)$/.test(fileName)) return false;
  return !segments.some((segment) => segment.startsWith("@") || segment.startsWith("_"));
}

function collectConfiguredAppRouterLayoutsForPage(
  logicalPath: string,
  directories: ReleaseRouterDirectories,
  knownPaths: Set<string>,
): string[] {
  const appPath = configuredRoutePath(logicalPath, directories, "app");
  if (!appPath || routeForPage(appPath) === null) return [];

  const segments = logicalPath.split("/");
  segments.pop();
  const appRootDepth = normalizeRouteLogicalPath(directories.app).split("/").filter(Boolean).length;

  const layouts: string[] = [];
  for (let depth = appRootDepth; depth <= segments.length; depth++) {
    const dir = segments.slice(0, depth).join("/");
    for (const ext of BROWSER_MODULE_EXTENSIONS) {
      const candidate = dir ? `${dir}/layout${ext}` : `layout${ext}`;
      if (knownPaths.has(candidate)) {
        layouts.push(candidate);
        break;
      }
    }
  }
  return layouts;
}

function releaseRouterDirectories(config: VeryfrontConfig): ReleaseRouterDirectories {
  return {
    app: config.directories?.app ?? "app",
    pages: config.directories?.pages ?? "pages",
  };
}

function resolveKnownModulePath(path: string, knownPaths: Set<string>): string | null {
  const normalized = normalizeLogicalPath(
    path
      .replace(/^\/?_vf_modules\//, "")
      .replace(/^\/+/, "")
      .replace(/[?#].*$/, ""),
  );
  if (!normalized) return null;

  if (normalized.startsWith("_veryfront/")) return null;
  if (knownPaths.has(normalized)) return normalized;

  const withoutExt = normalized.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  for (const ext of BROWSER_MODULE_EXTENSIONS) {
    const candidate = `${withoutExt}${ext}`;
    if (knownPaths.has(candidate)) return candidate;
  }

  return null;
}

function normalizeLogicalPath(path: string): string | null {
  if (path.includes("\\") || hasControlCharacters(path)) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function normalizeProjectSpecifier(specifier: string, logicalPath: string): string | null {
  if (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("blob:") ||
    specifier.startsWith("#")
  ) {
    return null;
  }

  if (specifier.startsWith("/_vf_modules/_veryfront/")) return null;
  if (specifier.startsWith("/_vf_modules/")) return specifier;
  if (specifier.startsWith("_veryfront/")) return null;
  if (specifier.startsWith("@/")) return specifier.slice(2);

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const dir = logicalPath.includes("/")
      ? logicalPath.slice(0, logicalPath.lastIndexOf("/"))
      : ".";
    return `${dir}/${specifier}`;
  }

  if (specifier.startsWith("/")) return specifier;

  if (PROJECT_IMPORT_ROOTS.some((dir) => specifier.startsWith(dir))) return specifier;

  return null;
}

function resolveProjectModuleSpecifier(
  specifier: string,
  logicalPath: string,
  knownPaths: Set<string>,
): string | null {
  const normalized = normalizeProjectSpecifier(specifier, logicalPath);
  if (!normalized) return null;
  return resolveKnownModulePath(normalized, knownPaths);
}

async function collectProjectModuleImports(
  code: string,
  logicalPath: string,
  knownPaths: Set<string>,
): Promise<Map<string, string>> {
  const imports = new Map<string, string>();

  for (const imp of await parseImports(code)) {
    if (!imp.n) continue;

    const specifier = imp.n;
    const importedPath = resolveProjectModuleSpecifier(specifier, logicalPath, knownPaths);
    if (importedPath) imports.set(specifier, importedPath);
  }

  return imports;
}

async function rewriteProjectModuleImports(
  code: string,
  logicalPath: string,
  moduleAssets: Map<string, PreparedAsset>,
  knownPaths: Set<string>,
  dependencyUrls: Map<string, string>,
): Promise<string> {
  function rewriteSpecifier(specifier: string): string | null {
    const dependencyUrl = dependencyUrlForSpecifier(dependencyUrls, specifier);
    if (dependencyUrl) return dependencyUrl;

    if (specifier.startsWith("/_vf_modules/")) {
      const dependencyUrl = dependencyUrlForSpecifier(dependencyUrls, specifier);
      if (dependencyUrl) return dependencyUrl;
    }

    const importedPath = resolveProjectModuleSpecifier(specifier, logicalPath, knownPaths);
    const asset = importedPath ? moduleAssets.get(importedPath) : undefined;
    return asset ? releaseAssetUrl(asset.contentHash, "js") : null;
  }

  return await replaceSpecifiers(code, (specifier) => rewriteSpecifier(specifier));
}

async function assertNoLocalFileImports(code: string): Promise<void> {
  for (const imp of await parseImports(code)) {
    if (imp.n?.startsWith("file://")) {
      throw new Error("Release module contains an unresolved local file import");
    }
  }
}

function dependencyUrlForSpecifier(
  dependencyUrls: Map<string, string>,
  specifier: string,
): string | null {
  const direct = dependencyUrls.get(specifier) ??
    dependencyUrls.get(normalizeDependencySpecifier(specifier));
  if (direct) return direct;

  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    const normalized = normalizeHttpUrl(specifier);
    return dependencyUrls.get(normalized) ??
      dependencyUrls.get(normalizeDependencySpecifier(normalized)) ?? null;
  }

  return null;
}

export function releaseAssetDependencyUrlForSpecifier(
  dependencyUrls: Map<string, string>,
  specifier: string,
): string | null {
  return dependencyUrlForSpecifier(dependencyUrls, specifier);
}

function buildDependencyUrlMap(
  dependencies: Record<string, PreparedAsset>,
  dependencyModules?: Map<string, DependencyModule>,
): Map<string, string> {
  const urls = new Map<string, string>();
  for (const [manifestKey, entry] of Object.entries(dependencies)) {
    const dependency = dependencyModules?.get(manifestKey);
    const url = releaseAssetUrl(entry.contentHash, "js");

    setDependencyUrlAlias(urls, manifestKey, url);
    setDependencyUrlAlias(urls, normalizeDependencySpecifier(manifestKey), url);
    if (manifestKey.startsWith("http://") || manifestKey.startsWith("https://")) {
      const normalized = normalizeHttpUrl(manifestKey);
      setDependencyUrlAlias(urls, normalized, url);
      setDependencyUrlAlias(urls, normalizeDependencySpecifier(normalized), url);
    }

    if (!dependency) continue;

    setDependencyUrlAlias(urls, entry.logicalPath, url);
    for (const specifier of dependency.specifiers) {
      setDependencyUrlAlias(urls, specifier, url);
      setDependencyUrlAlias(urls, normalizeDependencySpecifier(specifier), url);
      if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
        const normalized = normalizeHttpUrl(specifier);
        setDependencyUrlAlias(urls, normalized, url);
        setDependencyUrlAlias(urls, normalizeDependencySpecifier(normalized), url);
      }
    }
  }
  return urls;
}

function setDependencyUrlAlias(
  urls: Map<string, string>,
  key: string,
  url: string,
): void {
  const existing = urls.get(key);
  if (existing !== undefined && existing !== url) {
    throw new Error(`Conflicting release dependency alias: ${key}`);
  }
  urls.set(key, url);
}

function setDependencyModuleAlias(
  aliases: Map<string, DependencyModule>,
  key: string,
  dependency: DependencyModule,
): void {
  const existing = aliases.get(key);
  if (existing && existing !== dependency) {
    throw new Error(`Conflicting vendored dependency alias: ${key}`);
  }
  aliases.set(key, dependency);
}

function preparedAssetsEqual(left: PreparedAsset, right: PreparedAsset): boolean {
  return left.contentHash === right.contentHash &&
    left.size === right.size &&
    left.contentType === right.contentType;
}

function mergePreparedAssetRecords(
  ...records: Array<Record<string, PreparedAsset>>
): Record<string, PreparedAsset> {
  const merged: Record<string, PreparedAsset> = Object.create(null);
  for (const record of records) {
    for (const [key, asset] of Object.entries(record)) {
      const existing = Object.hasOwn(merged, key) ? merged[key] : undefined;
      if (existing && !preparedAssetsEqual(existing, asset)) {
        throw new Error(`Conflicting release asset manifest key: ${key}`);
      }
      Object.defineProperty(merged, key, {
        value: asset,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return merged;
}

export function buildReleaseAssetDependencyUrlMap(
  dependencies: Record<string, PreparedAsset>,
): Map<string, string> {
  return buildDependencyUrlMap(dependencies);
}

function exposeDependencySpecifierAliases(
  assets: Record<string, PreparedAsset>,
  dependencyModules: Map<string, DependencyModule>,
  maximumEntries: number = RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries,
): Record<string, PreparedAsset> {
  const aliased = mergePreparedAssetRecords(assets);
  let entryCount = Object.keys(aliased).length;
  if (entryCount > maximumEntries) {
    throw new Error(`Release dependency manifest exceeds ${maximumEntries} entries`);
  }
  for (const dependency of dependencyModules.values()) {
    const asset = assets[dependency.manifestKey];
    if (!asset) continue;

    for (const specifier of dependency.specifiers) {
      const normalized = normalizeDependencySpecifier(specifier);
      if (
        normalized.startsWith("http://") ||
        normalized.startsWith("https://") ||
        normalized.startsWith("file://") ||
        normalized.startsWith("./") ||
        normalized.startsWith("../")
      ) {
        continue;
      }
      const existing = Object.hasOwn(aliased, normalized) ? aliased[normalized] : undefined;
      if (existing && !preparedAssetsEqual(existing, asset)) {
        throw new Error(`Conflicting release dependency manifest alias: ${normalized}`);
      }
      if (!existing && entryCount >= maximumEntries) {
        throw new Error(`Release dependency manifest exceeds ${maximumEntries} entries`);
      }
      Object.defineProperty(aliased, normalized, {
        value: asset,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      if (!existing) entryCount++;
    }
  }
  return aliased;
}

function dependencyFallbackUrl(dependency: DependencyModule): string | null {
  if (
    dependency.manifestKey.startsWith("http://") ||
    dependency.manifestKey.startsWith("https://")
  ) {
    return dependency.manifestKey;
  }

  for (const specifier of dependency.specifiers) {
    if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
      return specifier;
    }
  }

  return null;
}

function addDependencyUrlAliases(
  urls: Map<string, string>,
  dependency: DependencyModule,
  url: string,
): void {
  setDependencyUrlAlias(urls, dependency.manifestKey, url);
  if (dependency.sourcePath) {
    setDependencyUrlAlias(urls, toFileUrl(dependency.sourcePath).href, url);
  }
  for (const specifier of dependency.specifiers) {
    setDependencyUrlAlias(urls, normalizeDependencySpecifier(specifier), url);
  }
}

const UNREADABLE_VENDOR_PROPERTY = Symbol("unreadable-vendor-property");

function readOwnVendorDataProperty(
  value: unknown,
  key: PropertyKey,
): unknown | typeof UNREADABLE_VENDOR_PROPERTY {
  if (typeof value !== "object" || value === null) return UNREADABLE_VENDOR_PROPERTY;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    return Object.hasOwn(descriptor, "value") ? descriptor.value : UNREADABLE_VENDOR_PROPERTY;
  } catch {
    return UNREADABLE_VENDOR_PROPERTY;
  }
}

function createDependencyModuleCollection(): DependencyModuleCollection {
  return {
    modules: new Map(),
    specifierCount: 0,
    sourceBytes: 0,
  };
}

function clearDependencyModules(collection: DependencyModuleCollection): void {
  collection.modules.clear();
  collection.specifierCount = 0;
  collection.sourceBytes = 0;
}

function validateVendorResult(
  value: unknown,
): { code: string; dependencies: readonly unknown[] } {
  const code = readOwnVendorDataProperty(value, "code");
  const dependencies = readOwnVendorDataProperty(value, "dependencies");
  if (
    typeof code !== "string" ||
    textEncoder.encode(code).byteLength > RELEASE_ASSET_MAX_SIZE_BYTES ||
    !Array.isArray(dependencies) ||
    dependencies.length > MAX_DEPENDENCY_MODULES
  ) {
    throw new Error("HTTP dependency vendor returned an invalid or oversized result");
  }
  return { code, dependencies };
}

function stageDependencyModules(
  dependencies: readonly unknown[],
): DependencyModuleCollection {
  const staged = createDependencyModuleCollection();

  for (let index = 0; index < dependencies.length; index++) {
    const dependency = readOwnVendorDataProperty(dependencies, String(index));
    const manifestKey = readOwnVendorDataProperty(dependency, "manifestKey");
    const specifier = readOwnVendorDataProperty(dependency, "specifier");
    const code = readOwnVendorDataProperty(dependency, "code");
    const declaredSourcePath = readOwnVendorDataProperty(dependency, "sourcePath");
    if (
      !isSafeBuildText(manifestKey, MAX_DEPENDENCY_SPECIFIER_LENGTH) ||
      !isSafeBuildText(specifier, MAX_DEPENDENCY_SPECIFIER_LENGTH) ||
      typeof code !== "string"
    ) {
      throw new Error("Vendored dependency exceeds the supported boundary");
    }

    const codeSize = textEncoder.encode(code).byteLength;
    if (codeSize > RELEASE_ASSET_MAX_SIZE_BYTES) {
      throw new Error("Vendored dependency exceeds the supported boundary");
    }

    let sourcePath: string | undefined;
    if (declaredSourcePath !== undefined) {
      if (
        !isSafeBuildText(declaredSourcePath, MAX_RELEASE_FILE_PATH_LENGTH) ||
        !isAbsolute(declaredSourcePath) ||
        normalize(declaredSourcePath) !== declaredSourcePath
      ) {
        throw new Error("Vendored dependency source path must be canonical and absolute");
      }
      sourcePath = declaredSourcePath;
    } else {
      sourcePath = resolveLocalDependencyPath(specifier) ?? undefined;
    }

    const existing = staged.modules.get(manifestKey);
    if (existing) {
      if (
        existing.code !== code ||
        (existing.sourcePath !== undefined &&
          sourcePath !== undefined &&
          existing.sourcePath !== sourcePath)
      ) {
        throw new Error(`Conflicting vendored dependency identity: ${manifestKey}`);
      }
      if (!existing.specifiers.has(specifier)) {
        existing.specifiers.add(specifier);
        staged.specifierCount++;
      }
      existing.sourcePath ??= sourcePath;
    } else {
      staged.modules.set(manifestKey, {
        manifestKey,
        specifiers: new Set([specifier]),
        sourcePath,
        code,
        codeSize,
      });
      staged.specifierCount++;
      staged.sourceBytes += codeSize;
    }

    if (
      staged.modules.size > MAX_DEPENDENCY_MODULES ||
      staged.specifierCount > MAX_DEPENDENCY_SPECIFIERS ||
      staged.sourceBytes > MAX_DEPENDENCY_SOURCE_BYTES
    ) {
      throw new Error("Vendored dependency collection exceeds the supported boundary");
    }
  }

  return staged;
}

function addStagedDependencySpecifier(
  staged: DependencyModuleCollection,
  dependency: DependencyModule,
  specifier: string,
): void {
  if (!isSafeBuildText(specifier, MAX_DEPENDENCY_SPECIFIER_LENGTH)) {
    throw new Error("Vendored dependency specifier exceeds the supported boundary");
  }
  if (dependency.specifiers.has(specifier)) return;
  if (staged.specifierCount >= MAX_DEPENDENCY_SPECIFIERS) {
    throw new Error("Vendored dependency specifiers exceed the supported boundary");
  }
  dependency.specifiers.add(specifier);
  staged.specifierCount++;
}

function commitDependencyModules(
  target: DependencyModuleCollection,
  staged: DependencyModuleCollection,
): void {
  let addedModules = 0;
  let addedSpecifiers = 0;
  let addedSourceBytes = 0;

  for (const dependency of staged.modules.values()) {
    const existing = target.modules.get(dependency.manifestKey);
    if (!existing) {
      addedModules++;
      addedSpecifiers += dependency.specifiers.size;
      addedSourceBytes += dependency.codeSize;
      continue;
    }
    if (
      existing.code !== dependency.code ||
      (existing.sourcePath !== undefined &&
        dependency.sourcePath !== undefined &&
        existing.sourcePath !== dependency.sourcePath)
    ) {
      throw new Error(
        `Conflicting vendored dependency identity: ${dependency.manifestKey}`,
      );
    }
    for (const specifier of dependency.specifiers) {
      if (!existing.specifiers.has(specifier)) addedSpecifiers++;
    }
  }

  if (
    target.modules.size + addedModules > MAX_DEPENDENCY_MODULES ||
    target.specifierCount + addedSpecifiers > MAX_DEPENDENCY_SPECIFIERS ||
    target.sourceBytes + addedSourceBytes > MAX_DEPENDENCY_SOURCE_BYTES
  ) {
    throw new Error("Vendored dependency collection exceeds the supported boundary");
  }

  for (const dependency of staged.modules.values()) {
    const existing = target.modules.get(dependency.manifestKey);
    if (!existing) {
      target.modules.set(dependency.manifestKey, {
        ...dependency,
        specifiers: new Set(dependency.specifiers),
      });
      continue;
    }
    for (const specifier of dependency.specifiers) existing.specifiers.add(specifier);
    existing.sourcePath ??= dependency.sourcePath;
  }

  target.specifierCount += addedSpecifiers;
  target.sourceBytes += addedSourceBytes;
}

function mergeDependencyModules(
  target: DependencyModuleCollection,
  dependencies: readonly unknown[],
): void {
  commitDependencyModules(target, stageDependencyModules(dependencies));
}

function normalizeDependencySpecifier(specifier: string): string {
  return specifier.replace(/[?#].*$/, "");
}

const gapIndexes = new WeakMap<string[], Set<string>>();
const GAP_DETAIL_LIMIT_MARKER = "gaps:detail-limit-exceeded";
const GAP_ENTRY_LIMIT_MARKER = "gaps:entry-limit-exceeded";

function pushGap(gaps: string[], gap: string): void {
  let index = gapIndexes.get(gaps);
  if (!index) {
    index = new Set(gaps);
    gapIndexes.set(gaps, index);
  }
  if (index.has(GAP_ENTRY_LIMIT_MARKER)) return;

  const boundedGap = gap.length > RELEASE_ASSET_MANIFEST_LIMITS.gapLength ||
      gap.length === 0 ||
      gap.trim() !== gap ||
      hasControlCharacters(gap)
    ? GAP_DETAIL_LIMIT_MARKER
    : gap;
  if (index.has(boundedGap)) return;

  if (index.size >= RELEASE_ASSET_MANIFEST_LIMITS.fallbackGaps - 1) {
    index.add(GAP_ENTRY_LIMIT_MARKER);
    gaps.push(GAP_ENTRY_LIMIT_MARKER);
    return;
  }

  index.add(boundedGap);
  gaps.push(boundedGap);
}

function dependencyLookupKeys(specifier: string): Set<string> {
  const keys = new Set<string>([specifier, normalizeDependencySpecifier(specifier)]);
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    const normalizedHttp = normalizeHttpUrl(specifier);
    keys.add(normalizedHttp);
    keys.add(normalizeDependencySpecifier(normalizedHttp));
  }
  return keys;
}

function findDependencyModuleBySpecifier(
  dependencies: Map<string, DependencyModule>,
  specifier: string,
): DependencyModule | null {
  const lookupKeys = dependencyLookupKeys(specifier);
  for (const key of lookupKeys) {
    const direct = dependencies.get(key);
    if (direct) return direct;
  }

  for (const dependency of dependencies.values()) {
    if (lookupKeys.has(dependency.manifestKey)) {
      return dependency;
    }
    for (const dependencySpecifier of dependency.specifiers) {
      for (const key of dependencyLookupKeys(dependencySpecifier)) {
        if (lookupKeys.has(key)) return dependency;
      }
      if (lookupKeys.has(normalizeDependencySpecifier(dependencySpecifier))) {
        return dependency;
      }
    }
  }

  return null;
}

async function collectReactImportMapDependencyModules(
  input: { reactVersion?: string },
  tempDir: string,
  vendorHttpImports: ReleaseAssetHttpDependencyVendor,
  dependencies: DependencyModuleCollection,
): Promise<void> {
  const reactUrls = getReactUrls(input.reactVersion);
  const entries: Array<readonly [string, string]> = [];
  for (const specifier of REACT_IMPORT_MAP_DEPENDENCIES) {
    const url = reactUrls[specifier];
    if (url) entries.push([specifier, url] as const);
  }

  const source = entries.map(([, url]) => `import ${JSON.stringify(url)};`).join("\n");
  if (!source) return;

  const vendored = validateVendorResult(
    await vendorHttpImports(source, {
      tempDir,
      reactVersion: input.reactVersion,
    }),
  );
  const staged = stageDependencyModules(vendored.dependencies);

  for (const [specifier, url] of entries) {
    const dependency = findDependencyModuleBySpecifier(staged.modules, url);
    if (!dependency) {
      throw new Error(`React import-map dependency missing: ${specifier}`);
    }
    addStagedDependencySpecifier(staged, dependency, specifier);
  }

  commitDependencyModules(dependencies, staged);
}

function resolveLocalDependencyPath(specifier: string, parentFilePath?: string): string | null {
  const normalized = normalizeDependencySpecifier(specifier);

  if (normalized.startsWith("file://")) {
    try {
      const url = new URL(normalized);
      if (
        url.protocol !== "file:" ||
        (url.hostname !== "" && url.hostname !== "localhost") ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== ""
      ) {
        return null;
      }
      return normalize(fromFileUrl(url));
    } catch (_) {
      return null;
    }
  }

  if (!parentFilePath || (!normalized.startsWith("./") && !normalized.startsWith("../"))) {
    return null;
  }

  return normalize(join(dirname(parentFilePath), normalized));
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const file = normalize(filePath);
  const root = normalize(rootPath);
  return file === root || file.startsWith(`${root}/`) || file.startsWith(`${root}\\`);
}

async function readHttpDependencyCacheFile(
  fs: ReturnType<typeof createFileSystem>,
  filePath: string,
): Promise<{ code: string; sourceUrl: string }> {
  const fileInfo = fs.lstat ? await fs.lstat(filePath) : await fs.stat(filePath);
  if (
    fileInfo.isSymlink ||
    !fileInfo.isFile ||
    fileInfo.isDirectory ||
    !Number.isSafeInteger(fileInfo.size) ||
    fileInfo.size < 0 ||
    fileInfo.size > RELEASE_ASSET_MAX_SIZE_BYTES
  ) {
    throw new Error("HTTP dependency cache file is not a safe bounded regular file");
  }

  const bytes = await fs.readFile(filePath);
  if (
    bytes.byteLength !== fileInfo.size ||
    bytes.byteLength > RELEASE_ASSET_MAX_SIZE_BYTES
  ) {
    throw new Error("HTTP dependency cache file changed while it was being read");
  }

  let code: string;
  try {
    code = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("HTTP dependency cache file is not valid UTF-8", { cause: error });
  }

  const embeddedSourceUrl = extractSourceUrl(code);
  if (
    !isSafeBuildText(embeddedSourceUrl, MAX_DEPENDENCY_SPECIFIER_LENGTH) ||
    (!embeddedSourceUrl.startsWith("http://") &&
      !embeddedSourceUrl.startsWith("https://"))
  ) {
    throw new Error("HTTP dependency cache file is missing a valid HTTP source marker");
  }

  let parsedSourceUrl: URL;
  try {
    parsedSourceUrl = new URL(embeddedSourceUrl);
  } catch (error) {
    throw new Error("HTTP dependency cache file has an invalid HTTP source marker", {
      cause: error,
    });
  }
  if (parsedSourceUrl.protocol !== "http:" && parsedSourceUrl.protocol !== "https:") {
    throw new Error("HTTP dependency cache file has an invalid HTTP source marker");
  }

  const sourceUrl = normalizeHttpUrl(parsedSourceUrl.toString());
  if (!isSafeBuildText(sourceUrl, MAX_DEPENDENCY_SPECIFIER_LENGTH)) {
    throw new Error("HTTP dependency cache source exceeds the supported boundary");
  }
  return { code, sourceUrl };
}

function isSafeBuildText(
  value: unknown,
  maximumLength: number = MAX_BUILD_IDENTIFIER_LENGTH,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !hasControlCharacters(value);
}

function requireCanonicalReleaseFilePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RELEASE_FILE_PATH_LENGTH ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.endsWith("/") ||
    value.endsWith("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacters(value)
  ) {
    throw new Error("Release file path must be a canonical relative path");
  }

  const normalizedValue = value.replace(/\\/g, "/");
  const parts = normalizedValue.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..") ||
    normalizeLogicalPath(normalizedValue) !== normalizedValue
  ) {
    throw new Error("Release file path must be a canonical relative path");
  }

  return normalizedValue;
}

function resolveMaterializedReleasePath(tempDir: string, filePath: string): string {
  const result = validatePathSync(filePath, {
    baseDir: tempDir,
    level: "strict",
    allowAbsolute: false,
  });
  const resolvedPath = result.canonicalPath ? normalize(result.canonicalPath) : null;

  if (
    !result.valid ||
    !resolvedPath ||
    resolvedPath === normalize(tempDir) ||
    !isPathInsideRoot(resolvedPath, tempDir)
  ) {
    throw new Error("Release file path must stay within the build directory");
  }

  return resolvedPath;
}

async function collectLocalHttpDependencyModules(
  code: string,
  dependencies: DependencyModuleCollection,
  cacheDir: string,
): Promise<void> {
  const fs = createFileSystem();
  const cacheRoot = normalize(cacheDir);
  let physicalCacheRoot: string | undefined;
  const seen = new Set<string>();
  const queue: Array<{ specifier: string; parentFilePath?: string }> = [];

  for (const imp of await parseImports(code)) {
    if (!imp.n) continue;
    if (
      queue.length >= MAX_DEPENDENCY_SPECIFIERS ||
      !isSafeBuildText(imp.n, MAX_DEPENDENCY_SPECIFIER_LENGTH)
    ) {
      throw new Error("Vendored dependency import queue exceeds the supported boundary");
    }
    queue.push({ specifier: imp.n });
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    if (seen.size >= MAX_DEPENDENCY_MODULES) {
      throw new Error(`Vendored dependency graph exceeds ${MAX_DEPENDENCY_MODULES} modules`);
    }
    const { specifier, parentFilePath } = queue[queueIndex]!;
    const filePath = resolveLocalDependencyPath(specifier, parentFilePath);
    if (!filePath || seen.has(filePath)) continue;
    if (!isPathInsideRoot(filePath, cacheRoot)) {
      throw new Error(`Vendored HTTP dependency resolved outside cache root: ${specifier}`);
    }
    physicalCacheRoot ??= normalize(await realPath(cacheDir));
    const physicalFilePath = normalize(await realPath(filePath));
    if (!isPathInsideRoot(physicalFilePath, physicalCacheRoot)) {
      throw new Error(`Vendored HTTP dependency escaped its physical cache root: ${specifier}`);
    }
    seen.add(filePath);

    const { code: depCode, sourceUrl: manifestKey } = await readHttpDependencyCacheFile(
      fs,
      filePath,
    );
    const fileUrl = toFileUrl(filePath).href;
    const depSpecifiers = new Set<string>([
      normalizeDependencySpecifier(specifier),
      fileUrl,
    ]);

    mergeDependencyModules(
      dependencies,
      [...depSpecifiers].map((depSpecifier) => ({
        manifestKey,
        specifier: depSpecifier,
        sourcePath: filePath,
        code: depCode,
      })),
    );

    for (const imp of await parseImports(depCode)) {
      if (!imp.n) continue;
      if (
        queue.length >= MAX_DEPENDENCY_SPECIFIERS ||
        !isSafeBuildText(imp.n, MAX_DEPENDENCY_SPECIFIER_LENGTH)
      ) {
        throw new Error("Vendored dependency import queue exceeds the supported boundary");
      }
      queue.push({ specifier: imp.n, parentFilePath: filePath });
    }
  }
}

async function vendorHttpImportsWithCache(
  code: string,
  options: { tempDir: string; reactVersion?: string },
): Promise<ReleaseAssetVendorResult> {
  const imports = await parseImports(code);
  if (
    !imports.some((imp) =>
      imp.n &&
      (imp.n.startsWith("http://") || imp.n.startsWith("https://") || imp.n.startsWith("npm:"))
    )
  ) {
    return { code, dependencies: [] };
  }

  const cacheDir = join(options.tempDir, ".veryfront-http-bundle");
  const result = await cacheHttpImportsToLocal(code, {
    cacheDir,
    importMap: { imports: {}, scopes: {} },
    reactVersion: options.reactVersion,
  });

  const dependencies = createDependencyModuleCollection();
  await collectLocalHttpDependencyModules(result.code, dependencies, cacheDir);

  return {
    code: result.code,
    dependencies: [...dependencies.modules.values()].flatMap((dependency) =>
      [...dependency.specifiers].map((specifier) => ({
        specifier,
        manifestKey: dependency.manifestKey,
        sourcePath: dependency.sourcePath,
        code: dependency.code,
      }))
    ),
  };
}

export async function buildReactImportMapDependencyAssets(options: {
  tempDir: string;
  reactVersion?: string;
  vendorHttpImports?: ReleaseAssetHttpDependencyVendor;
}): Promise<{
  dependencies: Record<string, PreparedAsset>;
  assets: PreparedReleaseAsset[];
  gaps: string[];
}> {
  const dependencyModules = createDependencyModuleCollection();
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = createPendingAssetStore();
  const gaps: string[] = [];
  const vendorHttpImports = options.vendorHttpImports ?? vendorHttpImportsWithCache;

  await collectReactImportMapDependencyModules(
    { reactVersion: options.reactVersion },
    options.tempDir,
    vendorHttpImports,
    dependencyModules,
  );

  const finalized = await finalizeDependencyModules(
    dependencyModules.modules,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  const dependencies = exposeDependencySpecifierAliases(
    finalized.assets,
    dependencyModules.modules,
  );

  return {
    dependencies,
    assets: uploadQueue.flatMap((asset) => {
      const stored = getPendingAsset(pendingBytes, asset);
      if (!stored) return [];
      return [{
        ...asset,
        bytes: stored.bytes,
      }];
    }),
    gaps,
  };
}

async function collectCachedHttpDependencyModules(
  cacheDir: string,
  physicalCacheRoot: string,
  dependencies: DependencyModuleCollection,
): Promise<void> {
  const fs = createFileSystem();
  const cacheRoot = normalize(cacheDir);

  let fileCount = 0;
  let entryCount = 0;

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPENDENCY_DIRECTORY_DEPTH) {
      throw new Error(
        `Cached dependency tree exceeds ${MAX_DEPENDENCY_DIRECTORY_DEPTH} levels`,
      );
    }
    const entries: Array<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink?: boolean;
    }> = [];
    for await (const entry of fs.readDir(dir)) {
      entryCount++;
      if (entryCount > MAX_DEPENDENCY_SPECIFIERS) {
        throw new Error(
          `Cached dependency tree exceeds ${MAX_DEPENDENCY_SPECIFIERS} filesystem entries`,
        );
      }
      entries.push(entry);
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymlink) {
        throw new Error(`Cached HTTP dependency tree contains a symbolic link: ${path}`);
      }
      if (entry.isDirectory) {
        await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile || !/^http-[a-z0-9]+\.mjs$/i.test(entry.name)) continue;
      fileCount++;
      if (fileCount > MAX_DEPENDENCY_MODULES) {
        throw new Error(`Cached dependency tree exceeds ${MAX_DEPENDENCY_MODULES} modules`);
      }
      const filePath = normalize(path);
      if (!isPathInsideRoot(filePath, cacheRoot)) {
        throw new Error(`Cached HTTP dependency resolved outside cache root: ${filePath}`);
      }
      const physicalFilePath = normalize(await realPath(filePath));
      if (!isPathInsideRoot(physicalFilePath, physicalCacheRoot)) {
        throw new Error(`Cached HTTP dependency escaped its physical cache root: ${filePath}`);
      }

      const { code, sourceUrl: manifestKey } = await readHttpDependencyCacheFile(
        fs,
        filePath,
      );

      mergeDependencyModules(
        dependencies,
        [toFileUrl(filePath).href, manifestKey].map((specifier) => ({
          manifestKey,
          specifier,
          sourcePath: filePath,
          code,
        })),
      );
    }
  }

  await visit(cacheDir, 0);
}

export async function buildCachedHttpDependencyAssets(options: {
  cacheDir: string;
}): Promise<{
  dependencies: Record<string, PreparedAsset>;
  assets: PreparedReleaseAsset[];
  gaps: string[];
}> {
  const fs = createFileSystem();
  let cacheStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    cacheStat = fs.lstat ? await fs.lstat(options.cacheDir) : await fs.stat(options.cacheDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { dependencies: {}, assets: [], gaps: [] };
    }
    throw error;
  }
  if (cacheStat.isSymlink || cacheStat.isFile || !cacheStat.isDirectory) {
    throw new Error("Cached HTTP dependency path is not a safe directory");
  }
  const physicalCacheRoot = normalize(await realPath(options.cacheDir));

  const dependencyModules = createDependencyModuleCollection();
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = createPendingAssetStore();
  const gaps: string[] = [];

  await collectCachedHttpDependencyModules(
    options.cacheDir,
    physicalCacheRoot,
    dependencyModules,
  );

  const finalized = await finalizeDependencyModules(
    dependencyModules.modules,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  const dependencies = exposeDependencySpecifierAliases(
    finalized.assets,
    dependencyModules.modules,
  );

  return {
    dependencies,
    assets: uploadQueue.flatMap((asset) => {
      const stored = getPendingAsset(pendingBytes, asset);
      if (!stored) return [];
      return [{
        ...asset,
        bytes: stored.bytes,
      }];
    }),
    gaps,
  };
}

async function finalizeDependencyModules(
  dependencyModules: Map<string, DependencyModule>,
  uploadQueue: PreparedAsset[],
  pendingBytes: PendingAssetStore,
  gaps: string[],
): Promise<FinalizedDependencyModules> {
  const bySpecifier = new Map<string, DependencyModule>();
  const byFilePath = new Map<string, DependencyModule>();
  for (const dependency of dependencyModules.values()) {
    for (const specifier of dependency.specifiers) {
      setDependencyModuleAlias(
        bySpecifier,
        normalizeDependencySpecifier(specifier),
        dependency,
      );
      const filePath = resolveLocalDependencyPath(specifier);
      if (filePath) setDependencyModuleAlias(byFilePath, filePath, dependency);
    }
    if (dependency.sourcePath) {
      setDependencyModuleAlias(
        byFilePath,
        normalize(dependency.sourcePath),
        dependency,
      );
    }
  }

  const finalized = new Map<string, PreparedAsset>();
  const fallbackUrls = new Map<string, string>();
  const skippedCycles = new Set<string>();
  const recordedCycleGaps = new Set<string>();
  const visiting: string[] = [];

  function resolveDependencyImport(
    specifier: string,
    parent: DependencyModule,
  ): DependencyModule | null {
    const filePath = resolveLocalDependencyPath(specifier, parent.sourcePath);
    if (filePath) {
      const localDependency = byFilePath.get(filePath);
      if (localDependency) return localDependency;
    }

    return bySpecifier.get(normalizeDependencySpecifier(specifier)) ?? null;
  }

  function recordDependencyCycle(cycleKeys: string[]): void {
    // Separate content-hashed ESM files cannot represent cyclic imports without
    // release-scoped aliases or bundling, so keep only that component on source URL fallback.
    for (const key of cycleKeys) skippedCycles.add(key);

    const gap = `dependency-cycle:${cycleKeys.join("->")}`;
    if (!recordedCycleGaps.has(gap)) {
      recordedCycleGaps.add(gap);
      pushGap(gaps, gap);
    }
  }

  function cycleFallbackFor(dependency: DependencyModule): string | null {
    if (!skippedCycles.has(dependency.manifestKey)) return null;
    return dependencyFallbackUrl(dependency);
  }

  async function finalize(manifestKey: string): Promise<PreparedAsset | null> {
    const existing = finalized.get(manifestKey);
    if (existing) return existing;
    if (visiting.includes(manifestKey)) {
      recordDependencyCycle([...visiting.slice(visiting.indexOf(manifestKey)), manifestKey]);
      return null;
    }
    if (skippedCycles.has(manifestKey)) return null;

    const dependency = dependencyModules.get(manifestKey);
    if (!dependency) return null;

    visiting.push(manifestKey);
    try {
      const imports = await parseImports(dependency.code);
      for (const imp of imports) {
        if (!imp.n) continue;
        const filePath = resolveLocalDependencyPath(imp.n, dependency.sourcePath);
        if (filePath && !byFilePath.has(filePath)) {
          throw new Error(`Unresolved vendored file dependency: ${imp.n}`);
        }
        const child = resolveDependencyImport(imp.n, dependency);
        if (!child) continue;
        if (child.manifestKey === manifestKey) {
          recordDependencyCycle([manifestKey, manifestKey]);
          continue;
        }
        await finalize(child.manifestKey);
      }

      if (skippedCycles.has(manifestKey)) return null;

      const rewritten = await replaceSpecifiers(dependency.code, (specifier) => {
        const child = resolveDependencyImport(specifier, dependency);
        if (!child) return null;
        const asset = finalized.get(child.manifestKey);
        if (asset) return releaseAssetUrl(asset.contentHash, "js");
        return cycleFallbackFor(child);
      });

      const entry = await addPreparedJavaScriptAsset(
        `__dependencies__/${manifestKey}`,
        rewritten,
        uploadQueue,
        pendingBytes,
      );
      if (!entry) {
        throw new Error(`Vendored dependency exceeds release asset size limit: ${manifestKey}`);
      }
      for (const specifier of dependency.specifiers) {
        setDependencyModuleAlias(
          bySpecifier,
          normalizeDependencySpecifier(specifier),
          dependency,
        );
      }
      finalized.set(manifestKey, entry);
      return entry;
    } finally {
      visiting.pop();
    }
  }

  try {
    for (const manifestKey of dependencyModules.keys()) await finalize(manifestKey);
  } finally {
    visiting.length = 0;
  }

  for (const manifestKey of skippedCycles) {
    const dependency = dependencyModules.get(manifestKey);
    if (!dependency) continue;

    const fallbackUrl = dependencyFallbackUrl(dependency);
    if (!fallbackUrl) {
      throw new Error(`Unrepresentable vendored dependency cycle: ${manifestKey}`);
    }

    addDependencyUrlAliases(fallbackUrls, dependency, fallbackUrl);
  }

  return { assets: Object.fromEntries(finalized), fallbackUrls };
}

async function finalizeProjectModules(
  transformedModules: Map<string, TransformedProjectModule>,
  knownPaths: Set<string>,
  dependencyUrls: Map<string, string>,
  uploadQueue: PreparedAsset[],
  pendingBytes: PendingAssetStore,
  gaps: string[],
): Promise<{ modules: Record<string, PreparedAsset>; skippedModules: Set<string> }> {
  const finalized = new Map<string, PreparedAsset>();
  const unresolvedCycles = new Set<string>();
  const nonSizeFailures = new Set<string>();
  const cyclicModules = await collectCyclicProjectModules(transformedModules, knownPaths, gaps);
  const skippedModules = new Set(cyclicModules);

  async function finalize(logicalPath: string, stack: string[]): Promise<PreparedAsset | null> {
    const existing = finalized.get(logicalPath);
    if (existing) return existing;
    if (cyclicModules.has(logicalPath)) return null;

    if (stack.includes(logicalPath)) {
      const cycle = [...stack.slice(stack.indexOf(logicalPath)), logicalPath].join("->");
      const gap = `cycle:${cycle}`;
      if (!unresolvedCycles.has(gap)) {
        unresolvedCycles.add(gap);
        pushGap(gaps, gap);
      }
      nonSizeFailures.add(logicalPath);
      return null;
    }

    const transformed = transformedModules.get(logicalPath);
    if (!transformed) return null;

    const nextStack = [...stack, logicalPath];
    let imports: Map<string, string>;
    try {
      imports = await collectProjectModuleImports(transformed.code, logicalPath, knownPaths);
    } catch (error) {
      pushGap(gaps, `module-import-parse-failed:${logicalPath}`);
      logger.warn("Module import parse failed during release asset finalization", {
        path: logicalPath,
        error: sanitizeError(error),
      });
      nonSizeFailures.add(logicalPath);
      return null;
    }
    for (const importedPath of imports.values()) {
      await finalize(importedPath, nextStack);
    }

    let rewritten: string;
    try {
      rewritten = await rewriteProjectModuleImports(
        transformed.code,
        logicalPath,
        finalized,
        knownPaths,
        dependencyUrls,
      );
      await assertNoLocalFileImports(rewritten);
    } catch (error) {
      pushGap(gaps, `module-rewrite-failed:${logicalPath}`);
      logger.warn("Module import rewrite failed during release asset finalization", {
        path: logicalPath,
        error: sanitizeError(error),
      });
      nonSizeFailures.add(logicalPath);
      return null;
    }
    const entry = await addPreparedJavaScriptAsset(
      logicalPath,
      rewritten,
      uploadQueue,
      pendingBytes,
    );

    if (!entry) return null;
    finalized.set(logicalPath, entry);
    return entry;
  }

  for (const logicalPath of transformedModules.keys()) {
    if (cyclicModules.has(logicalPath)) continue;

    const entry = await finalize(logicalPath, []);
    if (!entry) {
      skippedModules.add(logicalPath);
      if (!nonSizeFailures.has(logicalPath)) {
        pushGap(gaps, `oversized:${logicalPath}`);
      }
    }
  }

  return { modules: Object.fromEntries(finalized), skippedModules };
}

async function collectCyclicProjectModules(
  transformedModules: Map<string, TransformedProjectModule>,
  knownPaths: Set<string>,
  gaps: string[],
): Promise<Set<string>> {
  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const recordedCycles = new Set<string>();

  async function visit(logicalPath: string): Promise<void> {
    if (visited.has(logicalPath)) return;

    if (visiting.has(logicalPath)) {
      const index = stack.indexOf(logicalPath);
      if (index < 0) return;

      const cycleMembers = stack.slice(index);
      for (const member of cycleMembers) cyclic.add(member);

      const gap = `cycle:${[...cycleMembers, logicalPath].join("->")}`;
      if (!recordedCycles.has(gap)) {
        recordedCycles.add(gap);
        pushGap(gaps, gap);
      }
      return;
    }

    const transformed = transformedModules.get(logicalPath);
    if (!transformed) return;

    visiting.add(logicalPath);
    stack.push(logicalPath);

    let imports: Map<string, string>;
    try {
      imports = await collectProjectModuleImports(transformed.code, logicalPath, knownPaths);
    } catch (error) {
      cyclic.add(logicalPath);
      pushGap(gaps, `module-import-parse-failed:${logicalPath}`);
      logger.warn("Module import parse failed during release asset cycle collection", {
        path: logicalPath,
        error: sanitizeError(error),
      });
      stack.pop();
      visiting.delete(logicalPath);
      visited.add(logicalPath);
      return;
    }
    for (const importedPath of imports.values()) {
      if (transformedModules.has(importedPath)) await visit(importedPath);
    }

    stack.pop();
    visiting.delete(logicalPath);
    visited.add(logicalPath);
  }

  for (const logicalPath of transformedModules.keys()) await visit(logicalPath);
  return cyclic;
}

async function addPreparedJavaScriptAsset(
  logicalPath: string,
  code: string,
  uploadQueue: PreparedAsset[],
  pendingBytes: PendingAssetStore,
): Promise<PreparedAsset | null> {
  const bytes = new TextEncoder().encode(code) as Uint8Array<ArrayBuffer>;
  if (bytes.byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) return null;

  const contentHash = await computeHashBytes(bytes);
  const entry: PreparedAsset = {
    logicalPath,
    contentHash,
    size: bytes.byteLength,
    contentType: RELEASE_ASSET_CONTENT_TYPES.js,
  };
  if (rememberPendingAsset(pendingBytes, entry, bytes)) {
    uploadQueue.push(entry);
  }
  return entry;
}

async function buildFrameworkDependencies(
  input: FrameworkBuildContext,
  tempDir: string,
  transform: ReleaseAssetTransform,
  dependencyUrls: Map<string, string>,
  uploadQueue: PreparedAsset[],
  pendingBytes: PendingAssetStore,
  gaps: string[],
): Promise<Record<string, PreparedAsset>> {
  const fs = createFileSystem();
  const dependencies: Record<string, PreparedAsset> = {};
  const lookupDirs = [FRAMEWORK_SRC_DIR, FRAMEWORK_EMBEDDED_SRC_DIR, join(tempDir, "src")];
  const moduleAssets = new Map<string, PreparedAsset>();
  const visiting = new Set<string>();

  async function resolveFrameworkImport(
    specifier: string,
    fromSourcePath: string,
  ): Promise<string | null> {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolvedPath = await resolveRelativeFrameworkSourceImport(specifier, fromSourcePath);
      return resolvedPath ? frameworkSourcePathToSourceKey(resolvedPath, lookupDirs) : null;
    }

    if (specifier.startsWith(FRAMEWORK_MODULE_URL_PREFIX)) {
      return frameworkModuleUrlToSourceKey(specifier);
    }

    return null;
  }

  async function processFrameworkModule(
    sourceKey: string,
    publicSpecifier: string,
  ): Promise<PreparedAsset | null> {
    const existing = moduleAssets.get(sourceKey);
    if (existing) return existing;

    if (visiting.has(sourceKey)) {
      pushGap(gaps, `dependency-cycle:${publicSpecifier}:${sourceKey}`);
      return null;
    }

    const frameworkSource = await resolveFrameworkSourcePath(sourceKey, {
      extraLookupDirs: [join(tempDir, "src")],
    });
    const embeddedCode = frameworkSource ? null : embeddedFrameworkModuleCode(sourceKey);
    if (!frameworkSource && embeddedCode === null) {
      pushGap(gaps, `dependency-missing:${publicSpecifier}:${sourceKey}`);
      return null;
    }

    visiting.add(sourceKey);
    let code: string;
    try {
      const sourcePath = frameworkSource?.path ?? join(tempDir, `${sourceKey}.js`);
      const source = embeddedCode ?? await fs.readTextFile(sourcePath);
      code = await transform(source, sourcePath, tempDir, input.adapter, {
        projectId: input.projectId,
        dev: false,
        ssr: false,
        reactVersion: input.reactVersion,
      });

      const frameworkImportUrls = new Map<string, string>();
      let hasUnresolvedFrameworkImport = false;
      for (const imp of await parseImports(code)) {
        if (!imp.n) continue;

        const importedSourceKey = await resolveFrameworkImport(imp.n, sourcePath);
        if (!importedSourceKey) continue;

        const importedAsset = await processFrameworkModule(importedSourceKey, publicSpecifier);
        if (!importedAsset) {
          hasUnresolvedFrameworkImport = true;
          break;
        }
        frameworkImportUrls.set(imp.n, releaseAssetUrl(importedAsset.contentHash, "js"));
      }
      if (hasUnresolvedFrameworkImport) {
        visiting.delete(sourceKey);
        return null;
      }

      code = await replaceSpecifiers(
        code,
        (specifier) =>
          frameworkImportUrls.get(specifier) ??
            dependencyUrlForSpecifier(dependencyUrls, specifier),
      );
    } catch (error) {
      pushGap(gaps, `dependency-transform-failed:${publicSpecifier}:${sourceKey}`);
      logger.warn("Framework dependency transform failed during release asset build", {
        specifier: publicSpecifier,
        sourceKey,
        error: sanitizeError(error),
      });
      visiting.delete(sourceKey);
      return null;
    }

    visiting.delete(sourceKey);

    const entry = await addPreparedJavaScriptAsset(
      `__dependencies__/${frameworkSourceKeyToModuleUrl(sourceKey)}`,
      code,
      uploadQueue,
      pendingBytes,
    );
    if (!entry) {
      pushGap(gaps, `dependency-oversized:${publicSpecifier}:${sourceKey}`);
      return null;
    }

    moduleAssets.set(sourceKey, entry);
    return entry;
  }

  for (const [specifier, moduleUrl] of Object.entries(PLATFORM_UTILITIES)) {
    const sourceKey = frameworkModuleUrlToSourceKey(moduleUrl);
    if (!sourceKey) continue;

    const entry = await processFrameworkModule(sourceKey, specifier);
    if (!entry) {
      continue;
    }

    dependencies[specifier] = entry;
  }

  return dependencies;
}

export async function buildFrameworkDependencyAssets(options: {
  tempDir: string;
  adapter: RuntimeAdapter;
  reactVersion?: string;
  projectId?: string;
  transform?: ReleaseAssetTransform;
  dependencyUrls: Map<string, string>;
}): Promise<{
  dependencies: Record<string, PreparedAsset>;
  assets: PreparedReleaseAsset[];
  gaps: string[];
}> {
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = createPendingAssetStore();
  const gaps: string[] = [];
  const transform = options.transform ?? transformToESM;
  const dependencies = await buildFrameworkDependencies(
    {
      projectId: options.projectId ?? "local",
      reactVersion: options.reactVersion,
      adapter: options.adapter,
    },
    options.tempDir,
    transform,
    options.dependencyUrls,
    uploadQueue,
    pendingBytes,
    gaps,
  );

  return {
    dependencies,
    assets: uploadQueue.flatMap((asset) => {
      const stored = getPendingAsset(pendingBytes, asset);
      if (!stored) return [];
      return [{
        ...asset,
        bytes: stored.bytes,
      }];
    }),
    gaps,
  };
}

function addFrameworkDependencyUrlAliases(
  urls: Map<string, string>,
  dependencies: Record<string, PreparedAsset>,
): void {
  for (const [specifier, entry] of Object.entries(dependencies)) {
    const url = releaseAssetUrl(entry.contentHash, "js");
    setDependencyUrlAlias(urls, specifier, url);

    const moduleUrl = PLATFORM_UTILITIES[specifier];
    if (moduleUrl) setDependencyUrlAlias(urls, moduleUrl, url);
  }
}

/**
 * Walk the transformed import graph from a set of entry points using BFS.
 * Returns all reachable logical paths (entries included).
 * Modules not in `transformedModules` are recorded as closure gaps.
 */
async function collectRouteClosure(
  entrypoints: string[],
  transformedModules: Map<string, TransformedProjectModule>,
  knownPaths: Set<string>,
): Promise<{ modules: string[]; gaps: string[] }> {
  const visited = new Set<string>();
  const queue = [...entrypoints];
  const gaps: string[] = [];

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex]!;
    if (visited.has(current)) continue;
    visited.add(current);

    const transformed = transformedModules.get(current);
    if (!transformed) {
      // Module referenced but not transformable or not successfully transformed.
      pushGap(gaps, `closure-missing:${current}`);
      continue;
    }

    let imports: Map<string, string>;
    try {
      imports = await collectProjectModuleImports(transformed.code, current, knownPaths);
    } catch (error) {
      pushGap(gaps, `closure-import-parse-failed:${current}`);
      logger.warn("Route closure import parse failed during release asset build", {
        path: current,
        error: sanitizeError(error),
      });
      continue;
    }
    for (const importedPath of imports.values()) {
      if (!visited.has(importedPath)) queue.push(importedPath);
    }
  }

  return { modules: [...visited], gaps };
}

function validateReleaseAssetBuildInput(
  input: ReleaseAssetBuildInput,
  tempDir: string,
): void {
  if (!isSafeBuildText(input.projectReference)) {
    throw new Error("Release asset project reference is invalid");
  }
  if (!isSafeBuildText(input.projectId)) {
    throw new Error("Release asset project ID is invalid");
  }
  if (!isSafeBuildText(input.releaseId)) {
    throw new Error("Release asset release ID is invalid");
  }
  if (!isSafeBuildText(input.releaseVersionRef)) {
    throw new Error("Release asset release version reference is invalid");
  }
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion < 0) {
    throw new Error("Release asset release version must be a non-negative safe integer");
  }
  if (!isSafeBuildText(tempDir, MAX_RELEASE_FILE_PATH_LENGTH)) {
    throw new Error("Release asset temporary directory is invalid");
  }
  if (
    input.reactVersion !== undefined &&
    !isSafeBuildText(input.reactVersion, MAX_BUILD_IDENTIFIER_LENGTH)
  ) {
    throw new Error("Release asset React version is invalid");
  }
  if (
    input.stylesheetPath !== undefined &&
    !isSafeBuildText(input.stylesheetPath, MAX_RELEASE_FILE_PATH_LENGTH)
  ) {
    throw new Error("Release asset stylesheet path is invalid");
  }
  if (
    typeof input.client?.beginReleaseAssetManifestBuild !== "function" ||
    typeof input.client.listAllReleaseFiles !== "function" ||
    typeof input.client.uploadReleaseAsset !== "function" ||
    typeof input.client.putReleaseAssetManifest !== "function" ||
    typeof input.client.reportReleaseAssetManifestState !== "function"
  ) {
    throw new Error("Release asset build client is incomplete");
  }
  if (input.transform !== undefined && typeof input.transform !== "function") {
    throw new Error("Release asset transform must be a function");
  }
  if (
    input.vendorHttpImports !== undefined &&
    typeof input.vendorHttpImports !== "function"
  ) {
    throw new Error("Release asset dependency vendor must be a function");
  }
}

function validateBuildStart(
  value: Awaited<ReturnType<ReleaseAssetBuildClient["beginReleaseAssetManifestBuild"]>>,
): number {
  if (
    !value ||
    typeof value !== "object" ||
    !isSafeBuildText(value.id) ||
    !Number.isSafeInteger(value.manifest_version) ||
    value.manifest_version < 0 ||
    (value.state !== "queued" && value.state !== "building")
  ) {
    throw new Error("Release asset build start was not acknowledged");
  }
  return value.manifest_version;
}

/**
 * Execute a release asset build. Pure orchestration over the injected client
 * and a runtime-provided temp dir + react version.
 */
export async function runReleaseAssetBuild(
  input: ReleaseAssetBuildInput,
  tempDir: string,
): Promise<ReleaseAssetBuildResult> {
  const { client } = input;
  try {
    validateReleaseAssetBuildInput(input, tempDir);
    const transform: ReleaseAssetTransform = input.transform ??
      ((source, sourceFile, projectDir, adapter, options) =>
        transformToESM(source, sourceFile, projectDir, adapter, {
          projectId: options.projectId,
          dev: options.dev,
          ssr: options.ssr,
          studioEmbed: false,
          reactVersion: options.reactVersion,
        }));

    // Wrap the whole build so any non-transform failure also reports failed.
    return await runBuildInner(input, tempDir, client, transform);
  } catch (error) {
    const sanitized = sanitizeError(error);
    logger.warn("Release asset build failed (non-transform error)", {
      releaseId: input.releaseId,
      error: sanitized,
    });
    try {
      await client.reportReleaseAssetManifestState(
        input.releaseVersionRef,
        "failed",
        sanitized,
      );
    } catch (reportErr) {
      logger.warn("Failed to report build failure state", {
        releaseId: input.releaseId,
        error: sanitizeError(reportErr),
      });
    }
    return {
      success: false,
      state: "failed",
      moduleCount: 0,
      cssCount: 0,
      routeCount: 0,
      gaps: [],
      error: sanitized,
    };
  }
}

async function resolveReleaseReactVersion(
  sourceByPath: Map<string, string>,
  releaseConfig: VeryfrontConfig,
  fallbackReactVersion: string | undefined,
  tempDir: string,
): Promise<string | undefined> {
  const hasReleaseReactConfig = !!releaseConfig.react?.version ||
    (releaseConfig.client?.cdn?.versions !== undefined &&
      releaseConfig.client.cdn.versions !== "auto");
  const hasReleasePackageJson = sourceByPath.has("package.json");
  const releaseReactVersion = await resolveProjectReactVersion({
    projectDir: tempDir,
    config: releaseConfig,
  });

  if (hasReleaseReactConfig || hasReleasePackageJson || fallbackReactVersion === undefined) {
    return releaseReactVersion;
  }

  return fallbackReactVersion;
}

async function runBuildInner(
  input: ReleaseAssetBuildInput,
  tempDir: string,
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetTransform,
): Promise<ReleaseAssetBuildResult> {
  // 1. Begin (idempotent) and retain the server-owned manifest generation.
  const beginResult = await client.beginReleaseAssetManifestBuild(input.releaseVersionRef);
  const manifestVersion = validateBuildStart(beginResult);

  // 2. Materialize the release file set.
  const files = await client.listAllReleaseFiles(input.releaseVersionRef);
  if (!Array.isArray(files) || files.length > MAX_RELEASE_FILES) {
    throw new Error(`Release file list exceeds ${MAX_RELEASE_FILES} entries`);
  }
  const fs = createFileSystem();
  const sourceByPath = new Map<string, string>();
  let sourceBytes = 0;
  let transformableSourceCount = 0;

  for (const file of files) {
    if (!file || typeof file !== "object") {
      throw new Error("Release file entry must be an object");
    }
    if (typeof file.content !== "string") continue;
    const logicalPath = requireCanonicalReleaseFilePath(file.path);
    if (sourceByPath.has(logicalPath)) {
      throw new Error("Release file list contains a duplicate path");
    }
    if (isTransformableBrowserModule(logicalPath)) {
      transformableSourceCount++;
      if (transformableSourceCount > RELEASE_ASSET_MANIFEST_LIMITS.moduleEntries) {
        throw new Error(
          `Release browser modules exceed ${RELEASE_ASSET_MANIFEST_LIMITS.moduleEntries} entries`,
        );
      }
    }
    const contentBytes = textEncoder.encode(file.content).byteLength;
    if (contentBytes > RELEASE_ASSET_MAX_SIZE_BYTES) {
      throw new Error(`Release source file exceeds ${RELEASE_ASSET_MAX_SIZE_BYTES} bytes`);
    }
    sourceBytes += contentBytes;
    if (sourceBytes > MAX_RELEASE_SOURCE_BYTES) {
      throw new Error(`Release source files exceed ${MAX_RELEASE_SOURCE_BYTES} bytes`);
    }

    const abs = resolveMaterializedReleasePath(tempDir, logicalPath);
    sourceByPath.set(logicalPath, file.content);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeTextFile(abs, file.content);
  }

  const sourceContentHash = await releaseFileSetSignature(sourceByPath);

  // 3 + 4. Collect the browser module closure and transform each module
  // through the SAME pipeline serveModule uses (browser, non-SSR).
  const transformedModules = new Map<string, TransformedProjectModule>();
  const dependencyModules = createDependencyModuleCollection();
  const gaps: string[] = [];
  const uploadQueue: PreparedAsset[] = [];
  // Bytes are held per-hash only until uploaded, then dropped (M3).
  const pendingBytes = createPendingAssetStore();
  const knownPaths = new Set(sourceByPath.keys());
  const vendorHttpImports = input.vendorHttpImports ?? vendorHttpImportsWithCache;
  const vendorDependencies = isDependencyImportMapEnabled();
  const releaseConfig = await resolveReleaseConfigFromSourceFiles(
    sourceByPath,
    sourceContentHash,
    input,
    tempDir,
  );
  const routeDirectories = releaseRouterDirectories(releaseConfig);
  const releaseReactVersion = await resolveReleaseReactVersion(
    sourceByPath,
    releaseConfig,
    input.reactVersion,
    tempDir,
  );

  async function transformProjectModule(
    logicalPath: string,
  ): Promise<string[]> {
    if (transformedModules.has(logicalPath) || !isTransformableBrowserModule(logicalPath)) {
      return [];
    }

    const source = sourceByPath.get(logicalPath);
    if (typeof source !== "string") return [];

    const sourceFile = join(tempDir, logicalPath);
    let code: string;
    try {
      code = await transform(source, sourceFile, tempDir, input.adapter, {
        projectId: input.projectId,
        dev: false,
        ssr: false,
        reactVersion: releaseReactVersion,
      });
    } catch (error) {
      const sanitized = sanitizeError(error);
      pushGap(gaps, `module-transform-failed:${logicalPath}`);
      logger.warn("Module transform failed during release asset build", {
        path: logicalPath,
        error: sanitized,
      });
      return [];
    }
    if (typeof code !== "string") {
      pushGap(gaps, `module-transform-failed:${logicalPath}`);
      logger.warn("Module transform returned a non-string result", {
        path: logicalPath,
      });
      return [];
    }
    const transformedSize = textEncoder.encode(code).byteLength;
    if (transformedSize > RELEASE_ASSET_MAX_SIZE_BYTES) {
      pushGap(gaps, `oversized:${logicalPath}`);
      logger.warn("Module transform output exceeds the release asset limit", {
        path: logicalPath,
        size: transformedSize,
        limit: RELEASE_ASSET_MAX_SIZE_BYTES,
      });
      return [];
    }

    const unvendoredCode = code;
    let imports: Map<string, string> | undefined;
    if (vendorDependencies) {
      try {
        const vendored = validateVendorResult(
          await vendorHttpImports(code, {
            tempDir,
            reactVersion: releaseReactVersion,
          }),
        );
        const stagedDependencies = stageDependencyModules(vendored.dependencies);
        const vendoredImports = await collectProjectModuleImports(
          vendored.code,
          logicalPath,
          knownPaths,
        );
        commitDependencyModules(dependencyModules, stagedDependencies);
        code = vendored.code;
        imports = vendoredImports;
      } catch (error) {
        const sanitized = sanitizeError(error);
        pushGap(gaps, `module-dependency-vendor-failed:${logicalPath}`);
        logger.warn("HTTP dependency vendoring failed during release asset build", {
          path: logicalPath,
          error: sanitized,
        });
        code = unvendoredCode;
      }
    }

    if (!imports) {
      try {
        imports = await collectProjectModuleImports(code, logicalPath, knownPaths);
      } catch (error) {
        const sanitized = sanitizeError(error);
        pushGap(gaps, `module-import-parse-failed:${logicalPath}`);
        logger.warn("Module import parse failed during release asset build", {
          path: logicalPath,
          error: sanitized,
        });
        return [];
      }
    }

    transformedModules.set(logicalPath, { logicalPath, code, unvendoredCode });
    return [...imports.values()];
  }

  const moduleQueue: string[] = [];
  const queuedModules = new Set<string>();
  for (const logicalPath of sourceByPath.keys()) {
    if (!isBrowserModule(logicalPath, routeDirectories)) continue;
    moduleQueue.push(logicalPath);
    queuedModules.add(logicalPath);
  }
  for (let index = 0; index < moduleQueue.length; index++) {
    const logicalPath = moduleQueue[index]!;
    for (const importedPath of await transformProjectModule(logicalPath)) {
      if (queuedModules.has(importedPath)) continue;
      queuedModules.add(importedPath);
      moduleQueue.push(importedPath);
    }
  }

  if (vendorDependencies) {
    try {
      await collectReactImportMapDependencyModules(
        { ...input, reactVersion: releaseReactVersion },
        tempDir,
        vendorHttpImports,
        dependencyModules,
      );
    } catch (error) {
      const sanitized = sanitizeError(error);
      pushGap(gaps, "dependency-vendor-failed:react-import-map");
      logger.warn("React import-map dependency vendoring failed during release asset build", {
        error: sanitized,
      });
    }
  }

  let httpDependencies: Record<string, PreparedAsset>;
  let httpDependencyFallbackUrls: Map<string, string>;
  const dependencyUploadQueueStart = uploadQueue.length;
  try {
    const finalizedHttpDependencies = await finalizeDependencyModules(
      dependencyModules.modules,
      uploadQueue,
      pendingBytes,
      gaps,
    );
    httpDependencies = exposeDependencySpecifierAliases(
      finalizedHttpDependencies.assets,
      dependencyModules.modules,
      MAX_HTTP_DEPENDENCY_ENTRIES,
    );
    httpDependencyFallbackUrls = finalizedHttpDependencies.fallbackUrls;
  } catch (error) {
    const sanitized = sanitizeError(error);
    pushGap(gaps, "dependency-finalize-failed");
    logger.warn("HTTP dependency finalization failed during release asset build", {
      error: sanitized,
    });
    for (const transformed of transformedModules.values()) {
      transformed.code = transformed.unvendoredCode;
    }
    discardPendingAssetsSince(uploadQueue, pendingBytes, dependencyUploadQueueStart);
    clearDependencyModules(dependencyModules);
    httpDependencies = {};
    httpDependencyFallbackUrls = new Map();
  }
  const dependencyUrls = buildDependencyUrlMap(
    httpDependencies,
    dependencyModules.modules,
  );
  for (const [specifier, url] of httpDependencyFallbackUrls) {
    setDependencyUrlAlias(dependencyUrls, specifier, url);
  }
  const frameworkDependencies = await buildFrameworkDependencies(
    {
      projectId: input.projectId,
      adapter: input.adapter,
      reactVersion: releaseReactVersion,
    },
    tempDir,
    transform,
    dependencyUrls,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  if (vendorDependencies) addFrameworkDependencyUrlAliases(dependencyUrls, frameworkDependencies);
  const dependencies = mergePreparedAssetRecords(
    frameworkDependencies,
    httpDependencies,
  );
  if (Object.keys(dependencies).length > RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries) {
    throw new Error(
      `Release dependency manifest exceeds ${RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries} entries`,
    );
  }

  const { modules, skippedModules } = await finalizeProjectModules(
    transformedModules,
    knownPaths,
    dependencyUrls,
    uploadQueue,
    pendingBytes,
    gaps,
  );

  for (const logicalPath of transformedModules.keys()) {
    if (modules[logicalPath]) continue;
    if (skippedModules.has(logicalPath)) continue;

    logger.warn("Module exceeds max size, skipping", {
      path: logicalPath,
      limit: RELEASE_ASSET_MAX_SIZE_BYTES,
    });
  }

  // 5b. CSS: compile project CSS where reachable, else record css:[] and note.
  const css: ReleaseAssetCssEntry[] = [];
  const cssHashes: string[] = [];
  if (client.compileProjectCss) {
    try {
      const candidates = collectClassCandidates(sourceByPath);
      if (candidates.size > MAX_CSS_CANDIDATES) {
        pushGap(gaps, "css:candidate-limit");
        logger.warn("Release asset CSS candidate limit exceeded", {
          candidateCount: candidates.size,
          limit: MAX_CSS_CANDIDATES,
        });
      } else {
        const stylesheetPath = releaseConfig.tailwind?.stylesheet ?? input.stylesheetPath;
        const resolvedStylesheet = resolveProjectStylesheet(sourceByPath, stylesheetPath);
        const stylesheet = mergeModuleCssImports(sourceByPath, resolvedStylesheet);
        const stylesheetBytes = stylesheet ? textEncoder.encode(stylesheet).byteLength : 0;
        if (stylesheetBytes > MAX_CSS_INPUT_BYTES) {
          pushGap(gaps, "css:input-oversized");
          logger.warn("Release asset CSS input exceeds the compile limit", {
            size: stylesheetBytes,
            limit: MAX_CSS_INPUT_BYTES,
          });
        } else {
          const compiled = await client.compileProjectCss(candidates, stylesheet, {
            config: releaseConfig,
          });
          if (
            compiled &&
            typeof compiled.css === "string" &&
            compiled.css.length > 0 &&
            (compiled.styleProfileHash === null ||
              isSafeBuildText(
                compiled.styleProfileHash,
                MAX_STYLE_PROFILE_HASH_LENGTH,
              ))
          ) {
            const bytes = textEncoder.encode(compiled.css) as Uint8Array<ArrayBuffer>;
            if (bytes.byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) {
              pushGap(gaps, "css:oversized");
              logger.warn("Release asset CSS output exceeds the asset limit", {
                size: bytes.byteLength,
                limit: RELEASE_ASSET_MAX_SIZE_BYTES,
              });
            } else {
              const contentHash = await computeHashBytes(bytes);
              css.push({
                contentHash,
                size: bytes.byteLength,
                contentType: RELEASE_ASSET_CONTENT_TYPES.css,
                styleProfileHash: compiled.styleProfileHash,
              });
              cssHashes.push(contentHash);
              const asset: PreparedAsset = {
                logicalPath: `__css__/${contentHash}`,
                contentHash,
                size: bytes.byteLength,
                contentType: RELEASE_ASSET_CONTENT_TYPES.css,
              };
              if (rememberPendingAsset(pendingBytes, asset, bytes)) {
                uploadQueue.push(asset);
              }
            }
          } else {
            // The compiler degraded (returned null/empty/invalid) — record the
            // gap so a ready manifest never silently lacks promised CSS.
            pushGap(gaps, "css:compile-failed");
            logger.warn("Release asset CSS compile returned no usable output");
          }
        }
      }
    } catch (error) {
      // CSS is best-effort: record a gap, keep css:[].
      pushGap(gaps, "css:compile-failed");
      logger.warn("Release asset CSS compile failed (recording gap)", {
        error: sanitizeError(error),
      });
    }
  } else {
    pushGap(gaps, "css:no-pipeline");
  }

  // 5a. Upload assets with bounded concurrency, dropping bytes after each
  // successful upload (M3) to bound peak memory.
  await uploadWithConcurrency(uploadQueue, RELEASE_ASSET_UPLOAD_CONCURRENCY, async (asset) => {
    const stored = getPendingAsset(pendingBytes, asset);
    if (!stored) return;
    const acknowledgement = await client.uploadReleaseAsset(
      input.releaseVersionRef,
      asset.contentHash,
      stored.contentType,
      stored.bytes,
    );
    if (
      !acknowledgement ||
      typeof acknowledgement.stored !== "boolean" ||
      typeof acknowledgement.existed !== "boolean" ||
      (!acknowledgement.stored && !acknowledgement.existed)
    ) {
      throw new Error("Release asset upload was not acknowledged");
    }
    // M3: drop bytes immediately after upload.
    forgetPendingAsset(pendingBytes, asset);
  });

  // B2. Routes: walk the transformed browser import closure from each page entrypoint.
  // Modules missing from transformedModules are recorded as closure gaps.
  const routes: Record<string, ReleaseAssetRouteEntry> = {};
  const pageModules = Object.keys(modules).filter((p) =>
    routeForConfiguredPage(p, routeDirectories) !== null
  );

  for (const logicalPath of pageModules) {
    const route = routeForConfiguredPage(logicalPath, routeDirectories);
    if (!route) continue;

    const entryModules = [
      logicalPath,
      ...collectConfiguredAppRouterLayoutsForPage(logicalPath, routeDirectories, knownPaths),
    ];
    const { modules: closureModules, gaps: closureGaps } = await collectRouteClosure(
      entryModules,
      transformedModules,
      knownPaths,
    );

    // Include only modules we actually have in the manifest (transformed +
    // within size limit). Framework lib/* modules are excluded per contract
    // (they are embedded by the runtime, not shipped as release assets).
    const manifestedModules = closureModules.filter((m) => modules[m] !== undefined);

    // Closure members not in the manifest (missing transforms, oversized, or
    // framework-provided) are recorded as gaps for this route.
    for (const missing of closureModules) {
      if (modules[missing] === undefined && !missing.startsWith("lib/")) {
        pushGap(closureGaps, `route-gap:${route}:${missing}`);
      }
    }
    if (closureGaps.length > 0) {
      for (const gap of closureGaps) pushGap(gaps, gap);
    }

    routes[route] = { modules: manifestedModules, css: cssHashes };
  }

  // 6. Assemble and PUT the manifest.
  const manifest: ReleaseAssetManifest = {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: input.projectId,
    releaseId: input.releaseId,
    releaseVersion: input.releaseVersion,
    // H2: use the manifest_version returned by begin, not a hardcoded 1.
    manifestVersion,
    builderVersion: VERSION,
    sourceContentHash,
    createdAt: new Date().toISOString(),
    assetBasePath: RELEASE_ASSET_BASE_PATH,
    modules: Object.fromEntries(
      Object.entries(modules).map(([path, entry]) => [path, {
        contentHash: entry.contentHash,
        size: entry.size,
        contentType: entry.contentType,
      }]),
    ),
    css,
    routes,
    dependencies: Object.fromEntries(
      Object.entries(dependencies).map(([specifier, entry]) => [specifier, {
        contentHash: entry.contentHash,
        size: entry.size,
        contentType: entry.contentType,
      }]),
    ),
    fallback: { mode: "jit", gaps },
  };

  const verifiedManifest = parseReleaseAssetManifest(manifest);
  if (!verifiedManifest) {
    throw new Error("Release asset manifest failed internal validation");
  }
  const result = await client.putReleaseAssetManifest(
    input.releaseVersionRef,
    verifiedManifest,
  );
  if (
    !result ||
    typeof result !== "object" ||
    (result.state !== "ready" && result.state !== "partial") ||
    (result.manifest_version !== undefined &&
      (!Number.isSafeInteger(result.manifest_version) ||
        result.manifest_version !== manifestVersion))
  ) {
    throw new Error("Release asset manifest PUT was not acknowledged");
  }
  logger.info("Release asset manifest built", {
    releaseId: input.releaseId,
    manifestVersion,
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    state: result.state,
  });

  return {
    success: true,
    state: result.state,
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    gaps,
  };
}

function validateAndMergeReleaseConfig(userConfig: unknown): VeryfrontConfig {
  if (!userConfig || typeof userConfig !== "object" || Array.isArray(userConfig)) {
    throw new Error(`Expected object from veryfront.config, received ${typeof userConfig}`);
  }

  const validatedConfig = validateVeryfrontConfig(userConfig);
  return mergeLoadedConfig(validatedConfig);
}

const defineReleaseConfigWithEnv: typeof defineConfigWithEnv = <
  const T extends VeryfrontConfigInput,
>(
  factory: (env: string) => T,
  envConfig: Pick<EnvironmentConfig, "nodeEnv"> = { nodeEnv: "production" },
): T => defineConfigWithEnv(factory, envConfig);

const releaseConfigShim = createConfigShimModule("release-assets", {
  defineConfig,
  defineConfigWithEnv: defineReleaseConfigWithEnv,
  getEnv,
  mergeConfigs: mergeProjectConfigs,
});

const RELEASE_CONFIG_SHIM_NAMESPACE = "veryfront-release-config-shim";

const releaseConfigVeryfrontPlugin: Plugin = {
  name: "veryfront-release-config-shim",
  setup(build) {
    build.onResolve({ filter: /^veryfront$/ }, () => ({
      path: "veryfront-config-shim",
      namespace: RELEASE_CONFIG_SHIM_NAMESPACE,
    }));
    build.onLoad({ filter: /.*/, namespace: RELEASE_CONFIG_SHIM_NAMESPACE }, () => ({
      contents: releaseConfigShim.source,
      loader: "js",
    }));
  },
};

async function ensureReleaseConfigBundlerContracts(): Promise<void> {
  await ensureDefaultBundlerContracts();
  if (tryResolve("Bundler") && tryResolve("ModuleLexer")) return;

  const { EsbuildBundler, EsModuleLexer } = await import(
    "../../extensions/ext-bundler-esbuild/src/index.ts"
  );
  if (!tryResolve("Bundler")) register("Bundler", new EsbuildBundler());
  if (!tryResolve("ModuleLexer")) register("ModuleLexer", new EsModuleLexer());
}

async function bundleReleaseConfigForImport(
  tempDir: string,
  configFile: string,
  source: string,
): Promise<string> {
  await ensureReleaseConfigBundlerContracts();
  const { build } = await import("veryfront/extensions/bundler");
  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    packages: "external",
    external: ["node:*"],
    plugins: [releaseConfigVeryfrontPlugin],
    stdin: {
      contents: source,
      loader: getEsbuildLoader(configFile),
      resolveDir: tempDir,
      sourcefile: configFile,
    },
  });

  if (result.errors.length > 0) {
    throw new Error(
      `Failed to bundle veryfront.config: ${result.errors[0]?.text ?? "unknown error"}`,
    );
  }

  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("Failed to bundle veryfront.config: no output emitted");
  return output;
}

async function loadReleaseConfigModule(
  tempDir: string,
  configFile: string,
  source: string,
): Promise<unknown> {
  const fs = createFileSystem();
  const bundledConfigPath = join(tempDir, `.veryfront-release-${crypto.randomUUID()}.mjs`);
  await fs.writeTextFile(
    bundledConfigPath,
    await bundleReleaseConfigForImport(tempDir, configFile, source),
  );

  try {
    const moduleUrl = toFileUrl(bundledConfigPath);
    moduleUrl.searchParams.set("t", `${Date.now()}-${crypto.randomUUID()}`);
    const configModule = await import(moduleUrl.href);
    return configModule.default ?? configModule;
  } finally {
    await fs.remove(bundledConfigPath).catch(() => undefined);
  }
}

async function releaseFileSetSignature(sourceByPath: Map<string, string>): Promise<string> {
  const entries = [...sourceByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const serialized = JSON.stringify(entries);
  return await computeHashBytes(
    textEncoder.encode(serialized) as Uint8Array<ArrayBuffer>,
  );
}

async function resolveReleaseConfigFromSourceFiles(
  sourceByPath: Map<string, string>,
  releaseSignature: string,
  input: ReleaseAssetBuildInput,
  tempDir: string,
): Promise<VeryfrontConfig> {
  const configFile = VERYFRONT_CONFIG_FILES.find((candidate) =>
    typeof sourceByPath.get(candidate) === "string"
  );
  const source = configFile ? sourceByPath.get(configFile) : undefined;

  logger.debug("Loading release config from materialized release files", {
    releaseId: input.releaseId,
    releaseVersionRef: input.releaseVersionRef,
    releaseSignature,
    hasConfigFile: !!configFile,
  });

  if (!configFile || typeof source !== "string") return mergeLoadedConfig({});

  const userConfig = await loadReleaseConfigModule(tempDir, configFile, source);
  return validateAndMergeReleaseConfig(userConfig);
}

/**
 * Resolve the project Tailwind stylesheet from the materialized file set.
 * Tries the configured path first, then conventional defaults. Returns
 * `undefined` when none is present (the CSS compiler then uses its default).
 */
function resolveProjectStylesheet(
  sourceByPath: Map<string, string>,
  stylesheetPath: string | undefined,
): { content: string; path: string } | undefined {
  const candidatePaths = stylesheetPath
    ? [stylesheetPath, stylesheetPath.replace(/^\.?\//, "")]
    : ["globals.css", "src/globals.css"];
  for (const path of candidatePaths) {
    const content = sourceByPath.get(path);
    if (typeof content === "string") return { content, path };
  }
  return undefined;
}

/**
 * Merge plain CSS files imported by project modules (`import "./styles.css"`
 * in a layout or component) into the resolved stylesheet. The production SSR
 * pipeline includes these imports per page at render time; release assets are
 * compiled once per release, so the merge happens here instead — mirroring the
 * dev /_vf_styles route.
 *
 * `*.module.css` files are skipped: their class names are rewritten per-module
 * by the runtime, so inlining them raw would leak unscoped selectors.
 */
function mergeModuleCssImports(
  sourceByPath: Map<string, string>,
  stylesheet: { content: string; path: string } | undefined,
): string | undefined {
  const sourceFiles: Array<{ path: string; content: string }> = [];
  for (const [path, content] of sourceByPath) {
    if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    // Resolution is rooted at "/" so relative and @/ specifiers resolve
    // against the release file set's project-relative paths.
    sourceFiles.push({ path: `/${path}`, content });
  }

  const segments: string[] = [];
  for (const importedPath of collectCssImportPaths(sourceFiles, "/")) {
    const relativePath = importedPath.replace(/^\/+/, "");
    if (relativePath === stylesheet?.path) continue;
    if (relativePath.endsWith(".module.css")) continue;
    const content = sourceByPath.get(relativePath);
    if (content) segments.push(content);
  }

  if (segments.length === 0) return stylesheet?.content;

  logger.debug("Merged module CSS imports into release stylesheet", {
    importedCount: segments.length,
  });
  return [stylesheet?.content, ...segments].filter(Boolean).join("\n");
}

/** Extract Tailwind class candidates from materialized source. */
function collectClassCandidates(sourceByPath: Map<string, string>): Set<string> {
  const candidates = extractCandidatesFromFiles(
    [...sourceByPath.entries()].map(([path, content]) => ({ path, content })),
  );
  for (const candidate of FRAMEWORK_CANDIDATES) candidates.add(candidate);
  return candidates;
}

/** Run an async task over items with a fixed concurrency limit.
 *
 * Unlike a bare Promise.all of workers, each worker catches per-item
 * failures so a single bad upload never abandons the remaining queue.
 * All items are attempted; if any fail, an AggregateError is thrown
 * after all workers complete so callers know exactly which assets failed.
 */
async function uploadWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const errors: unknown[] = [];

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      try {
        await task(items[current]!);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `${errors.length} of ${items.length} asset uploads failed`,
    );
  }
}
