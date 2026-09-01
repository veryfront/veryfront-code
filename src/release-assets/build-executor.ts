/**
 * Release Asset Manifest — builder executor.
 *
 * Runs inside the project runtime as the `task:release-asset-build` handler.
 * Materializes a release's file set, transforms every browser module through
 * the SAME pipeline `serveModule` uses (byte parity is a hard requirement),
 * compiles route CSS where reachable, content-addresses and
 * uploads each asset, then assembles and PUTs the manifest (→ ready).
 *
 * Defensive by construction:
 * - Any browser graph or CSS coverage failure prevents manifest publication.
 * - Build failures (transform/list/hash/upload/PUT) report `failed`.
 * - The temp dir is always cleaned up by the caller.
 *
 * @module release-assets/build-executor
 */

import type { VeryfrontConfig } from "#veryfront/config";
import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
import { serverLogger } from "#veryfront/utils/logger/index.ts";
import {
  isCSSPipelineIdentity,
  isStyleProfileHash,
} from "#veryfront/utils/css-artifact-identity.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { getOsType } from "#veryfront/platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { STAT_OPERATION_EXTENSION_PRIORITY } from "#veryfront/platform/adapters/fs/veryfront/extension-priority.ts";
import { wrapAdapterWithSecurity } from "#veryfront/security/secure-fs.ts";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  relative,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import {
  FRAMEWORK_EMBEDDED_SRC_DIR,
  FRAMEWORK_SRC_DIR,
  resolveFrameworkSourcePath,
  resolveRelativeFrameworkSourceImport,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { PUBLISHED_RUNTIME_HELPERS } from "#veryfront/platform/compat/published-runtime-helpers.ts";
import { getFrameworkRoot } from "#veryfront/platform/compat/vfs-paths.ts";
import {
  normalizeHttpUrl,
  resolveBareSpecifier,
} from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { extractSourceUrl } from "#veryfront/transforms/esm/source-url-embed.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { parseLocalImports } from "#veryfront/transforms/esm/import-parser.ts";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";
import {
  parseEsmShSpecifier,
  resolveEsmShThroughImportMap,
} from "#veryfront/transforms/shared/esm-sh-import-map.ts";
import { isRuntimeImportMapSpecifier } from "#veryfront/transforms/import-rewriter/strategies/import-map-strategy.ts";
import { isEsmShUrl } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/parser/code-parser.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getReactUrls } from "#veryfront/transforms/esm/react-cdn.ts";
import { PLATFORM_UTILITIES } from "#veryfront/html/utils.ts";
import { extractCandidatesFromFiles } from "#veryfront/html/styles-builder/candidate-extractor.ts";
import {
  hasUseClientDirective,
  hasUseServerDirective,
} from "#veryfront/rendering/rsc/page-island.ts";
import { FRAMEWORK_CANDIDATES } from "#veryfront/server/handlers/dev/framework-candidates.generated.ts";
import { validateLexicalPath } from "#veryfront/security/path-validation.ts";
import {
  CSS_IMPORTING_SOURCE_EXTENSIONS,
  resolveCssImportPath,
} from "#veryfront/html/styles-builder/css-import-extraction.ts";
import { rewriteCssModuleContent } from "#veryfront/transforms/css-modules/naming.ts";
import { computeHashBytes } from "#veryfront/utils";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
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
  type ReleaseAssetDependencyMode,
  type ReleaseAssetManifest,
  type ReleaseAssetRouteEntry,
} from "./manifest-schema.ts";
import type { CompileProjectCssResult } from "./css-compile.ts";
import { materializeReleaseDependencyGraph } from "./dependency-artifact-graph.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { mergeImportMaps } from "#veryfront/modules/import-map/index.ts";
import {
  isFrameworkOwnedImportMapSpecifier,
  normalizeImportMapForRuntime,
} from "#veryfront/modules/import-map/loader.ts";
import { classifyBrowserModuleSourcePath } from "#veryfront/modules/server/browser-module-admission.ts";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "#veryfront/server/shared/browser-module-boundary.ts";
import { isRSCEnabled } from "#veryfront/utils/feature-flags.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";
import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import { isServerOnlyPackage } from "#veryfront/transforms/shared/server-only-packages.ts";
import { PLATFORM_SCRIPT_ORIGINS } from "#veryfront/security/http/platform-asset-origins.ts";

const logger = serverLogger.component("release-asset-build");

/** Browser module source extensions eligible for transform. */
const BROWSER_MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
/** Runtime-loadable extensions eligible for server-only import traversal. */
const SERVER_MODULE_EXTENSIONS = [
  ".json",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".mdx",
  ".md",
];
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
type VeryfrontConfigFileName = (typeof VERYFRONT_CONFIG_FILES)[number];

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
  /**
   * Trusted composition seam for declaratively evaluating the exact config
   * source selected from the immutable release file set. Implementations must
   * return a validated configuration snapshot without executing tenant code in
   * the host realm. `null` requests framework defaults.
   */
  loadConfig: ReleaseAssetConfigLoader;
  /** Authenticated, project-scoped API client. */
  client: ReleaseAssetBuildClient;
  /** Runtime adapter used by the transform pipeline. */
  adapter: RuntimeAdapter;
  /**
   * Dependency closure represented by the published manifest. `immutable`
   * requires an explicitly composed policy-enforced vendor; `source` keeps
   * transformed HTTP imports on their canonical source URLs.
   */
  dependencyMode: ReleaseAssetDependencyMode;
  /**
   * Explicit browser transform composition seam. Production must provide the
   * same pipeline `serveModule` uses (browser, non-SSR); byte parity is a hard
   * requirement.
   */
  transform: ReleaseAssetTransform;
  /**
   * HTTP dependency vendor required by `dependencyMode: "immutable"`.
   */
  vendorHttpImports?: ReleaseAssetHttpDependencyVendor;
}

/** Exact configuration source selected from the immutable release file set. */
export interface ReleaseAssetConfigSource {
  readonly fileName: VeryfrontConfigFileName;
  readonly source: string;
}

/** Trusted release configuration composition boundary. */
export type ReleaseAssetConfigLoader = (
  source: ReleaseAssetConfigSource | null,
) => Promise<VeryfrontConfig>;

/** Browser transform contract shared with the module-serving pipeline. */
export type ReleaseAssetTransform = (
  source: string,
  sourceFile: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options: {
    projectId: string;
    dev: boolean;
    ssr: boolean;
    reactVersion?: string;
    /** Immutable dependency state shared by every transform in this build. */
    dependencyPinningSnapshot?: DependencyPinningSnapshot;
    /** Package source paired with dependencyPinningSnapshot. */
    dependencyPinningSource?: DependencyPinningSourceInput;
  },
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
    state: "failed",
    error?: string,
  ): Promise<unknown>;
  /**
   * Required project CSS compiler. A build client without an explicitly
   * composed CSS pipeline is invalid even when the current source set happens
   * not to request CSS.
   *
   * Receives the CSS class candidates extracted from the release source
   * plus the resolved project stylesheet (so the implementation can compile
   * without re-fetching the file set). It may return `null` only when neither
   * candidates nor a stylesheet require CSS. Invalid output and compilation
   * failures fail the release build.
   */
  compileProjectCss(
    candidates: Set<string>,
    stylesheet: string | undefined,
    options: { config: VeryfrontConfig },
  ): Promise<CompileProjectCssResult | null>;
}

/** Observable outcome of a release asset build attempt. */
export interface ReleaseAssetBuildResult {
  success: boolean;
  state: "ready" | "failed";
  moduleCount: number;
  cssCount: number;
  routeCount: number;
  /** Bounded coverage diagnostics; always empty for a successful build. */
  coverageFailures: readonly string[];
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
  allowHttp: boolean;
  requestedSpecifiers?: ReadonlySet<string>;
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

function requirePendingAsset(
  store: PendingAssetStore,
  asset: PreparedAsset,
): { bytes: Uint8Array<ArrayBuffer>; contentType: ReleaseAssetContentType } {
  const stored = getPendingAsset(store, asset);
  if (!stored) {
    throw new Error("Prepared release asset is missing its pending bytes");
  }
  return stored;
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

/**
 * Published npm packages emit DNT runtime helpers (`_dnt.shims.js`,
 * `_dnt.polyfills.js`, `deno.js`) at the package ESM root, outside every
 * framework source lookup dir. Detect those exact files (relative to the
 * importing module's package root) so the release dependency walk can publish
 * them instead of leaving the relative import unresolved.
 */
function matchPublishedRuntimeHelper(
  resolvedPath: string,
  fromSourcePath: string,
): string | null {
  const packageRoot = getFrameworkRoot(fromSourcePath);
  if (!packageRoot) return null;
  for (const helper of PUBLISHED_RUNTIME_HELPERS) {
    if (resolvedPath === join(packageRoot, helper)) return helper;
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

/** True when authored source can be traversed without publishing it to the browser. */
function isTraversableServerModule(path: string): boolean {
  if (!SERVER_MODULE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  return !/\.d\.(?:ts|mts|cts)$/.test(path);
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

function isConfiguredAppRouterModule(
  path: string,
  directories: ReleaseRouterDirectories,
): boolean {
  return configuredRoutePath(path, directories, "app")?.startsWith("app/") ?? false;
}

function isConfiguredAppRouterBrowserEntry(
  path: string,
  directories: ReleaseRouterDirectories,
): boolean {
  return isConfiguredAppRouterLayout(path, directories) ||
    (routeForConfiguredPage(path, directories) !== null &&
      isConfiguredAppRouterModule(path, directories));
}

function isTrustedAppRouterBrowserModule(source: string, path: string): boolean {
  return hasUseClientDirective(source, path) && !hasUseServerDirective(source);
}

async function inspectReleaseBrowserModuleBoundary(source: string, sourceFile: string) {
  await ensureDefaultParserContracts();
  return await inspectBrowserModuleBoundary(source, sourceFile);
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

function resolveKnownModulePathWithExtensions(
  path: string,
  knownPaths: Set<string>,
  extensions: readonly string[],
): string | null {
  const normalized = normalizeLogicalPath(
    path
      .replace(/^\/?_vf_modules\//, "")
      .replace(/^\/+/, "")
      .replace(/[?#].*$/, ""),
  );
  if (!normalized) return null;

  if (normalized.startsWith("_veryfront/")) return null;
  if (knownPaths.has(normalized)) return normalized;

  const existingExtension = extensions.find((ext) => normalized.endsWith(ext));
  const withoutExt = existingExtension
    ? normalized.slice(0, -existingExtension.length)
    : normalized;
  const fallbackExtensions = existingExtension !== undefined && existingExtension !== ".json"
    ? extensions.filter((ext) => ext !== ".json")
    : extensions;
  for (const ext of fallbackExtensions) {
    const candidate = `${withoutExt}${ext}`;
    if (knownPaths.has(candidate)) return candidate;
  }
  for (const ext of fallbackExtensions) {
    const candidate = `${withoutExt}/index${ext}`;
    if (knownPaths.has(candidate)) return candidate;
  }

  return null;
}

function resolveKnownModulePath(path: string, knownPaths: Set<string>): string | null {
  return resolveKnownModulePathWithExtensions(path, knownPaths, BROWSER_MODULE_EXTENSIONS);
}

function resolveKnownServerModulePath(path: string, knownPaths: Set<string>): string | null {
  const resolved = resolveKnownModulePathWithExtensions(path, knownPaths, SERVER_MODULE_EXTENSIONS);
  return resolved && isTraversableServerModule(resolved) ? resolved : null;
}

function resolveKnownStylesheetPath(path: string, knownPaths: Set<string>): string | null {
  const resolved = resolveKnownModulePathWithExtensions(path, knownPaths, [".css"]);
  return resolved?.endsWith(".css") ? resolved : null;
}

function resolveKnownServerDependencyPath(path: string, knownPaths: Set<string>): string | null {
  return resolveKnownServerModulePath(path, knownPaths) ??
    resolveKnownStylesheetPath(path, knownPaths);
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
    specifier.startsWith("//") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier) ||
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

function isJsonDataUrlSpecifier(specifier: string): boolean {
  if (!specifier.toLowerCase().startsWith("data:")) return false;
  const metadataEnd = specifier.indexOf(",");
  if (metadataEnd < 0) return false;
  const mediaType = specifier.slice("data:".length, metadataEnd)
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return mediaType === "application/json" || mediaType === "text/json" ||
    mediaType?.endsWith("+json") === true;
}

function isExternalCssSpecifier(specifier: string): boolean {
  const dataMetadataEnd = specifier.indexOf(",");
  if (specifier.toLowerCase().startsWith("data:") && dataMetadataEnd >= 0) {
    const mediaType = specifier.slice("data:".length, dataMetadataEnd)
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType === "text/css") return true;
  }
  return splitSpecifierSuffix(specifier).path.toLowerCase().endsWith(".css");
}

function mayResolveProjectStylesheetSpecifier(
  specifier: string,
  aliases: ReadonlyMap<string, string>,
): boolean {
  if (isEsmShUrl(specifier) || aliases.has(specifier)) return true;
  if (
    (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs")) &&
    aliases.has(specifier.replace(/\.(m|c)?js$/, ""))
  ) return true;
  for (
    let separator = specifier.indexOf("/");
    separator >= 0;
    separator = specifier.indexOf("/", separator + 1)
  ) {
    if (aliases.has(specifier.slice(0, separator + 1))) return true;
  }
  return false;
}

function isExternalJsonSpecifier(specifier: string): boolean {
  const bareCandidate = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;
  if (
    !bareCandidate.startsWith(".") && !bareCandidate.startsWith("/") &&
    !bareCandidate.startsWith("#") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(bareCandidate) &&
    parseBarePackageSpecifier(bareCandidate) !== null
  ) return false;
  return isJsonDataUrlSpecifier(specifier) ||
    splitSpecifierSuffix(specifier).path.toLowerCase().endsWith(".json");
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
  projectImportAliases: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const imports = new Map<string, string>();

  for (const imp of await parseImports(code)) {
    if (!imp.n) continue;

    const specifier = imp.n;
    const aliasResolution = resolveProjectImportAlias(
      specifier,
      projectImportAliases,
      knownPaths,
      resolveKnownModulePath,
    );
    if (aliasResolution.matched) {
      if (aliasResolution.path) imports.set(specifier, aliasResolution.path);
      continue;
    }
    const importedPath = resolveProjectModuleSpecifier(specifier, logicalPath, knownPaths);
    if (importedPath) imports.set(specifier, importedPath);
  }

  return imports;
}

async function importsExternalStylesheetAlias(
  code: string,
  projectImportAliases: ReadonlyMap<string, string>,
  knownPaths: Set<string>,
): Promise<boolean> {
  for (const imp of await parseImports(code)) {
    if (!imp.n) continue;
    const resolution = resolveProjectImportAlias(
      imp.n,
      projectImportAliases,
      knownPaths,
      resolveKnownModulePath,
    );
    if (
      resolution.external !== undefined && isExternalCssSpecifier(resolution.external)
    ) {
      return true;
    }
  }
  return false;
}

function releaseLogicalPathFromMaterializedPath(
  basePath: string,
  tempDir: string,
  hostOs = getOsType(),
): string {
  const normalizeHostPath = hostOs === "windows"
    ? (path: string) => path.replaceAll("\\", "/")
    : (path: string) => path;
  const materializedRoot = normalizeHostPath(tempDir).replace(/^\/+|\/+$/g, "");
  const normalizedPath = normalizeHostPath(basePath).replace(/^\/+/, "");
  return normalizedPath.startsWith(`${materializedRoot}/`)
    ? normalizedPath.slice(materializedRoot.length + 1)
    : normalizedPath;
}

/** @internal Test seams for portable release materialization rules. */
export const releaseAssetBuildInternals = Object.freeze({
  releaseLogicalPathFromMaterializedPath,
});

/**
 * Bind transforms to the immutable source snapshot materialized for this build.
 *
 * Hosted execution enters through a request-scoped Veryfront API adapter. That
 * adapter remains the authority used to fetch the release once, but absolute
 * paths beneath `tempDir` belong to the build-owned local snapshot. Sending
 * those paths back to the project API returns 404 and leaves aliases or
 * relative imports unresolved during finalization.
 */
async function createMaterializedReleaseTransformAdapter(
  adapter: RuntimeAdapter,
  tempDir: string,
): Promise<RuntimeAdapter> {
  const localAdapter = await getLocalAdapter();
  const securedLocalAdapter = wrapAdapterWithSecurity(localAdapter, {
    baseDir: tempDir,
    context: "module-loading",
  });
  return {
    ...adapter,
    fs: Object.freeze({
      ...securedLocalAdapter.fs,
      symlinkSemantics: "none" as const,
      projectContextSemantics: "fixed" as const,
    }),
  };
}

/**
 * Import edges of an App Router server module, read from its authored source.
 *
 * Server modules are never transformed for the browser, so their imports
 * cannot be read from transformed output the way the rest of the closure is.
 * Raw source needs the preprocessing the dev-time dependency parser applies
 * (parseLocalImports): MDX is compiled to JavaScript first, because prose is
 * not lexable ESM, and the TypeScript pass drops type-only edges so an
 * `import type` target never gains browser reachability it would not have had
 * after a real transform. CSS and other non-JavaScript resources are excluded
 * as well -- they are not transformable modules, and route closures must only
 * traverse module edges (stylesheets are merged by mergeModuleCssImports).
 *
 * parseLocalImports resolves relative and `@/` specifiers only, so the
 * project-root forms the rest of this executor supports (`app/x.tsx`,
 * `/app/x.tsx`, `/_vf_modules/app/x.tsx` -- see normalizeProjectSpecifier)
 * come back in `unresolvedSpecifiers` and are resolved here with the same
 * project-specifier semantics. Dropping them would silently leave a client
 * boundary imported through a root form out of the closure, publishing the
 * route without the JavaScript needed to hydrate it.
 *
 * CommonJS server helpers use the parser contract to add statically named
 * require edges that the ESM lexer does not report.
 */
async function collectServerModuleImports(
  source: string,
  logicalPath: string,
  tempDir: string,
  knownPaths: Set<string>,
  projectImportAliases: ReadonlyMap<string, string>,
  adapter: RuntimeAdapter,
): Promise<string[]> {
  const materializedFs = createFileSystem();
  const resolutionAdapter: RuntimeAdapter = {
    ...adapter,
    fs: {
      ...adapter.fs,
      // Release sources were just materialized as regular files beneath a
      // fresh build-owned directory. The parser may therefore use its
      // symlink-free containment path even when the transform adapter itself
      // does not expose a host realPath capability.
      symlinkSemantics: "none",
      stat: (path: string) => materializedFs.stat(path),
      resolveFile: (basePath: string) => {
        const logicalPath = releaseLogicalPathFromMaterializedPath(basePath, tempDir);
        const resolved = resolveKnownModulePathWithExtensions(
          logicalPath,
          knownPaths,
          STAT_OPERATION_EXTENSION_PRIORITY,
        );
        return Promise.resolve(
          resolved === null ? null : resolveMaterializedReleasePath(tempDir, resolved),
        );
      },
    },
  };
  const parsed = await parseLocalImports(
    source,
    resolveMaterializedReleasePath(tempDir, logicalPath),
    tempDir,
    resolutionAdapter,
  );
  if (parsed.nonLiteralDynamicImports > 0) {
    throw new Error(
      `Server module has ${parsed.nonLiteralDynamicImports} non-literal dynamic import(s)`,
    );
  }
  if (logicalPath.endsWith(".json") || logicalPath.endsWith(".md")) return [];

  const imports = new Set<string>();
  const addResolved = (importedPath: string | null, allowCss = true): boolean => {
    if (importedPath?.endsWith(".css")) return allowCss;
    if (importedPath && isTraversableServerModule(importedPath)) {
      imports.add(importedPath);
      return true;
    }
    return false;
  };
  const resolveRuntimeImportAlias = (specifier: string) =>
    isRuntimeImportMapSpecifier(specifier)
      ? resolveProjectImportAlias(
        specifier,
        projectImportAliases,
        knownPaths,
        resolveKnownServerDependencyPath,
      )
      : { matched: false };
  let missingProjectImports = 0;
  for (const { specifier, absolutePath } of parsed.imports) {
    const aliasResolution = resolveRuntimeImportAlias(specifier);
    if (aliasResolution.matched) {
      if (aliasResolution.path === null) missingProjectImports++;
      else if (
        aliasResolution.path !== undefined && !addResolved(aliasResolution.path, false)
      ) missingProjectImports++;
      continue;
    }
    const relativePath = relative(tempDir, absolutePath).replaceAll("\\", "/");
    if (!addResolved(resolveKnownServerModulePath(relativePath, knownPaths))) {
      missingProjectImports++;
    }
  }
  for (const { specifier } of parsed.missing) {
    const aliasResolution = resolveRuntimeImportAlias(specifier);
    if (!aliasResolution.matched || aliasResolution.path === null) {
      missingProjectImports++;
    } else if (aliasResolution.path !== undefined) {
      if (!addResolved(aliasResolution.path, false)) missingProjectImports++;
    }
  }
  // Cross-project imports are resolved by the runtime's project boundary, not
  // by a single release asset. They cannot be represented in this closure, so
  // fail the route closed instead of publishing an incomplete server module.
  missingProjectImports += parsed.crossProjectImports.length;
  const resolveUnresolvedImport = (
    specifier: string,
    hasJsonTypeAttribute?: boolean,
    fromCommonJs = false,
  ) => {
    if (/^file:/i.test(specifier)) {
      missingProjectImports++;
      return;
    }
    if (/^data:/i.test(specifier) && isExternalCssSpecifier(specifier)) {
      missingProjectImports++;
      return;
    }
    if (isJsonDataUrlSpecifier(specifier) && hasJsonTypeAttribute !== true) {
      missingProjectImports++;
      return;
    }
    if (
      (specifier.startsWith("//") || /^https?:/i.test(specifier)) &&
      isExternalJsonSpecifier(specifier) && hasJsonTypeAttribute !== true
    ) {
      missingProjectImports++;
      return;
    }
    const aliasResolution = resolveRuntimeImportAlias(specifier);
    if (aliasResolution.matched) {
      if (aliasResolution.path === null) {
        missingProjectImports++;
      } else if (aliasResolution.path !== undefined) {
        if (aliasResolution.path.endsWith(".json") && hasJsonTypeAttribute === false) {
          missingProjectImports++;
        } else if (!addResolved(aliasResolution.path, false)) {
          missingProjectImports++;
        }
      } else if (
        aliasResolution.external !== undefined &&
        (isExternalCssSpecifier(aliasResolution.external) ||
          (isExternalJsonSpecifier(aliasResolution.external) && hasJsonTypeAttribute !== true))
      ) {
        missingProjectImports++;
      }
      return;
    }
    if (specifier.startsWith("#")) {
      missingProjectImports++;
      return;
    }
    const normalized = normalizeProjectSpecifier(specifier, logicalPath);
    if (normalized === null) return;
    const importedPath = resolveKnownServerModulePath(normalized, knownPaths);
    if (importedPath === null) {
      missingProjectImports++;
      return;
    }
    if (importedPath.endsWith(".json") && hasJsonTypeAttribute === false) {
      missingProjectImports++;
      return;
    }
    if (!addResolved(importedPath, !fromCommonJs)) missingProjectImports++;
  };

  const unresolvedImports = new Map<string, boolean | undefined>();
  for (const unresolved of parsed.unresolvedImports) {
    const current = unresolvedImports.get(unresolved.specifier);
    unresolvedImports.set(
      unresolved.specifier,
      current === false ? false : unresolved.hasJsonTypeAttribute,
    );
  }

  const commonJsSpecifiers = new Set<string>();
  // MDX is traversable only after parseLocalImports compiles it above. Its raw
  // prose is not a JavaScript program and must not reach the CommonJS parser.
  if (!logicalPath.endsWith(".mdx")) {
    await ensureDefaultParserContracts();
    const parser = tryResolve<CodeParser>("CodeParser");
    if (typeof parser?.findStaticCommonJsImports !== "function") {
      throw new Error('Missing CodeParser capability "findStaticCommonJsImports"');
    }
    for (
      const specifier of await parser.findStaticCommonJsImports({
        code: source,
        filePath: resolveMaterializedReleasePath(tempDir, logicalPath),
      })
    ) {
      commonJsSpecifiers.add(specifier);
    }
  }
  for (const specifier of commonJsSpecifiers) {
    if (!unresolvedImports.has(specifier)) unresolvedImports.set(specifier, undefined);
  }
  for (const [specifier, hasJsonTypeAttribute] of unresolvedImports) {
    resolveUnresolvedImport(specifier, hasJsonTypeAttribute, commonJsSpecifiers.has(specifier));
  }
  if (missingProjectImports > 0) {
    throw new Error(
      `Server module has ${missingProjectImports} unresolved project import(s)`,
    );
  }
  return [...imports];
}

interface ProjectImportAliasResolution {
  readonly matched: boolean;
  readonly path?: string | null;
  readonly external?: string;
}

/**
 * External alias targets reach browser finalization verbatim, and
 * assertFinalModuleImports accepts only parseable absolute URLs. A
 * protocol-relative target such as `//cdn.example/sdk.js` is valid at
 * runtime because the canonical resolver upgrades it to an absolute URL
 * (canonicalizeHttpSpecifier in src/transforms/esm/specifier-resolver.ts).
 * A release asset has no plaintext dev module-server base to inherit a
 * scheme from, so remote executable code always canonicalizes to https --
 * the same scheme the runtime enforces for any host other than a local dev
 * origin.
 */
function canonicalizeExternalProjectImportAliasTarget(mapped: string): string {
  return mapped.startsWith("//") ? `https:${mapped}` : mapped;
}

function serverOnlyBrowserProjectImportAliasTarget(
  mapped: string,
  serverExternalPackages?: readonly string[],
): string | null {
  const canonical = canonicalizeExternalProjectImportAliasTarget(mapped);
  const npmCandidate = canonical.startsWith("npm:") ? canonical.slice("npm:".length) : canonical;
  const bare = parseBarePackageSpecifier(npmCandidate);
  const esmSh = parseEsmShSpecifier(canonical);
  const packageName = esmSh?.packageName ?? bare?.packageName;
  if (!packageName || !isServerOnlyPackage(packageName, serverExternalPackages)) return null;
  return esmSh ? `${esmSh.packageName}${esmSh.subpath}` : canonical;
}

function canonicalizeBrowserProjectImportAliasTarget(
  mapped: string,
  reactVersion: string,
  serverExternalPackages?: readonly string[],
  requireCspCompatible = false,
): string {
  const canonical = canonicalizeExternalProjectImportAliasTarget(mapped);
  const serverOnly = serverOnlyBrowserProjectImportAliasTarget(
    canonical,
    serverExternalPackages,
  );
  if (serverOnly !== null) {
    // Match BareStrategy: a server-only package must remain native so final
    // browser-import validation rejects the route instead of publishing an
    // esm.sh bundle containing unusable Node stubs.
    return serverOnly;
  }
  const resolved = canonical.startsWith("npm:")
    ? resolveBareSpecifier(canonical.slice(4), {}, reactVersion)
    : /^[A-Za-z][A-Za-z0-9+.-]*:/.test(canonical)
    ? canonical
    : resolveBareSpecifier(canonical, {}, reactVersion);
  if (requireCspCompatible && /^https?:/i.test(resolved)) {
    const origin = new URL(resolved).origin;
    if (!PLATFORM_SCRIPT_ORIGINS.some((allowed) => allowed === origin)) {
      throw new Error("Browser import-map alias target is outside the enforced script CSP");
    }
  }
  return resolved;
}

function isExternalProjectImportAliasTarget(mapped: string): boolean {
  if (mapped.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(mapped)) return true;
  if (
    mapped.startsWith("./") || mapped.startsWith("../") ||
    mapped.startsWith("/") || mapped.startsWith("@/") ||
    PROJECT_IMPORT_ROOTS.some((directory) => mapped.startsWith(directory))
  ) {
    return false;
  }
  return true;
}

function resolveProjectImportAlias(
  specifier: string,
  aliases: ReadonlyMap<string, string>,
  knownPaths: Set<string>,
  resolveKnownPath: (path: string, knownPaths: Set<string>) => string | null =
    resolveKnownServerModulePath,
  seenKeys: Set<string> = new Set(),
): ProjectImportAliasResolution {
  if (!isRuntimeImportMapSpecifier(specifier)) {
    return { matched: false, path: null };
  }
  let key = aliases.has(specifier) ? specifier : undefined;
  let suffix = "";
  if (key === undefined && isEsmShUrl(specifier)) {
    const esmShMapping = resolveEsmShThroughImportMap(
      specifier,
      undefined,
      Object.fromEntries(aliases),
    );
    if (esmShMapping !== null) {
      if (
        !aliases.has(esmShMapping) && !esmShMapping.startsWith("#") &&
        !/^file:/i.test(esmShMapping) &&
        isExternalProjectImportAliasTarget(esmShMapping)
      ) {
        return {
          matched: true,
          external: canonicalizeExternalProjectImportAliasTarget(esmShMapping),
        };
      }
      return resolveProjectImportAliasTarget(
        specifier,
        esmShMapping,
        aliases,
        knownPaths,
        resolveKnownPath,
        seenKeys,
      );
    }
  }
  if (
    key === undefined &&
    (specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs"))
  ) {
    const base = specifier.replace(/\.(m|c)?js$/, "");
    if (aliases.has(base)) key = base;
  }
  if (key === undefined) {
    for (
      let separator = specifier.indexOf("/");
      separator >= 0;
      separator = specifier.indexOf("/", separator + 1)
    ) {
      const candidate = specifier.slice(0, separator + 1);
      if (aliases.has(candidate)) key = candidate;
    }
    if (key !== undefined) suffix = specifier.slice(key.length);
  }
  if (key === undefined) return { matched: false, path: null };
  if (seenKeys.has(key)) return { matched: true, path: null };
  seenKeys.add(key);

  const mapped = aliases.get(key)! + suffix;
  return resolveProjectImportAliasTarget(
    specifier,
    mapped,
    aliases,
    knownPaths,
    resolveKnownPath,
    seenKeys,
  );
}

function resolveProjectImportAliasTarget(
  specifier: string,
  mapped: string,
  aliases: ReadonlyMap<string, string>,
  knownPaths: Set<string>,
  resolveKnownPath: (path: string, knownPaths: Set<string>) => string | null,
  seenKeys: Set<string>,
): ProjectImportAliasResolution {
  const nested = resolveProjectImportAlias(
    mapped,
    aliases,
    knownPaths,
    resolveKnownPath,
    seenKeys,
  );
  if (nested.matched) {
    return specifier.startsWith("@/") && nested.external !== undefined
      ? { matched: false, path: null }
      : nested;
  }
  if (mapped.startsWith("#")) return { matched: true, path: null };
  if (/^file:/i.test(mapped)) return { matched: true, path: null };
  if (mapped.startsWith("/_vf_modules/") || mapped.startsWith("_vf_modules/")) {
    return { matched: true, path: resolveKnownPath(mapped, knownPaths) };
  }
  if (mapped.startsWith("@/")) {
    return { matched: true, path: resolveKnownPath(mapped.slice(2), knownPaths) };
  }
  if (isExternalProjectImportAliasTarget(mapped)) {
    if (specifier.startsWith("@/")) return { matched: false, path: null };
    return { matched: true, external: canonicalizeExternalProjectImportAliasTarget(mapped) };
  }
  return { matched: true, path: null };
}

function readReleaseProjectImportAliases(
  sourceByPath: ReadonlyMap<string, string>,
  config: VeryfrontConfig,
): ReadonlyMap<string, string> {
  const source = sourceByPath.get("deno.json");
  const denoImports: Record<string, string> = {};
  if (source !== undefined) {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const imports = (parsed as { imports?: unknown }).imports;
        const scopes = (parsed as { scopes?: unknown }).scopes;
        if (imports !== undefined || scopes !== undefined) {
          const snapshot = snapshotImportMap({
            imports: imports ?? {},
            scopes: scopes ?? {},
          });
          Object.assign(denoImports, snapshot.imports ?? {});
        }
      }
    } catch {
      // Optional malformed Deno maps do not override validated config aliases.
    }
  }
  // A project can also declare aliases in veryfront.config.ts under
  // resolve.importMap.imports. loadImportMap merges deno.json first and the
  // config map last at serve time, so the release traversal mirrors that
  // order: a config mapping overrides the deno.json one for the same key.
  const merged = mergeImportMaps(
    { imports: denoImports },
    config.resolve?.importMap ?? {},
  );
  const normalized = normalizeImportMapForRuntime(merged);
  const aliases = new Map<string, string>();
  for (const [key, value] of Object.entries(normalized.imports ?? {})) {
    if (typeof value === "string" && !isFrameworkOwnedImportMapSpecifier(key)) {
      aliases.set(key, value);
    }
  }
  return aliases;
}

async function rewriteExternalProjectImportAliases(
  code: string,
  projectImportAliases: ReadonlyMap<string, string>,
  knownPaths: Set<string>,
  reactVersion: string,
  serverExternalPackages?: readonly string[],
): Promise<string> {
  return await replaceSpecifiers(code, (specifier) => {
    const resolution = resolveProjectImportAlias(
      specifier,
      projectImportAliases,
      knownPaths,
      resolveKnownModulePath,
    );
    return resolution.external === undefined ? null : canonicalizeBrowserProjectImportAliasTarget(
      resolution.external,
      reactVersion,
      serverExternalPackages,
    );
  });
}

async function rewriteProjectModuleImports(
  code: string,
  logicalPath: string,
  moduleAssets: Map<string, PreparedAsset>,
  knownPaths: Set<string>,
  projectImportAliases: ReadonlyMap<string, string>,
  dependencyUrls: Map<string, string>,
  reactVersion: string,
  serverExternalPackages?: readonly string[],
): Promise<string> {
  function rewriteSpecifier(specifier: string): string | null {
    const aliasResolution = resolveProjectImportAlias(
      specifier,
      projectImportAliases,
      knownPaths,
      resolveKnownModulePath,
    );
    if (aliasResolution.external !== undefined) {
      if (isExternalCssSpecifier(aliasResolution.external)) {
        throw new Error("Browser import-map alias cannot target an external stylesheet");
      }
      const serverOnly = serverOnlyBrowserProjectImportAliasTarget(
        aliasResolution.external,
        serverExternalPackages,
      );
      if (serverOnly !== null) return serverOnly;
    }

    const dependencyUrl = dependencyUrlForSpecifier(dependencyUrls, specifier);
    if (dependencyUrl) return dependencyUrl;

    if (specifier.startsWith("/_vf_modules/")) {
      const dependencyUrl = dependencyUrlForSpecifier(dependencyUrls, specifier);
      if (dependencyUrl) return dependencyUrl;
    }

    if (aliasResolution.external !== undefined) {
      return dependencyUrlForSpecifier(dependencyUrls, aliasResolution.external) ??
        canonicalizeBrowserProjectImportAliasTarget(
          aliasResolution.external,
          reactVersion,
          serverExternalPackages,
          true,
        );
    }
    const importedPath = aliasResolution.matched
      ? aliasResolution.path ?? null
      : resolveProjectModuleSpecifier(specifier, logicalPath, knownPaths);
    const asset = importedPath ? moduleAssets.get(importedPath) : undefined;
    return asset ? releaseAssetUrl(asset.contentHash, "js") : null;
  }

  return await replaceSpecifiers(code, (specifier) => rewriteSpecifier(specifier));
}

async function assertFinalModuleImports(
  code: string,
  options: { allowHttp: boolean },
): Promise<void> {
  for (const imp of await parseImports(code)) {
    if (imp.d === -2) continue;
    if (imp.n === undefined) {
      throw new Error("Release module contains a non-literal dynamic import");
    }

    const specifier = imp.n;
    if (
      !hasControlCharacters(specifier) &&
      /^\/_vf\/assets\/[0-9a-f]{64}\.js(?:[?#].*)?$/.test(specifier)
    ) {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(specifier);
    } catch {
      throw new Error(`Release module contains an unresolved import: ${specifier}`);
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      if (
        !options.allowHttp ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        !isSafeBuildText(specifier, MAX_DEPENDENCY_SPECIFIER_LENGTH)
      ) {
        throw new Error("Release module contains an unvendored HTTP import");
      }
      continue;
    }

    if (protocol === "file:") {
      throw new Error("Release module contains an unresolved local file import");
    }
    throw new Error(`Release module contains an unsupported import: ${specifier}`);
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

const UNREADABLE_DATA_PROPERTY = Symbol("unreadable-data-property");

function readOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): unknown | typeof UNREADABLE_DATA_PROPERTY {
  if (typeof value !== "object" || value === null) return UNREADABLE_DATA_PROPERTY;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    return Object.hasOwn(descriptor, "value") ? descriptor.value : UNREADABLE_DATA_PROPERTY;
  } catch {
    return UNREADABLE_DATA_PROPERTY;
  }
}

function snapshotCompiledProjectCss(value: unknown): CompileProjectCssResult {
  const css = readOwnDataProperty(value, "css");
  const styleProfileHash = readOwnDataProperty(value, "styleProfileHash");
  const cssPipelineIdentity = readOwnDataProperty(value, "cssPipelineIdentity");
  if (
    typeof css !== "string" ||
    css.length === 0 ||
    !isStyleProfileHash(styleProfileHash) ||
    !isCSSPipelineIdentity(cssPipelineIdentity)
  ) {
    throw new Error("Release asset CSS compiler returned an invalid identity result");
  }

  return Object.freeze({ css, styleProfileHash, cssPipelineIdentity });
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
  const code = readOwnDataProperty(value, "code");
  const dependencies = readOwnDataProperty(value, "dependencies");
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
    const dependency = readOwnDataProperty(dependencies, String(index));
    const manifestKey = readOwnDataProperty(dependency, "manifestKey");
    const specifier = readOwnDataProperty(dependency, "specifier");
    const code = readOwnDataProperty(dependency, "code");
    const declaredSourcePath = readOwnDataProperty(dependency, "sourcePath");
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
  return specifier.startsWith("http://") || specifier.startsWith("https://")
    ? normalizeHttpUrl(specifier)
    : specifier;
}

const gapIndexes = new WeakMap<string[], Set<string>>();
const GAP_DETAIL_LIMIT_MARKER = "coverage-failures:detail-limit-exceeded";
const GAP_ENTRY_LIMIT_MARKER = "coverage-failures:entry-limit-exceeded";

function pushGap(gaps: string[], gap: string): void {
  let index = gapIndexes.get(gaps);
  if (!index) {
    index = new Set(gaps);
    gapIndexes.set(gaps, index);
  }
  if (index.has(GAP_ENTRY_LIMIT_MARKER)) return;

  const boundedGap = gap.length > RELEASE_ASSET_MANIFEST_LIMITS.coverageFailureLength ||
      gap.length === 0 ||
      gap.trim() !== gap ||
      hasControlCharacters(gap)
    ? GAP_DETAIL_LIMIT_MARKER
    : gap;
  if (index.has(boundedGap)) return;

  if (index.size >= RELEASE_ASSET_MANIFEST_LIMITS.coverageFailures - 1) {
    index.add(GAP_ENTRY_LIMIT_MARKER);
    gaps.push(GAP_ENTRY_LIMIT_MARKER);
    return;
  }

  index.add(boundedGap);
  gaps.push(boundedGap);
}

class IncompleteReleaseAssetBuildError extends Error {
  readonly coverageFailures: readonly string[];

  constructor(coverageFailures: readonly string[]) {
    const snapshot = Object.freeze([...coverageFailures]);
    const summary = snapshot.slice(0, 3).map((failure) => failure.slice(0, 200)).join(", ");
    const remaining = snapshot.length > 3 ? ` (+${snapshot.length - 3} more)` : "";
    super(`Release asset coverage is incomplete: ${summary}${remaining}`);
    this.name = "IncompleteReleaseAssetBuildError";
    this.coverageFailures = snapshot;
  }
}

/**
 * Fail the build when any structural gap remains.
 *
 * `moduleGaps` never fails a build on its own -- per-module failures cost only
 * their own routes. It is passed here so that when something structural does
 * fail, the report still names the modules that failed on the way there. Those
 * are usually the actionable part, and omitting them hid the failing page
 * behind a generic dependency error.
 */
function assertCompleteReleaseAssetCoverage(
  coverageFailures: readonly string[],
  moduleGaps: readonly string[] = [],
): void {
  if (coverageFailures.length === 0) return;

  const combined = [...coverageFailures];
  for (const gap of moduleGaps) pushGap(combined, gap);
  throw new IncompleteReleaseAssetBuildError(combined);
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
    value.normalize("NFC") !== value ||
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
    parts.some((part) =>
      part.length === 0 ||
      part === "." ||
      part === ".." ||
      part.endsWith(".") ||
      part.endsWith(" ") ||
      part.includes(":") ||
      /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i
        .test(part)
    ) ||
    normalizeLogicalPath(normalizedValue) !== normalizedValue
  ) {
    throw new Error("Release file path must be a canonical relative path");
  }

  return normalizedValue;
}

function portableReleaseFilePathKey(filePath: string): string {
  return filePath.normalize("NFC").toUpperCase();
}

function resolveMaterializedReleasePath(tempDir: string, filePath: string): string {
  // The build owns a newly-created temporary root and materializes only regular
  // file contents beneath it; no caller-controlled filesystem links are
  // admitted. Lexical containment is therefore the correct boundary here.
  const result = validateLexicalPath(filePath, {
    baseDir: tempDir,
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

export async function buildReactImportMapDependencyAssets(options: {
  tempDir: string;
  reactVersion?: string;
  vendorHttpImports: ReleaseAssetHttpDependencyVendor;
}): Promise<{
  dependencies: Record<string, PreparedAsset>;
  assets: PreparedReleaseAsset[];
  gaps: string[];
}> {
  const dependencyModules = createDependencyModuleCollection();
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = createPendingAssetStore();
  const gaps: string[] = [];
  const vendorHttpImports = options.vendorHttpImports;

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
    assets: uploadQueue.map((asset) => {
      const stored = requirePendingAsset(pendingBytes, asset);
      return {
        ...asset,
        bytes: stored.bytes,
      };
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
    assets: uploadQueue.map((asset) => {
      const stored = requirePendingAsset(pendingBytes, asset);
      return {
        ...asset,
        bytes: stored.bytes,
      };
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
  const recordedCycleGaps = new Set<string>();

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

  function recordDependencyCycle(cycleKeys: readonly string[]): void {
    // Separate content-hashed ESM files cannot represent cyclic imports without
    // release-scoped aliases or bundling, so keep only that component on source URL fallback.
    const gap = `dependency-cycle:${cycleKeys.join("->")}`;
    if (!recordedCycleGaps.has(gap)) {
      recordedCycleGaps.add(gap);
      pushGap(gaps, gap);
    }
  }

  const graphModules = new Map(
    [...dependencyModules].map(([manifestKey, dependency]) =>
      [
        manifestKey,
        {
          id: manifestKey,
          code: dependency.code,
          contentType: RELEASE_ASSET_CONTENT_TYPES.js,
        },
      ] as const
    ),
  );
  const materialized = await materializeReleaseDependencyGraph({
    modules: graphModules,
    maxAssetBytes: RELEASE_ASSET_MAX_SIZE_BYTES,
    resolveImport(specifier, parent) {
      const dependency = dependencyModules.get(parent.id);
      if (!dependency) return { kind: "invalid", failureCode: "graph_incomplete" };
      const filePath = resolveLocalDependencyPath(specifier, dependency.sourcePath);
      if (filePath && !byFilePath.has(filePath)) {
        throw new Error(`Unresolved vendored file dependency: ${specifier}`);
      }
      const child = resolveDependencyImport(specifier, dependency);
      return child ? { kind: "module", moduleId: child.manifestKey } : { kind: "external" };
    },
    cycleFallbackUrl(module) {
      const dependency = dependencyModules.get(module.id);
      const fallbackUrl = dependency ? dependencyFallbackUrl(dependency) : null;
      if (!fallbackUrl) {
        throw new Error(`Unrepresentable vendored dependency cycle: ${module.id}`);
      }
      return fallbackUrl;
    },
    onCycle: recordDependencyCycle,
    assetSizeErrorMessage: (module) =>
      `Vendored dependency exceeds release asset size limit: ${module.id}`,
  });

  for (const asset of materialized.assets) {
    await assertFinalModuleImports(new TextDecoder().decode(asset.bytes), {
      allowHttp: false,
    });
    const entry: PreparedAsset = {
      logicalPath: `__dependencies__/${asset.sourceId}`,
      contentHash: asset.contentHash,
      size: asset.size,
      contentType: asset.contentType,
    };
    finalized.set(asset.sourceId, entry);
    if (rememberPendingAsset(pendingBytes, entry, asset.bytes)) {
      uploadQueue.push(entry);
    }
  }

  for (const manifestKey of materialized.skippedCycleIds) {
    const dependency = dependencyModules.get(manifestKey);
    if (!dependency) continue;

    const fallbackUrl = dependencyFallbackUrl(dependency);
    if (!fallbackUrl) throw new Error(`Unrepresentable vendored dependency cycle: ${manifestKey}`);

    addDependencyUrlAliases(fallbackUrls, dependency, fallbackUrl);
  }

  return { assets: Object.fromEntries(finalized), fallbackUrls };
}

async function finalizeProjectModules(
  transformedModules: Map<string, TransformedProjectModule>,
  knownPaths: Set<string>,
  projectImportAliases: ReadonlyMap<string, string>,
  dependencyUrls: Map<string, string>,
  uploadQueue: PreparedAsset[],
  pendingBytes: PendingAssetStore,
  gaps: string[],
  allowHttp: boolean,
  reactVersion: string,
  serverExternalPackages?: readonly string[],
): Promise<{ modules: Record<string, PreparedAsset>; skippedModules: Set<string> }> {
  const finalized = new Map<string, PreparedAsset>();
  const unresolvedCycles = new Set<string>();
  const nonSizeFailures = new Set<string>();
  const cyclicModules = await collectCyclicProjectModules(
    transformedModules,
    knownPaths,
    projectImportAliases,
    gaps,
  );
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
      imports = await collectProjectModuleImports(
        transformed.code,
        logicalPath,
        knownPaths,
        projectImportAliases,
      );
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
        projectImportAliases,
        dependencyUrls,
        reactVersion,
        serverExternalPackages,
      );
      await assertFinalModuleImports(rewritten, { allowHttp });
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
  projectImportAliases: ReadonlyMap<string, string>,
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
      imports = await collectProjectModuleImports(
        transformed.code,
        logicalPath,
        knownPaths,
        projectImportAliases,
      );
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
  dependencyPinningSnapshot: DependencyPinningSnapshot,
  dependencyPinningSource: DependencyPinningSourceInput,
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
  const publishedHelperPaths = new Map<string, string>();
  const publishedHelperKeysByPath = new Map<string, string>();

  async function resolveFrameworkImport(
    specifier: string,
    fromSourcePath: string,
  ): Promise<string | null> {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolvedPath = await resolveRelativeFrameworkSourceImport(specifier, fromSourcePath);
      if (!resolvedPath) return null;
      const helperName = matchPublishedRuntimeHelper(resolvedPath, fromSourcePath);
      if (helperName) {
        // Key helpers by resolved path: distinct package roots can each emit
        // a helper with the same filename but different contents.
        let helperSourceKey = publishedHelperKeysByPath.get(resolvedPath);
        if (!helperSourceKey) {
          const stem = helperName.replace(/\.js$/, "");
          helperSourceKey = `_published-runtime/${publishedHelperKeysByPath.size}/${stem}`;
          publishedHelperKeysByPath.set(resolvedPath, helperSourceKey);
          publishedHelperPaths.set(helperSourceKey, resolvedPath);
        }
        return helperSourceKey;
      }
      return frameworkSourcePathToSourceKey(resolvedPath, lookupDirs);
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

    const publishedHelperPath = publishedHelperPaths.get(sourceKey);
    const frameworkSource = publishedHelperPath
      ? { path: publishedHelperPath, lookupDir: dirname(publishedHelperPath) }
      : await resolveFrameworkSourcePath(sourceKey, {
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
        dependencyPinningSnapshot,
        dependencyPinningSource,
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
      await assertFinalModuleImports(code, { allowHttp: input.allowHttp });
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
    if (input.requestedSpecifiers && !input.requestedSpecifiers.has(specifier)) continue;
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

async function collectRequestedFrameworkSpecifiers(
  transformedModules: ReadonlyMap<string, TransformedProjectModule>,
): Promise<Set<string>> {
  const requested = new Set<string>();
  const specifiersByModuleUrl = new Map<string, string[]>();
  for (const [specifier, moduleUrl] of Object.entries(PLATFORM_UTILITIES)) {
    const aliases = specifiersByModuleUrl.get(moduleUrl) ?? [];
    aliases.push(specifier);
    specifiersByModuleUrl.set(moduleUrl, aliases);
  }

  for (const transformed of transformedModules.values()) {
    for (const imp of await parseImports(transformed.code)) {
      if (!imp.n) continue;
      if (Object.hasOwn(PLATFORM_UTILITIES, imp.n)) requested.add(imp.n);
      for (const alias of specifiersByModuleUrl.get(imp.n) ?? []) requested.add(alias);
    }
  }

  return requested;
}

export async function buildFrameworkDependencyAssets(options: {
  tempDir: string;
  adapter: RuntimeAdapter;
  reactVersion?: string;
  projectId?: string;
  transform: ReleaseAssetTransform;
  dependencyUrls: Map<string, string>;
  dependencyPinningSnapshot?: DependencyPinningSnapshot;
  dependencyPinningSource?: DependencyPinningSourceInput;
}): Promise<{
  dependencies: Record<string, PreparedAsset>;
  assets: PreparedReleaseAsset[];
  gaps: string[];
}> {
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = createPendingAssetStore();
  const gaps: string[] = [];
  const dependencyPinningSource = options.dependencyPinningSource ??
    createDependencyPinningSource({
      projectDir: options.tempDir,
      adapter: options.adapter,
      contentSourceId: "local-framework-assets",
    });
  const dependencyPinningSnapshot = options.dependencyPinningSnapshot ??
    await resolveDependencyPinningSnapshot(dependencyPinningSource);
  const transform = options.transform;
  const dependencies = await buildFrameworkDependencies(
    {
      projectId: options.projectId ?? "local",
      reactVersion: options.reactVersion,
      adapter: options.adapter,
      allowHttp: false,
    },
    options.tempDir,
    transform,
    dependencyPinningSnapshot,
    dependencyPinningSource,
    options.dependencyUrls,
    uploadQueue,
    pendingBytes,
    gaps,
  );

  return {
    dependencies,
    assets: uploadQueue.map((asset) => {
      const stored = requirePendingAsset(pendingBytes, asset);
      return {
        ...asset,
        bytes: stored.bytes,
      };
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
  finalizedModules: ReadonlySet<string>,
  knownPaths: Set<string>,
  projectImportAliases: ReadonlyMap<string, string>,
  serverModuleImports: ReadonlyMap<string, readonly string[]> = new Map(),
): Promise<{ modules: string[]; gaps: string[] }> {
  type ClosureMode = "browser" | "server";
  const visited = new Set<string>();
  const browserModules = new Set<string>();
  const queue: Array<{ path: string; mode: ClosureMode }> = entrypoints.map((path) => ({
    path,
    mode: serverModuleImports.has(path) ? "server" as const : "browser" as const,
  }));
  const gaps: string[] = [];

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const { path: current, mode } = queue[queueIndex]!;
    const visitKey = `${mode}:${current}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    if (mode === "server") {
      const serverImports = serverModuleImports.get(current);
      if (serverImports) {
        for (const importedPath of serverImports) {
          queue.push({ path: importedPath, mode: "server" });
        }
        continue;
      }
      // A client boundary reached by a server edge has no server graph. Its
      // finalized browser graph is the route's hydration dependency.
    }

    const transformed = transformedModules.get(current);
    if (!transformed || !finalizedModules.has(current)) {
      // Module referenced but not transformable or not successfully transformed.
      pushGap(gaps, `closure-missing:${current}`);
      continue;
    }
    browserModules.add(current);

    let imports: Map<string, string>;
    try {
      imports = await collectProjectModuleImports(
        transformed.code,
        current,
        knownPaths,
        projectImportAliases,
      );
    } catch (error) {
      pushGap(gaps, `closure-import-parse-failed:${current}`);
      logger.warn("Route closure import parse failed during release asset build", {
        path: current,
        error: sanitizeError(error),
      });
      continue;
    }
    for (const importedPath of imports.values()) {
      queue.push({ path: importedPath, mode: "browser" });
    }
  }

  return { modules: [...browserModules], gaps };
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
    typeof input.client?.beginReleaseAssetManifestBuild !== "function" ||
    typeof input.client.listAllReleaseFiles !== "function" ||
    typeof input.client.uploadReleaseAsset !== "function" ||
    typeof input.client.putReleaseAssetManifest !== "function" ||
    typeof input.client.reportReleaseAssetManifestState !== "function" ||
    typeof input.client.compileProjectCss !== "function"
  ) {
    throw new Error("Release asset build client is incomplete");
  }
  if (typeof input.transform !== "function") {
    throw new Error("Release asset transform must be a function");
  }
  if (typeof input.loadConfig !== "function") {
    throw new Error("Release asset config loader is unavailable");
  }
  if (input.dependencyMode !== "source" && input.dependencyMode !== "immutable") {
    throw new Error("Release asset dependency mode is invalid");
  }
  if (
    input.vendorHttpImports !== undefined &&
    typeof input.vendorHttpImports !== "function"
  ) {
    throw new Error("Release asset dependency vendor must be a function");
  }
  if (input.dependencyMode === "source" && input.vendorHttpImports !== undefined) {
    throw new Error("Release asset dependency vendor requires immutable dependency mode");
  }
  if (input.dependencyMode === "immutable" && typeof input.vendorHttpImports !== "function") {
    throw new Error(
      "Immutable release dependencies require a policy-enforced vendor extension",
    );
  }
}

interface ValidatedReleaseAssetBuildStart {
  readonly id: string;
  readonly manifestVersion: number;
  readonly state: "queued" | "building";
}

function validateBuildStart(
  value: Awaited<ReturnType<ReleaseAssetBuildClient["beginReleaseAssetManifestBuild"]>>,
): ValidatedReleaseAssetBuildStart {
  const id = readOwnDataProperty(value, "id");
  const manifestVersion = readOwnDataProperty(value, "manifest_version");
  const state = readOwnDataProperty(value, "state");
  if (
    !isSafeBuildText(id) ||
    typeof manifestVersion !== "number" ||
    !Number.isSafeInteger(manifestVersion) ||
    manifestVersion < 0 ||
    (state !== "queued" && state !== "building")
  ) {
    throw new Error("Release asset build start was not acknowledged");
  }
  return Object.freeze({ id, manifestVersion, state });
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
  let validatedStart: ValidatedReleaseAssetBuildStart | null = null;
  try {
    validateReleaseAssetBuildInput(input, tempDir);
    const transform = input.transform;
    validatedStart = validateBuildStart(
      await client.beginReleaseAssetManifestBuild(input.releaseVersionRef),
    );

    // Wrap the whole build so any non-transform failure also reports failed.
    return await runBuildInner(
      input,
      tempDir,
      client,
      transform,
      validatedStart.manifestVersion,
    );
  } catch (error) {
    const sanitized = sanitizeError(error);
    logger.warn("Release asset build failed (non-transform error)", {
      releaseId: input.releaseId,
      error: sanitized,
    });
    if (validatedStart) {
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
    }
    return {
      success: false,
      state: "failed",
      moduleCount: 0,
      cssCount: 0,
      routeCount: 0,
      coverageFailures: error instanceof IncompleteReleaseAssetBuildError
        ? error.coverageFailures
        : [],
      error: sanitized,
    };
  }
}

async function resolveReleaseReactVersion(
  releaseConfig: VeryfrontConfig,
  tempDir: string,
  dependencyPinningSnapshot: DependencyPinningSnapshot,
  dependencyPinningSource: DependencyPinningSourceInput,
): Promise<string> {
  return await resolveProjectReactVersion({
    projectDir: tempDir,
    config: releaseConfig,
    dependencyPinningSource,
    dependencyPinningCacheKey: dependencyPinningSnapshot.cacheKey,
    dependencyPinningDependencies: dependencyPinningSnapshot.dependencies,
  });
}

async function runBuildInner(
  input: ReleaseAssetBuildInput,
  tempDir: string,
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetTransform,
  manifestVersion: number,
): Promise<ReleaseAssetBuildResult> {
  // Materialize only after the control plane acknowledges an active build.
  const files = await client.listAllReleaseFiles(input.releaseVersionRef);
  if (!Array.isArray(files) || files.length > MAX_RELEASE_FILES) {
    throw new Error(`Release file list exceeds ${MAX_RELEASE_FILES} entries`);
  }
  const fs = createFileSystem();
  const sourceByPath = new Map<string, string>();
  const portablePathKeys = new Set<string>();
  let sourceBytes = 0;
  let transformableSourceCount = 0;

  for (const file of files) {
    const path = readOwnDataProperty(file, "path");
    const content = readOwnDataProperty(file, "content");
    if (typeof content !== "string") {
      throw new Error("Release file entry must include string content");
    }
    const logicalPath = requireCanonicalReleaseFilePath(path);
    if (sourceByPath.has(logicalPath)) {
      throw new Error("Release file list contains a duplicate path");
    }
    const portablePathKey = portableReleaseFilePathKey(logicalPath);
    if (portablePathKeys.has(portablePathKey)) {
      throw new Error("Release file list contains a portable path collision");
    }
    portablePathKeys.add(portablePathKey);
    if (isTransformableBrowserModule(logicalPath)) {
      transformableSourceCount++;
      if (transformableSourceCount > RELEASE_ASSET_MANIFEST_LIMITS.moduleEntries) {
        throw new Error(
          `Release browser modules exceed ${RELEASE_ASSET_MANIFEST_LIMITS.moduleEntries} entries`,
        );
      }
    }
    const contentBytes = textEncoder.encode(content).byteLength;
    if (contentBytes > RELEASE_ASSET_MAX_SIZE_BYTES) {
      throw new Error(`Release source file exceeds ${RELEASE_ASSET_MAX_SIZE_BYTES} bytes`);
    }
    sourceBytes += contentBytes;
    if (sourceBytes > MAX_RELEASE_SOURCE_BYTES) {
      throw new Error(`Release source files exceed ${MAX_RELEASE_SOURCE_BYTES} bytes`);
    }

    sourceByPath.set(logicalPath, content);
  }

  // Validate the entire logical file set before writing any tenant-controlled
  // path. This keeps case-insensitive and Unicode-normalizing filesystems from
  // making the materialized bytes differ from the hashed in-memory snapshot.
  for (const [logicalPath, content] of sourceByPath) {
    const abs = resolveMaterializedReleasePath(tempDir, logicalPath);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeTextFile(abs, content);
  }

  const sourceContentHash = await releaseFileSetSignature(sourceByPath);

  // 3 + 4. Collect the browser module closure and transform each module
  // through the SAME pipeline serveModule uses (browser, non-SSR).
  const transformedModules = new Map<string, TransformedProjectModule>();
  const dependencyModules = createDependencyModuleCollection();
  const gaps: string[] = [];
  // Per-module failures are held apart from the structural gaps in `gaps`. A
  // module that cannot be built costs its own routes, not the release: it never
  // reaches `modules`, and the browser-module endpoint already refuses anything
  // absent from the manifest. These are promoted into `gaps` at route assembly,
  // and only when they leave the release with no serveable route at all.
  const moduleGaps: string[] = [];
  const uploadQueue: PreparedAsset[] = [];
  // Bytes are held per-hash only until uploaded, then dropped (M3).
  const pendingBytes = createPendingAssetStore();
  const knownPaths = new Set(sourceByPath.keys());
  const transformAdapter = await createMaterializedReleaseTransformAdapter(input.adapter, tempDir);
  const vendorDependencies = input.dependencyMode === "immutable";
  const configuredVendor = input.vendorHttpImports;
  const vendorHttpImports = vendorDependencies ? configuredVendor : undefined;
  const configFile = VERYFRONT_CONFIG_FILES.find((candidate) => sourceByPath.has(candidate));
  const releaseConfig = await input.loadConfig(
    configFile
      ? {
        fileName: configFile,
        source: sourceByPath.get(configFile)!,
      }
      : null,
  );
  if (!releaseConfig || typeof releaseConfig !== "object" || Array.isArray(releaseConfig)) {
    throw new Error("Release asset config loader returned an invalid config");
  }
  const projectImportAliases = readReleaseProjectImportAliases(sourceByPath, releaseConfig);
  const routeDirectories = releaseRouterDirectories(releaseConfig);
  const releaseRscEnabled = isRSCEnabled(releaseConfig);
  const dependencyPinningSource = createDependencyPinningSource({
    projectDir: tempDir,
    projectId: input.projectId,
    releaseId: input.releaseId,
    contentSourceId: `release-assets:${input.releaseVersionRef}`,
    isLocalProject: true,
    config: releaseConfig,
  });
  const dependencyPinningSnapshot = await resolveDependencyPinningSnapshot(
    dependencyPinningSource,
  );
  const releaseReactVersion = await resolveReleaseReactVersion(
    releaseConfig,
    tempDir,
    dependencyPinningSnapshot,
    dependencyPinningSource,
  );

  async function transformProjectModule(
    logicalPath: string,
  ): Promise<string[]> {
    if (transformedModules.has(logicalPath)) {
      return [];
    }
    const browserTransformable = isTransformableBrowserModule(logicalPath);
    if (
      !browserTransformable &&
      !(serverReachedPaths.has(logicalPath) && isTraversableServerModule(logicalPath))
    ) {
      return [];
    }

    const source = sourceByPath.get(logicalPath);
    if (typeof source !== "string") return [];
    const sourceFile = join(tempDir, logicalPath);
    const sourcePolicy = classifyBrowserModuleSourcePath(logicalPath, {
      config: releaseConfig,
      rscEnabled: releaseRscEnabled,
      isLocalProject: false,
    });
    const protectedSource = sourcePolicy.protectionReason !== null;
    const hasClientDirective = hasUseClientDirective(source, logicalPath);
    const hasServerDirective = hasUseServerDirective(source);
    if (hasClientDirective && hasServerDirective) {
      pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
      logger.warn("Browser module boundary rejected during release asset build", {
        path: logicalPath,
        error: "Module cannot contain both use client and use server directives",
      });
      return [];
    }
    if (protectedSource && hasClientDirective) {
      pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
      logger.warn("Browser module boundary rejected during release asset build", {
        path: logicalPath,
        error: "Protected module cannot declare a client boundary",
      });
      return [];
    }
    if (
      releaseRscEnabled &&
      clientTrustedPaths.has(logicalPath) &&
      isConfiguredAppRouterBrowserEntry(logicalPath, routeDirectories) &&
      !hasClientDirective
    ) {
      pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
      logger.warn("Browser module boundary rejected during release asset build", {
        path: logicalPath,
        error: "App Router page or layout cannot inherit a client boundary",
      });
      return [];
    }
    const pagesRouterEntry = routeForConfiguredPage(logicalPath, routeDirectories) !== null &&
      !isConfiguredAppRouterModule(logicalPath, routeDirectories);
    const nonRscAppRouterEntry = !releaseRscEnabled &&
      isConfiguredAppRouterBrowserEntry(logicalPath, routeDirectories);
    if ((pagesRouterEntry || nonRscAppRouterEntry) && hasServerDirective) {
      pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
      logger.warn("Browser module boundary rejected during release asset build", {
        path: logicalPath,
        error: "Browser route entry cannot contain a module-level use server directive",
      });
      return [];
    }
    const appRouterBrowserCandidate = (hasClientDirective && !hasServerDirective) ||
      clientTrustedPaths.has(logicalPath) || nonRscAppRouterEntry;

    // An App Router module is a server module unless it opts into the client
    // boundary itself or inherits the boundary from a published browser module
    // that imports it (a "use client" component's dependency closure is client
    // code even when the helper files carry no directive of their own). An
    // explicit "use server" module never inherits that trust: whoever imports
    // it, wherever it lives, its source stays on the server. The same server
    // boundary follows every module reached through a server-module edge, not
    // only files beneath the app directory -- a server page importing
    // ../server/actions.ts keeps that module server-side too.
    if (
      protectedSource ||
      (!(hasClientDirective && !hasServerDirective) &&
        (hasServerDirective ||
          (((releaseRscEnabled && isConfiguredAppRouterModule(logicalPath, routeDirectories)) ||
            serverReachedPaths.has(logicalPath)) &&
            !clientTrustedPaths.has(logicalPath))))
    ) {
      try {
        const imports = await collectServerModuleImports(
          source,
          logicalPath,
          tempDir,
          knownPaths,
          projectImportAliases,
          transformAdapter,
        );
        serverModuleImports.set(logicalPath, imports);
        // Everything a server module reaches is server code by default. A
        // client entry or boundary that also imports the module reclassifies
        // it below.
        for (const importedPath of imports) {
          serverReachedPaths.add(importedPath);
        }
        return imports;
      } catch (error) {
        // Route-local like every other per-module parse failure: the routes
        // this module serves lose coverage and are dropped, and the failure
        // only becomes fatal when it leaves the release with nothing to serve.
        pushGap(moduleGaps, `module-import-parse-failed:${logicalPath}`);
        logger.warn("Server module import parse failed during release asset build", {
          path: logicalPath,
          error: sanitizeError(error),
        });
        return [];
      }
    }

    // Server-only script formats participate in route reachability but never
    // enter the browser transform or release manifest.
    if (!browserTransformable) return [];

    const sourceBoundaryViolation = appRouterBrowserCandidate && !logicalPath.endsWith(".mdx")
      ? await inspectReleaseBrowserModuleBoundary(source, sourceFile)
      : null;
    if (sourceBoundaryViolation) {
      pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
      logger.warn("Browser module boundary rejected during release asset build", {
        path: logicalPath,
        error: describeBrowserModuleBoundaryViolation(sourceBoundaryViolation),
      });
      return [];
    }
    let code: string;
    try {
      code = await transform(source, sourceFile, tempDir, transformAdapter, {
        projectId: input.projectId,
        dev: false,
        ssr: false,
        reactVersion: releaseReactVersion,
        dependencyPinningSnapshot,
        dependencyPinningSource,
      });
    } catch (error) {
      const sanitized = sanitizeError(error);
      pushGap(moduleGaps, `module-transform-failed:${logicalPath}`);
      logger.warn("Module transform failed during release asset build", {
        path: logicalPath,
        error: sanitized,
      });
      return [];
    }
    if (typeof code !== "string") {
      pushGap(moduleGaps, `module-transform-failed:${logicalPath}`);
      logger.warn("Module transform returned a non-string result", {
        path: logicalPath,
      });
      return [];
    }
    const transformedBoundaryViolation = appRouterBrowserCandidate && logicalPath.endsWith(".mdx")
      ? await inspectReleaseBrowserModuleBoundary(code, sourceFile)
      : null;
    if (transformedBoundaryViolation) {
      pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
      logger.warn("Browser module boundary rejected during release asset build", {
        path: logicalPath,
        error: describeBrowserModuleBoundaryViolation(transformedBoundaryViolation),
      });
      return [];
    }
    const transformedSize = textEncoder.encode(code).byteLength;
    if (transformedSize > RELEASE_ASSET_MAX_SIZE_BYTES) {
      pushGap(moduleGaps, `oversized:${logicalPath}`);
      logger.warn("Module transform output exceeds the release asset limit", {
        path: logicalPath,
        size: transformedSize,
        limit: RELEASE_ASSET_MAX_SIZE_BYTES,
      });
      return [];
    }

    try {
      if (await importsExternalStylesheetAlias(code, projectImportAliases, knownPaths)) {
        pushGap(moduleGaps, `module-boundary-failed:${logicalPath}`);
        logger.warn("Browser module boundary rejected during release asset build", {
          path: logicalPath,
          error: "Browser import-map alias cannot target an external stylesheet",
        });
        return [];
      }
    } catch (error) {
      pushGap(moduleGaps, `module-import-parse-failed:${logicalPath}`);
      logger.warn("Module import parse failed during release asset build", {
        path: logicalPath,
        error: sanitizeError(error),
      });
      return [];
    }

    const unvendoredCode = code;
    let imports: Map<string, string> | undefined;
    if (typeof vendorHttpImports === "function") {
      try {
        const vendorSource = await rewriteExternalProjectImportAliases(
          code,
          projectImportAliases,
          knownPaths,
          releaseReactVersion,
          releaseConfig.build?.serverExternalPackages,
        );
        const vendored = validateVendorResult(
          await vendorHttpImports(vendorSource, {
            tempDir,
            reactVersion: releaseReactVersion,
          }),
        );
        const stagedDependencies = stageDependencyModules(vendored.dependencies);
        const vendoredImports = await collectProjectModuleImports(
          vendored.code,
          logicalPath,
          knownPaths,
          projectImportAliases,
        );
        commitDependencyModules(dependencyModules, stagedDependencies);
        code = vendored.code;
        imports = vendoredImports;
      } catch (error) {
        const sanitized = sanitizeError(error);
        // Deliberately fatal rather than route-local, unlike the other
        // per-module failures. This path does not drop the module: it keeps
        // going with the *unvendored* code, and it is this gap that stops that
        // result from being published. Degrading it to a route-local gap would
        // let a module whose dependencies were never vendored reach a manifest.
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
        imports = await collectProjectModuleImports(
          code,
          logicalPath,
          knownPaths,
          projectImportAliases,
        );
      } catch (error) {
        const sanitized = sanitizeError(error);
        pushGap(moduleGaps, `module-import-parse-failed:${logicalPath}`);
        logger.warn("Module import parse failed during release asset build", {
          path: logicalPath,
          error: sanitized,
        });
        return [];
      }
    }

    // This module ships to the browser, so everything it imports is client
    // code too. Propagate that trust before the imports are dequeued, and
    // reclassify any import that an earlier server-module traversal parked as
    // a server module: it must be transformed and published after all, or the
    // importing module's finalize step has nothing to rewrite the edge to.
    for (const importedPath of imports.values()) {
      if (clientTrustedPaths.has(importedPath)) continue;
      clientTrustedPaths.add(importedPath);
      if (serverModuleImports.has(importedPath)) {
        moduleQueue.push(importedPath);
      } else if (transformedModules.delete(importedPath)) {
        // A broad browser seed can be transformed before its client importer.
        // Re-run it now that inherited client trust requires boundary checks.
        moduleQueue.push(importedPath);
      }
    }

    // Keep the server traversal for server edges even after browser promotion.
    // Route assembly selects the graph per edge after finalization, so a failed
    // browser publication cannot break an otherwise valid server-only path.
    transformedModules.set(logicalPath, { logicalPath, code, unvendoredCode });
    return [...imports.values()];
  }

  const serverModuleImports = new Map<string, readonly string[]>();
  // Logical paths outside the seeded browser locations that a server-module
  // edge reached. They default to server modules wherever they live on disk,
  // unless a client boundary also imports them.
  const serverReachedPaths = new Set<string>();
  // Logical paths that inherit the client boundary from an importing browser
  // module, so App Router files without their own "use client" directive are
  // still transformed when a client component pulls them in.
  const clientTrustedPaths = new Set<string>();
  const moduleQueue: string[] = [];
  const queuedModules = new Set<string>();
  const browserSeeds = [...sourceByPath.keys()].filter((logicalPath) =>
    isBrowserModule(logicalPath, routeDirectories)
  );
  const seedRank = (logicalPath: string): number => {
    const source = sourceByPath.get(logicalPath) ?? "";
    const sourcePolicy = classifyBrowserModuleSourcePath(logicalPath, {
      config: releaseConfig,
      rscEnabled: releaseRscEnabled,
      isLocalProject: false,
    });
    if (sourcePolicy.protectionReason !== null || hasUseServerDirective(source)) return 0;
    if (isConfiguredAppRouterModule(logicalPath, routeDirectories)) {
      return isTrustedAppRouterBrowserModule(source, logicalPath) ? 1 : 0;
    }
    return routeForConfiguredPage(logicalPath, routeDirectories) !== null ? 1 : 2;
  };
  browserSeeds.sort((left, right) => {
    const rankDifference = seedRank(left) - seedRank(right);
    if (rankDifference !== 0) return rankDifference;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const logicalPath of browserSeeds) {
    const pagesRouterEntry = routeForConfiguredPage(logicalPath, routeDirectories) !== null &&
      !isConfiguredAppRouterModule(logicalPath, routeDirectories);
    const nonRscAppRouterEntry = !releaseRscEnabled &&
      isConfiguredAppRouterBrowserEntry(logicalPath, routeDirectories);
    if (pagesRouterEntry || nonRscAppRouterEntry) {
      clientTrustedPaths.add(logicalPath);
    }
  }

  const enqueueModule = (logicalPath: string) => {
    if (queuedModules.has(logicalPath)) return;
    queuedModules.add(logicalPath);
    moduleQueue.push(logicalPath);
  };
  let moduleQueueIndex = 0;
  const drainModuleQueue = async () => {
    while (moduleQueueIndex < moduleQueue.length) {
      const logicalPath = moduleQueue[moduleQueueIndex++]!;
      for (const importedPath of await transformProjectModule(logicalPath)) {
        enqueueModule(importedPath);
      }
    }
  };

  // Build the complete server closure before broad directory seeds can be
  // transformed. Otherwise a generic seed that sorts before its server
  // importer can publish itself and propagate false client trust to its own
  // dependencies before the server edge reaches it.
  for (const logicalPath of browserSeeds) {
    if (seedRank(logicalPath) === 0) enqueueModule(logicalPath);
  }
  await drainModuleQueue();
  for (const logicalPath of browserSeeds) enqueueModule(logicalPath);
  await drainModuleQueue();

  if (typeof vendorHttpImports === "function") {
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
  const requestedFrameworkSpecifiers = await collectRequestedFrameworkSpecifiers(
    transformedModules,
  );
  const frameworkDependencies = await buildFrameworkDependencies(
    {
      projectId: input.projectId,
      adapter: transformAdapter,
      reactVersion: releaseReactVersion,
      allowHttp: !vendorDependencies,
      requestedSpecifiers: requestedFrameworkSpecifiers,
    },
    tempDir,
    transform,
    dependencyPinningSnapshot,
    dependencyPinningSource,
    dependencyUrls,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  addFrameworkDependencyUrlAliases(dependencyUrls, frameworkDependencies);
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
    projectImportAliases,
    dependencyUrls,
    uploadQueue,
    pendingBytes,
    moduleGaps,
    !vendorDependencies,
    releaseReactVersion,
    releaseConfig.build?.serverExternalPackages,
  );

  for (const logicalPath of transformedModules.keys()) {
    if (modules[logicalPath]) continue;
    if (skippedModules.has(logicalPath)) continue;

    logger.warn("Module exceeds max size, skipping", {
      path: logicalPath,
      limit: RELEASE_ASSET_MAX_SIZE_BYTES,
    });
  }

  // 5b. CSS: compile requested project CSS and fail closed on any invalid output.
  const css: ReleaseAssetCssEntry[] = [];
  const cssHashes: string[] = [];
  const candidates = collectClassCandidates(sourceByPath);
  if (candidates.size > MAX_CSS_CANDIDATES) {
    throw new Error(
      `Release asset CSS candidates exceed ${MAX_CSS_CANDIDATES} entries`,
    );
  }

  const stylesheetPath = releaseConfig.tailwind?.stylesheet;
  const resolvedStylesheet = resolveProjectStylesheet(sourceByPath, stylesheetPath);
  if (stylesheetPath !== undefined && resolvedStylesheet === undefined) {
    pushGap(gaps, `stylesheet-missing:${stylesheetPath}`);
    assertCompleteReleaseAssetCoverage(gaps, moduleGaps);
  }
  const stylesheet = await mergeModuleCssImports(
    sourceByPath,
    resolvedStylesheet,
    projectImportAliases,
  );
  assertCompleteReleaseAssetCoverage(gaps, moduleGaps);
  const cssRequested = candidates.size > 0 || stylesheet !== undefined;
  if (cssRequested) {
    const stylesheetBytes = stylesheet ? textEncoder.encode(stylesheet).byteLength : 0;
    if (stylesheetBytes > MAX_CSS_INPUT_BYTES) {
      throw new Error(
        `Release asset CSS input exceeds ${MAX_CSS_INPUT_BYTES} bytes`,
      );
    }

    const compiledResult = await client.compileProjectCss(candidates, stylesheet, {
      config: releaseConfig,
    });
    if (compiledResult === null) {
      throw new Error("Release asset CSS compiler returned no requested output");
    }
    const compiled = snapshotCompiledProjectCss(compiledResult);
    const bytes = textEncoder.encode(compiled.css) as Uint8Array<ArrayBuffer>;
    if (bytes.byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) {
      throw new Error(
        `Release asset CSS output exceeds ${RELEASE_ASSET_MAX_SIZE_BYTES} bytes`,
      );
    }

    const contentHash = await computeHashBytes(bytes);
    css.push({
      contentHash,
      size: bytes.byteLength,
      contentType: RELEASE_ASSET_CONTENT_TYPES.css,
      styleProfileHash: compiled.styleProfileHash,
      cssPipelineIdentity: compiled.cssPipelineIdentity,
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

  // B2. Routes: walk the transformed browser import closure from each page entrypoint.
  // Modules missing from transformedModules are recorded as closure gaps.
  const routes: Record<string, ReleaseAssetRouteEntry> = {};
  const droppedRoutes = new Map<string, string[]>();
  const finalizedModulePaths = new Set(Object.keys(modules));
  const pageModules = [...sourceByPath.keys()].filter((p) =>
    routeForConfiguredPage(p, routeDirectories) !== null
  );

  for (const logicalPath of pageModules) {
    const route = routeForConfiguredPage(logicalPath, routeDirectories);
    if (!route) continue;
    if (Object.hasOwn(routes, route)) {
      pushGap(gaps, `route-collision:${route}`);
      continue;
    }

    const entryModules = [
      logicalPath,
      ...collectConfiguredAppRouterLayoutsForPage(logicalPath, routeDirectories, knownPaths),
    ];
    const { modules: closureModules, gaps: closureGaps } = await collectRouteClosure(
      entryModules,
      transformedModules,
      finalizedModulePaths,
      knownPaths,
      projectImportAliases,
      serverModuleImports,
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

    // A route with a hole in its closure is omitted rather than published with
    // one. Shipping it would hand the browser an import map pointing at a
    // module the admission boundary refuses.
    if (closureGaps.length > 0) {
      droppedRoutes.set(route, closureGaps);
      continue;
    }

    routes[route] = { modules: manifestedModules, css: cssHashes };
  }

  // Every route the release could not cover, so an operator sees which pages
  // this build left unserveable even when the manifest publishes.
  if (droppedRoutes.size > 0) {
    logger.warn("Omitting routes with incomplete release asset coverage", {
      dropped: [...droppedRoutes.keys()],
      published: Object.keys(routes).length,
    });
  }

  // One unbuildable page must not take the site down. Module and route gaps
  // only become fatal when they leave nothing to serve -- a project whose sole
  // page is broken still fails closed, while a project with one bad page among
  // many publishes the rest. Before this, a single unresolvable import failed
  // the whole manifest, and the renderer then 503'd every module on every
  // route because manifest admission had nothing to admit against.
  const hasServeableRoute = Object.keys(routes).length > 0;
  if (!hasServeableRoute) {
    for (const gap of moduleGaps) pushGap(gaps, gap);
    for (const routeGaps of droppedRoutes.values()) {
      for (const gap of routeGaps) pushGap(gaps, gap);
    }
  }

  // A v2 manifest is publishable only when every requested module,
  // dependency, route closure, and stylesheet has complete immutable coverage.
  assertCompleteReleaseAssetCoverage(gaps, moduleGaps);

  // Upload only after coverage is proven complete, so failed builds do not
  // leave unreferenced immutable assets behind.
  await uploadWithConcurrency(uploadQueue, RELEASE_ASSET_UPLOAD_CONCURRENCY, async (asset) => {
    const stored = requirePendingAsset(pendingBytes, asset);
    const acknowledgement = await client.uploadReleaseAsset(
      input.releaseVersionRef,
      asset.contentHash,
      stored.contentType,
      stored.bytes,
    );
    const acknowledgedStored = readOwnDataProperty(acknowledgement, "stored");
    const acknowledgedExisting = readOwnDataProperty(acknowledgement, "existed");
    if (
      typeof acknowledgedStored !== "boolean" ||
      typeof acknowledgedExisting !== "boolean" ||
      (!acknowledgedStored && !acknowledgedExisting)
    ) {
      throw new Error("Release asset upload was not acknowledged");
    }
    forgetPendingAsset(pendingBytes, asset);
  });

  // 6. Assemble and PUT the manifest.
  const manifest: ReleaseAssetManifest = {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    dependencyMode: input.dependencyMode,
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
  };

  const verifiedManifest = parseReleaseAssetManifest(manifest);
  if (!verifiedManifest) {
    throw new Error("Release asset manifest failed internal validation");
  }
  const result = await client.putReleaseAssetManifest(
    input.releaseVersionRef,
    verifiedManifest,
  );
  const acknowledgedState = readOwnDataProperty(result, "state");
  const acknowledgedManifestVersion = readOwnDataProperty(result, "manifest_version");
  if (
    acknowledgedState !== "ready" ||
    typeof acknowledgedManifestVersion !== "number" ||
    !Number.isSafeInteger(acknowledgedManifestVersion) ||
    acknowledgedManifestVersion !== manifestVersion
  ) {
    throw new Error("Release asset manifest PUT was not acknowledged");
  }
  logger.info("Release asset manifest built", {
    releaseId: input.releaseId,
    manifestVersion,
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    state: "ready",
  });

  return {
    success: true,
    state: "ready",
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    coverageFailures: [],
  };
}

async function releaseFileSetSignature(sourceByPath: Map<string, string>): Promise<string> {
  const entries = [...sourceByPath.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const serialized = JSON.stringify(entries);
  return await computeHashBytes(
    textEncoder.encode(serialized) as Uint8Array<ArrayBuffer>,
  );
}

/**
 * Resolve the project stylesheet from the materialized file set.
 * A configured path is authoritative and must be canonical. Conventional
 * defaults are considered only when no path was configured.
 */
function resolveProjectStylesheet(
  sourceByPath: Map<string, string>,
  stylesheetPath: string | undefined,
): { content: string; path: string } | undefined {
  const candidatePaths = stylesheetPath === undefined
    ? ["globals.css", "src/globals.css"]
    : [requireCanonicalReleaseFilePath(stylesheetPath)];
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
 * CSS Module selectors are rewritten with the same project-relative identity
 * used by the transform and HTML aggregation paths.
 */
async function mergeModuleCssImports(
  sourceByPath: Map<string, string>,
  stylesheet: { content: string; path: string } | undefined,
  projectImportAliases: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const importedPaths = new Set<string>();
  const knownPaths = new Set(sourceByPath.keys());
  for (const [path, content] of sourceByPath) {
    if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    // The source-span scanners understand comments, strings, JSX, and
    // TypeScript without requiring the raw source to be valid plain
    // JavaScript. That keeps the JSX-safe behavior this release path needs,
    // while ensuring quoted or commented import/export examples cannot merge
    // a real but unreachable stylesheet into production CSS.
    // Matcher rejections do not count against the scanner bound. Restricting
    // the scan here keeps a generated file's ordinary imports from exhausting
    // the budget before a later live stylesheet edge.
    const keepCssSpecifier = (specifier: string) => {
      if (isExternalCssSpecifier(specifier)) return specifier;
      if (
        !mayResolveProjectStylesheetSpecifier(
          specifier,
          projectImportAliases,
        )
      ) return null;
      const aliasResolution = resolveProjectImportAlias(
        specifier,
        projectImportAliases,
        knownPaths,
        resolveKnownStylesheetPath,
      );
      return aliasResolution.matched && aliasResolution.path ? specifier : null;
    };
    const specifiers = new Set<string>();
    const findCompleteCssSpans = (
      scan: (maxMatches: number) => ReturnType<typeof findStaticImportFromSpans>,
    ) => {
      const spans = scan(MAX_RELEASE_FILES + 1);
      if (spans.length > MAX_RELEASE_FILES) {
        throw new Error(
          `Release CSS import scan exceeds ${MAX_RELEASE_FILES} matches in ${path}`,
        );
      }
      return spans;
    };
    for (
      const spans of [
        findCompleteCssSpans((maxMatches) =>
          findStaticImportFromSpans(content, keepCssSpecifier, maxMatches)
        ),
        findCompleteCssSpans((maxMatches) =>
          findStaticSideEffectImportSpans(content, keepCssSpecifier, maxMatches)
        ),
        findCompleteCssSpans((maxMatches) =>
          findDynamicImportSpans(content, keepCssSpecifier, maxMatches)
        ),
      ]
    ) {
      for (const span of spans) {
        if (span.typeOnly !== true) specifiers.add(span.path);
      }
    }
    for (const specifier of specifiers) {
      const cssPath = specifier.startsWith("#") ? specifier : splitSpecifierSuffix(specifier).path;
      const aliasResolution = resolveProjectImportAlias(
        cssPath,
        projectImportAliases,
        knownPaths,
        resolveKnownStylesheetPath,
      );
      if (aliasResolution.matched) {
        if (aliasResolution.path !== undefined && aliasResolution.path !== null) {
          importedPaths.add(aliasResolution.path);
        }
        continue;
      }
      if (!cssPath.endsWith(".css")) continue;
      // Nothing this scan fails to resolve is fatal, because a regex match is
      // not knowledge that the build needs the file. extractCssImportSpecifiers
      // is text-based by design and says so ("over-matching is harmless"); this
      // path broke that contract by turning its output into a coverage gap, and
      // assertCompleteReleaseAssetCoverage throws on gaps. Three rounds of
      // review found three more ways ordinary source produces a phantom
      // specifier, each of which would have blocked a project's releases.
      //
      // Merging module CSS is an enhancement: when it cannot resolve something
      // the right outcome is unmerged CSS, not a refused release. Genuine
      // missing-CSS detection belongs on the resolved module graph
      // (collectProjectModuleImports, over transformed code where the lexer is
      // trustworthy), not on this text scan.
      const importedPath = resolveCssImportPath(cssPath, `/${path}`, "/");
      if (!importedPath) {
        logger.debug("Skipping CSS import that does not resolve", { path, specifier });
        continue;
      }

      const relativePath = importedPath.replace(/^\/+/, "");
      if (!sourceByPath.has(relativePath)) {
        logger.debug("Skipping CSS import with no matching source file", { path, relativePath });
        continue;
      }
      importedPaths.add(relativePath);
    }
  }

  const segments: string[] = [];
  let moduleCount = 0;
  let regularCount = 0;
  for (const relativePath of [...importedPaths].sort(compareStrings)) {
    if (relativePath === stylesheet?.path) continue;
    const content = sourceByPath.get(relativePath);
    if (content === undefined) continue;
    if (relativePath.endsWith(".module.css")) {
      segments.push(rewriteCssModuleContent(content, `/${relativePath}`));
      moduleCount++;
    } else {
      segments.push(content);
      regularCount++;
    }
  }

  if (segments.length === 0) return stylesheet?.content;

  logger.debug("Merged module CSS imports into release stylesheet", {
    importedCount: segments.length,
    regularCount,
    moduleCount,
  });
  return [stylesheet?.content, ...segments].filter((value) => value !== undefined).join("\n");
}

/** Extract CSS class candidates from materialized source. */
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
