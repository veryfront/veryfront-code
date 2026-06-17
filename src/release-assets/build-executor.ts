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
 * - Any module transform failure reports `failed` and stops without PUTting.
 * - Any other build failure (list/hash/upload/PUT) also reports `failed`.
 * - The temp dir is always cleaned up by the caller.
 *
 * @module release-assets/build-executor
 */

import { serverLogger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import { resolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser, NodePath } from "#veryfront/extensions/parser/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { dirname, join, normalize } from "#veryfront/compat/path/index.ts";
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
import { getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";
import { PLATFORM_UTILITIES } from "#veryfront/html/utils.ts";
import { extractCandidatesFromFiles } from "#veryfront/html/styles-builder/candidate-extractor.ts";
import { sha256HexBytes } from "./hash.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
  releaseAssetUrl,
} from "./constants.ts";
import { routeForPage } from "./route-path.ts";
export { routeForPage } from "./route-path.ts";
import type {
  ReleaseAssetCssEntry,
  ReleaseAssetManifest,
  ReleaseAssetRouteEntry,
} from "./manifest-schema.ts";

const logger = serverLogger.component("release-asset-build");

/** Browser module source extensions eligible for transform. */
const BROWSER_MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
/** Directories used as browser graph entry seeds. Imports may reach any project directory. */
const BROWSER_MODULE_DIRS = ["pages/", "components/", "layouts/", "lib/", "src/"];
const FRAMEWORK_MODULE_URL_PREFIX = "/_vf_modules/_veryfront/";
const REACT_IMPORT_MAP_DEPENDENCIES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

function isDependencyImportMapEnabled(): boolean {
  return getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
}

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
   * Configured Tailwind stylesheet path (relative to the project root), used to
   * resolve the project stylesheet from the materialized file set for CSS
   * compilation. When absent, conventional defaults are tried (globals.css).
   */
  stylesheetPath?: string;
  /** Authenticated, project-scoped API client. */
  client: ReleaseAssetBuildClient;
  /** Runtime adapter used by the transform pipeline. */
  // deno-lint-ignore no-explicit-any -- adapter is passed through to transformToESM
  adapter: any;
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

export type ReleaseAssetTransform = (
  source: string,
  sourceFile: string,
  projectDir: string,
  // deno-lint-ignore no-explicit-any -- adapter is opaque to the executor
  adapter: any,
  options: { projectId: string; dev: boolean; ssr: boolean; reactVersion?: string },
) => Promise<string>;

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

export interface ReleaseAssetVendorResult {
  code: string;
  dependencies: ReleaseAssetVendorDependency[];
}

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
    contentType: string,
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
  ): Promise<{ css: string; styleProfileHash: string | null } | null>;
}

export interface ReleaseAssetBuildResult {
  success: boolean;
  state: "ready" | "failed";
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
  contentType: string;
}

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
}

interface FinalizedDependencyModules {
  assets: Record<string, PreparedAsset>;
  fallbackUrls: Map<string, string>;
}

interface ModuleSpecifierNode {
  importKind?: string;
  exportKind?: string;
}

interface ModuleSourceNode {
  source?: { value?: unknown };
  importKind?: string;
  exportKind?: string;
  specifiers?: ModuleSpecifierNode[];
}

function frameworkModuleUrlToSourceKey(moduleUrl: string): string | null {
  if (!moduleUrl.startsWith(FRAMEWORK_MODULE_URL_PREFIX)) return null;
  return moduleUrl
    .slice(FRAMEWORK_MODULE_URL_PREFIX.length)
    .replace(/\.(mjs|cjs|js|jsx|ts|tsx)$/, "");
}

function frameworkSourceKeyToModuleUrl(sourceKey: string): string {
  return `${FRAMEWORK_MODULE_URL_PREFIX}${sourceKey}.js`;
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
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/[^\s]+/g, "<path>").slice(0, 300);
}

/** True when a logical path is an eligible browser module. */
function isTransformableBrowserModule(path: string): boolean {
  if (!BROWSER_MODULE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (path.endsWith(".d.ts")) return false;
  return true;
}

/** True when a logical path should seed the browser module graph. */
function isBrowserModule(path: string): boolean {
  if (!isTransformableBrowserModule(path)) return false;
  return BROWSER_MODULE_DIRS.some((dir) => path.startsWith(dir));
}

/**
 * Statically resolve runtime imports in a TS/JSX source file to logical paths.
 * Uses the CodeParser AST contract so type-only imports do not enter route
 * preload closure.
 */
async function collectStaticProjectModuleImports(
  source: string,
  moduleLogicalPath: string,
  knownPaths: Set<string>,
): Promise<string[]> {
  return await collectAstStaticProjectModuleImports(source, moduleLogicalPath, knownPaths);
}

function readModuleSource(node: ModuleSourceNode): string | null {
  return typeof node.source?.value === "string" ? node.source.value : null;
}

function isTypeOnlyModuleDeclaration(node: ModuleSourceNode): boolean {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  if (!node.specifiers?.length) return false;
  return node.specifiers.every((specifier) =>
    specifier.importKind === "type" || specifier.exportKind === "type"
  );
}

async function collectAstStaticProjectModuleImports(
  source: string,
  moduleLogicalPath: string,
  knownPaths: Set<string>,
): Promise<string[]> {
  const parser = resolve<CodeParser>("CodeParser");
  const ast = await parser.parse({ code: source, filePath: moduleLogicalPath });
  const results = new Set<string>();

  const visit = (path: NodePath) => {
    const node = path.node as ModuleSourceNode;
    if (isTypeOnlyModuleDeclaration(node)) return;

    const specifier = readModuleSource(node);
    if (!specifier) return;

    const importedPath = resolveProjectModuleSpecifier(specifier, moduleLogicalPath, knownPaths);
    if (importedPath) results.add(importedPath);
  };

  parser.traverse(ast, {
    ImportDeclaration: visit,
    ExportNamedDeclaration: visit,
    ExportAllDeclaration: visit,
  });

  return [...results];
}

function resolveKnownModulePath(path: string, knownPaths: Set<string>): string | null {
  const normalized = normalizeLogicalPath(
    path
      .replace(/^\/?_vf_modules\//, "")
      .replace(/^\/+/, "")
      .replace(/[?#].*$/, ""),
  );

  if (normalized.startsWith("_veryfront/")) return null;
  if (knownPaths.has(normalized)) return normalized;

  const withoutExt = normalized.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  for (const ext of BROWSER_MODULE_EXTENSIONS) {
    const candidate = `${withoutExt}${ext}`;
    if (knownPaths.has(candidate)) return candidate;
  }

  return null;
}

function normalizeLogicalPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
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

  if (BROWSER_MODULE_DIRS.some((dir) => specifier.startsWith(dir))) return specifier;

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

    urls.set(manifestKey, url);
    urls.set(normalizeDependencySpecifier(manifestKey), url);
    if (manifestKey.startsWith("http://") || manifestKey.startsWith("https://")) {
      const normalized = normalizeHttpUrl(manifestKey);
      urls.set(normalized, url);
      urls.set(normalizeDependencySpecifier(normalized), url);
    }

    if (!dependency) continue;

    urls.set(entry.logicalPath, url);
    for (const specifier of dependency.specifiers) {
      urls.set(specifier, url);
      urls.set(normalizeDependencySpecifier(specifier), url);
      if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
        const normalized = normalizeHttpUrl(specifier);
        urls.set(normalized, url);
        urls.set(normalizeDependencySpecifier(normalized), url);
      }
    }
  }
  return urls;
}

export function buildReleaseAssetDependencyUrlMap(
  dependencies: Record<string, PreparedAsset>,
): Map<string, string> {
  return buildDependencyUrlMap(dependencies);
}

function exposeDependencySpecifierAliases(
  assets: Record<string, PreparedAsset>,
  dependencyModules: Map<string, DependencyModule>,
): Record<string, PreparedAsset> {
  const aliased = { ...assets };
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
      aliased[normalized] = asset;
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
  urls.set(dependency.manifestKey, url);
  if (dependency.sourcePath) urls.set(`file://${dependency.sourcePath}`, url);
  for (const specifier of dependency.specifiers) {
    urls.set(normalizeDependencySpecifier(specifier), url);
  }
}

function addDependencyModule(
  dependencies: Map<string, DependencyModule>,
  dependency: ReleaseAssetVendorDependency,
): void {
  const sourcePath = dependency.sourcePath ?? resolveLocalDependencyPath(dependency.specifier) ??
    undefined;
  const existing = dependencies.get(dependency.manifestKey);
  if (existing) {
    existing.specifiers.add(dependency.specifier);
    existing.sourcePath ??= sourcePath;
    return;
  }

  dependencies.set(dependency.manifestKey, {
    manifestKey: dependency.manifestKey,
    specifiers: new Set([dependency.specifier]),
    sourcePath,
    code: dependency.code,
  });
}

function normalizeDependencySpecifier(specifier: string): string {
  return specifier.replace(/[?#].*$/, "");
}

function pushGap(gaps: string[], gap: string): void {
  if (!gaps.includes(gap)) gaps.push(gap);
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
  dependencies: Map<string, DependencyModule>,
): Promise<void> {
  const reactUrls = getReactUrls(input.reactVersion);
  const entries: Array<readonly [string, string]> = [];
  for (const specifier of REACT_IMPORT_MAP_DEPENDENCIES) {
    const url = reactUrls[specifier];
    if (url) entries.push([specifier, url] as const);
  }

  const source = entries.map(([, url]) => `import ${JSON.stringify(url)};`).join("\n");
  if (!source) return;

  const vendored = await vendorHttpImports(source, {
    tempDir,
    reactVersion: input.reactVersion,
  });
  for (const dependency of vendored.dependencies) {
    addDependencyModule(dependencies, dependency);
  }

  for (const [specifier, url] of entries) {
    const dependency = findDependencyModuleBySpecifier(dependencies, url);
    if (!dependency) {
      throw new Error(`React import-map dependency missing: ${specifier}`);
    }
    dependency.specifiers.add(specifier);
  }
}

function resolveLocalDependencyPath(specifier: string, parentFilePath?: string): string | null {
  const normalized = normalizeDependencySpecifier(specifier);

  if (normalized.startsWith("file://")) {
    try {
      return normalize(decodeURIComponent(new URL(normalized).pathname));
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

async function collectLocalHttpDependencyModules(
  code: string,
  dependencies: Map<string, DependencyModule>,
  cacheDir: string,
): Promise<void> {
  const fs = createFileSystem();
  const cacheRoot = normalize(cacheDir);
  const seen = new Set<string>();
  const queue: Array<{ specifier: string; parentFilePath?: string }> = [];

  for (const imp of await parseImports(code)) {
    if (imp.n) queue.push({ specifier: imp.n });
  }

  while (queue.length > 0) {
    const { specifier, parentFilePath } = queue.shift()!;
    const filePath = resolveLocalDependencyPath(specifier, parentFilePath);
    if (!filePath || seen.has(filePath)) continue;
    if (!isPathInsideRoot(filePath, cacheRoot)) {
      throw new Error(`Vendored HTTP dependency resolved outside cache root: ${specifier}`);
    }
    seen.add(filePath);

    const depCode = await fs.readTextFile(filePath);
    const manifestKey = extractSourceUrl(depCode) ?? `file://${filePath}`;
    const depSpecifiers = new Set<string>([
      normalizeDependencySpecifier(specifier),
      `file://${filePath}`,
    ]);

    const existing = dependencies.get(manifestKey);
    if (existing) {
      for (const depSpecifier of depSpecifiers) existing.specifiers.add(depSpecifier);
      existing.sourcePath ??= filePath;
    } else {
      dependencies.set(manifestKey, {
        manifestKey,
        specifiers: depSpecifiers,
        sourcePath: filePath,
        code: depCode,
      });
    }

    for (const imp of await parseImports(depCode)) {
      if (imp.n) queue.push({ specifier: imp.n, parentFilePath: filePath });
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

  const dependencies = new Map<string, DependencyModule>();
  await collectLocalHttpDependencyModules(result.code, dependencies, cacheDir);

  return {
    code: result.code,
    dependencies: [...dependencies.values()].flatMap((dependency) =>
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
  const dependencyModules = new Map<string, DependencyModule>();
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const gaps: string[] = [];
  const vendorHttpImports = options.vendorHttpImports ?? vendorHttpImportsWithCache;

  await collectReactImportMapDependencyModules(
    { reactVersion: options.reactVersion },
    options.tempDir,
    vendorHttpImports,
    dependencyModules,
  );

  const finalized = await finalizeDependencyModules(
    dependencyModules,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  const dependencies = exposeDependencySpecifierAliases(finalized.assets, dependencyModules);

  return {
    dependencies,
    assets: uploadQueue.flatMap((asset) => {
      const stored = pendingBytes.get(asset.contentHash);
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
  dependencies: Map<string, DependencyModule>,
): Promise<void> {
  const fs = createFileSystem();
  const cacheRoot = normalize(cacheDir);

  async function visit(dir: string): Promise<void> {
    let entries: AsyncIterable<{ name: string; isFile?: boolean; isDirectory?: boolean }>;
    try {
      entries = fs.readDir(dir);
    } catch {
      return;
    }

    for await (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        await visit(path);
        continue;
      }
      if (!entry.isFile || !/^http-[a-z0-9]+\.mjs$/i.test(entry.name)) continue;
      const filePath = normalize(path);
      if (!isPathInsideRoot(filePath, cacheRoot)) {
        throw new Error(`Cached HTTP dependency resolved outside cache root: ${filePath}`);
      }

      const code = await fs.readTextFile(filePath);
      const manifestKey = extractSourceUrl(code) ?? `file://${filePath}`;
      const specifiers = [`file://${filePath}`];
      if (manifestKey.startsWith("http://") || manifestKey.startsWith("https://")) {
        specifiers.push(manifestKey);
      }

      const existing = dependencies.get(manifestKey);
      if (existing) {
        for (const specifier of specifiers) existing.specifiers.add(specifier);
        existing.sourcePath ??= filePath;
      } else {
        dependencies.set(manifestKey, {
          manifestKey,
          specifiers: new Set(specifiers),
          sourcePath: filePath,
          code,
        });
      }
    }
  }

  await visit(cacheDir);
}

export async function buildCachedHttpDependencyAssets(options: {
  cacheDir: string;
}): Promise<{
  dependencies: Record<string, PreparedAsset>;
  assets: PreparedReleaseAsset[];
  gaps: string[];
}> {
  const fs = createFileSystem();
  const cacheStat = await fs.stat(options.cacheDir).catch(() => null);
  if (!cacheStat?.isDirectory) {
    return { dependencies: {}, assets: [], gaps: [] };
  }

  const dependencyModules = new Map<string, DependencyModule>();
  const uploadQueue: PreparedAsset[] = [];
  const pendingBytes = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const gaps: string[] = [];

  await collectCachedHttpDependencyModules(options.cacheDir, dependencyModules);

  const finalized = await finalizeDependencyModules(
    dependencyModules,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  const dependencies = exposeDependencySpecifierAliases(finalized.assets, dependencyModules);

  return {
    dependencies,
    assets: uploadQueue.flatMap((asset) => {
      const stored = pendingBytes.get(asset.contentHash);
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
  pendingBytes: Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>,
  gaps: string[],
): Promise<FinalizedDependencyModules> {
  const bySpecifier = new Map<string, DependencyModule>();
  const byFilePath = new Map<string, DependencyModule>();
  for (const dependency of dependencyModules.values()) {
    for (const specifier of dependency.specifiers) {
      bySpecifier.set(normalizeDependencySpecifier(specifier), dependency);
      const filePath = resolveLocalDependencyPath(specifier);
      if (filePath) byFilePath.set(filePath, dependency);
    }
    if (dependency.sourcePath) byFilePath.set(dependency.sourcePath, dependency);
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
      gaps.push(gap);
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
        bySpecifier.set(normalizeDependencySpecifier(specifier), dependency);
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
  pendingBytes: Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>,
  gaps: string[],
): Promise<{ modules: Record<string, PreparedAsset>; skippedModules: Set<string> }> {
  const finalized = new Map<string, PreparedAsset>();
  const unresolvedCycles = new Set<string>();
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
        gaps.push(gap);
      }
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
      return null;
    }
    for (const importedPath of imports.values()) {
      await finalize(importedPath, nextStack);
    }

    const rewritten = await rewriteProjectModuleImports(
      transformed.code,
      logicalPath,
      finalized,
      knownPaths,
      dependencyUrls,
    );
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
      const gap = `oversized:${logicalPath}`;
      if (!gaps.includes(gap)) gaps.push(gap);
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
        gaps.push(gap);
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
  pendingBytes: Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>,
): Promise<PreparedAsset | null> {
  const bytes = new TextEncoder().encode(code) as Uint8Array<ArrayBuffer>;
  if (bytes.byteLength > RELEASE_ASSET_MAX_SIZE_BYTES) return null;

  const contentHash = await sha256HexBytes(bytes);
  const entry: PreparedAsset = {
    logicalPath,
    contentHash,
    size: bytes.byteLength,
    contentType: RELEASE_ASSET_CONTENT_TYPES.js,
  };
  if (!pendingBytes.has(contentHash)) {
    pendingBytes.set(contentHash, { bytes, contentType: RELEASE_ASSET_CONTENT_TYPES.js });
    uploadQueue.push(entry);
  }
  return entry;
}

async function buildFrameworkDependencies(
  input: ReleaseAssetBuildInput,
  tempDir: string,
  transform: ReleaseAssetTransform,
  dependencyUrls: Map<string, string>,
  uploadQueue: PreparedAsset[],
  pendingBytes: Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>,
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
      gaps.push(`dependency-cycle:${publicSpecifier}:${sourceKey}`);
      return null;
    }

    const frameworkSource = await resolveFrameworkSourcePath(sourceKey, {
      extraLookupDirs: [join(tempDir, "src")],
    });
    if (!frameworkSource) {
      gaps.push(`dependency-missing:${publicSpecifier}:${sourceKey}`);
      return null;
    }

    visiting.add(sourceKey);
    let code: string;
    try {
      const source = await fs.readTextFile(frameworkSource.path);
      code = await transform(source, frameworkSource.path, tempDir, input.adapter, {
        projectId: input.projectId,
        dev: false,
        ssr: false,
        reactVersion: input.reactVersion,
      });

      const frameworkImportUrls = new Map<string, string>();
      let hasUnresolvedFrameworkImport = false;
      for (const imp of await parseImports(code)) {
        if (!imp.n) continue;

        const importedSourceKey = await resolveFrameworkImport(imp.n, frameworkSource.path);
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
      gaps.push(`dependency-transform-failed:${publicSpecifier}:${sourceKey}`);
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
      gaps.push(`dependency-oversized:${publicSpecifier}:${sourceKey}`);
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
  // deno-lint-ignore no-explicit-any -- adapter is passed through to transformToESM
  adapter: any;
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
  const pendingBytes = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const gaps: string[] = [];
  const transform = options.transform ?? transformToESM;
  const dependencies = await buildFrameworkDependencies(
    {
      projectReference: options.projectId ?? "local",
      projectId: options.projectId ?? "local",
      releaseId: "local",
      releaseVersion: 0,
      releaseVersionRef: "local",
      reactVersion: options.reactVersion,
      client: undefined as unknown as ReleaseAssetBuildClient,
      adapter: options.adapter,
      transform,
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
      const stored = pendingBytes.get(asset.contentHash);
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
    urls.set(specifier, url);

    const moduleUrl = PLATFORM_UTILITIES[specifier];
    if (moduleUrl) urls.set(moduleUrl, url);
  }
}

/**
 * Walk the static import graph from a set of entry points using BFS.
 * Returns all reachable logical paths (entries included).
 * Modules not in `sourceByPath` are recorded as closure gaps.
 */
async function collectClosure(
  entrypoints: string[],
  sourceByPath: Map<string, string>,
  knownPaths: Set<string>,
): Promise<{ modules: string[]; gaps: string[] }> {
  const visited = new Set<string>();
  const queue = [...entrypoints];
  const gaps: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const source = sourceByPath.get(current);
    if (!source) {
      // Module referenced but not in the materialized file set.
      gaps.push(`closure-missing:${current}`);
      continue;
    }

    const imports = await collectStaticProjectModuleImports(source, current, knownPaths);
    for (const imp of imports) {
      if (!visited.has(imp)) queue.push(imp);
    }
  }

  return { modules: [...visited], gaps };
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
  const transform: ReleaseAssetTransform = input.transform ??
    ((source, sourceFile, projectDir, adapter, options) =>
      transformToESM(source, sourceFile, projectDir, adapter, {
        projectId: options.projectId,
        dev: options.dev,
        ssr: options.ssr,
        studioEmbed: false,
        reactVersion: options.reactVersion,
      }));

  // H1: wrap the whole build so any non-transform failure also reports failed.
  try {
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

async function runBuildInner(
  input: ReleaseAssetBuildInput,
  tempDir: string,
  client: ReleaseAssetBuildClient,
  transform: ReleaseAssetTransform,
): Promise<ReleaseAssetBuildResult> {
  // 1. Begin (idempotent). H2: capture manifest_version from the API response.
  const beginResult = await client.beginReleaseAssetManifestBuild(input.releaseVersionRef);
  const manifestVersion = beginResult.manifest_version;

  // 2. Materialize the release file set.
  const files = await client.listAllReleaseFiles(input.releaseVersionRef);
  const fs = createFileSystem();
  const sourceByPath = new Map<string, string>();

  for (const file of files) {
    if (typeof file.content !== "string") continue;
    sourceByPath.set(file.path, file.content);
    const abs = join(tempDir, file.path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeTextFile(abs, file.content);
  }

  // 3 + 4. Collect the browser module closure and transform each module
  // through the SAME pipeline serveModule uses (browser, non-SSR).
  const transformedModules = new Map<string, TransformedProjectModule>();
  const dependencyModules = new Map<string, DependencyModule>();
  const gaps: string[] = [];
  const uploadQueue: PreparedAsset[] = [];
  // Bytes are held per-hash only until uploaded, then dropped (M3).
  const pendingBytes = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  const knownPaths = new Set(sourceByPath.keys());
  const vendorHttpImports = input.vendorHttpImports ?? vendorHttpImportsWithCache;
  const vendorDependencies = isDependencyImportMapEnabled();
  const transformingModules = new Set<string>();

  async function transformProjectModule(
    logicalPath: string,
  ): Promise<ReleaseAssetBuildResult | null> {
    if (transformedModules.has(logicalPath) || transformingModules.has(logicalPath)) return null;
    if (!isTransformableBrowserModule(logicalPath)) return null;

    const source = sourceByPath.get(logicalPath);
    if (typeof source !== "string") return null;

    transformingModules.add(logicalPath);

    try {
      // M2: enforce client-side size limit before transform (source is a proxy;
      // transformed output is checked after encoding below).
      const sourceFile = join(tempDir, logicalPath);
      let code: string;
      try {
        code = await transform(source, sourceFile, tempDir, input.adapter, {
          projectId: input.projectId,
          dev: false,
          ssr: false,
          reactVersion: input.reactVersion,
        });
      } catch (error) {
        const sanitized = sanitizeError(error);
        pushGap(gaps, `module-transform-failed:${logicalPath}`);
        logger.warn("Module transform failed during release asset build", {
          path: logicalPath,
          error: sanitized,
        });
        return null;
      }

      const unvendoredCode = code;
      if (vendorDependencies) {
        try {
          const vendored = await vendorHttpImports(code, {
            tempDir,
            reactVersion: input.reactVersion,
          });
          code = vendored.code;
          for (const dependency of vendored.dependencies) {
            addDependencyModule(dependencyModules, dependency);
          }
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

      let imports: Map<string, string>;
      try {
        imports = await collectProjectModuleImports(code, logicalPath, knownPaths);
      } catch (error) {
        const sanitized = sanitizeError(error);
        pushGap(gaps, `module-import-parse-failed:${logicalPath}`);
        logger.warn("Module import parse failed during release asset build", {
          path: logicalPath,
          error: sanitized,
        });
        return null;
      }

      transformedModules.set(logicalPath, { logicalPath, code, unvendoredCode });
      for (const importedPath of imports.values()) {
        const failure = await transformProjectModule(importedPath);
        if (failure) return failure;
      }
    } finally {
      transformingModules.delete(logicalPath);
    }

    return null;
  }

  for (const logicalPath of sourceByPath.keys()) {
    if (!isBrowserModule(logicalPath)) continue;

    const failure = await transformProjectModule(logicalPath);
    if (failure) return failure;
  }

  if (vendorDependencies) {
    try {
      await collectReactImportMapDependencyModules(
        input,
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
  try {
    const finalizedHttpDependencies = await finalizeDependencyModules(
      dependencyModules,
      uploadQueue,
      pendingBytes,
      gaps,
    );
    httpDependencies = finalizedHttpDependencies.assets;
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
    dependencyModules.clear();
    httpDependencies = {};
    httpDependencyFallbackUrls = new Map();
  }
  httpDependencies = exposeDependencySpecifierAliases(httpDependencies, dependencyModules);
  const dependencyUrls = buildDependencyUrlMap(httpDependencies, dependencyModules);
  for (const [specifier, url] of httpDependencyFallbackUrls) {
    dependencyUrls.set(specifier, url);
  }
  const frameworkDependencies = await buildFrameworkDependencies(
    input,
    tempDir,
    transform,
    dependencyUrls,
    uploadQueue,
    pendingBytes,
    gaps,
  );
  if (vendorDependencies) addFrameworkDependencyUrlAliases(dependencyUrls, frameworkDependencies);
  const dependencies = { ...frameworkDependencies, ...httpDependencies };

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
      const stylesheet = resolveProjectStylesheet(sourceByPath, input.stylesheetPath);
      const compiled = await client.compileProjectCss(candidates, stylesheet);
      if (compiled && compiled.css) {
        const bytes = new TextEncoder().encode(compiled.css) as Uint8Array<ArrayBuffer>;
        const contentHash = await sha256HexBytes(bytes);
        css.push({
          contentHash,
          size: bytes.byteLength,
          contentType: RELEASE_ASSET_CONTENT_TYPES.css,
          styleProfileHash: compiled.styleProfileHash,
        });
        cssHashes.push(contentHash);
        if (!pendingBytes.has(contentHash)) {
          pendingBytes.set(contentHash, { bytes, contentType: RELEASE_ASSET_CONTENT_TYPES.css });
          uploadQueue.push({
            logicalPath: `__css__/${contentHash}`,
            contentHash,
            size: bytes.byteLength,
            contentType: RELEASE_ASSET_CONTENT_TYPES.css,
          });
        }
      } else {
        // The compiler degraded (returned null/empty) — record the gap so a
        // ready manifest never silently lacks the promised CSS signal.
        gaps.push("css:compile-failed");
        logger.warn("Release asset CSS compile returned no output (recording gap)");
      }
    } catch (error) {
      // CSS is best-effort: record a gap, keep css:[].
      gaps.push("css:compile-failed");
      logger.warn("Release asset CSS compile failed (recording gap)", {
        error: sanitizeError(error),
      });
    }
  } else {
    gaps.push("css:no-pipeline");
  }

  // 5a. Upload assets with bounded concurrency, dropping bytes after each
  // successful upload (M3) to bound peak memory.
  await uploadWithConcurrency(uploadQueue, RELEASE_ASSET_UPLOAD_CONCURRENCY, async (asset) => {
    const stored = pendingBytes.get(asset.contentHash);
    if (!stored) return;
    await client.uploadReleaseAsset(
      input.releaseVersionRef,
      asset.contentHash,
      stored.contentType,
      stored.bytes,
    );
    // M3: drop bytes immediately after upload.
    pendingBytes.delete(asset.contentHash);
  });

  // B2. Routes: walk the full static import closure from each page entrypoint.
  // Modules whose source is not in sourceByPath are recorded as closure gaps.
  const routes: Record<string, ReleaseAssetRouteEntry> = {};
  const pageModules = Object.keys(modules).filter((p) => p.startsWith("pages/"));

  for (const logicalPath of pageModules) {
    const route = routeForPage(logicalPath);
    if (!route) continue;

    const { modules: closureModules, gaps: closureGaps } = await collectClosure(
      [logicalPath],
      sourceByPath,
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
        closureGaps.push(`route-gap:${route}:${missing}`);
      }
    }
    if (closureGaps.length > 0) {
      gaps.push(...closureGaps.filter((g) => !gaps.includes(g)));
    }

    routes[route] = { modules: manifestedModules, css: cssHashes };
  }

  // 6. Assemble and PUT the manifest.
  const sourceContentHash = await sha256HexBytes(
    new TextEncoder().encode([...sourceByPath.keys()].sort().join("\n")) as Uint8Array<ArrayBuffer>,
  );
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

  const result = await client.putReleaseAssetManifest(input.releaseVersionRef, manifest);
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
    state: "ready",
    moduleCount: Object.keys(modules).length,
    cssCount: css.length,
    routeCount: Object.keys(routes).length,
    gaps,
  };
}

/**
 * Resolve the project Tailwind stylesheet from the materialized file set.
 * Tries the configured path first, then conventional defaults. Returns
 * `undefined` when none is present (the CSS compiler then uses its default).
 */
function resolveProjectStylesheet(
  sourceByPath: Map<string, string>,
  stylesheetPath: string | undefined,
): string | undefined {
  const candidatePaths = stylesheetPath
    ? [stylesheetPath, stylesheetPath.replace(/^\.?\//, "")]
    : ["globals.css", "src/globals.css"];
  for (const path of candidatePaths) {
    const content = sourceByPath.get(path);
    if (typeof content === "string") return content;
  }
  return undefined;
}

/** Extract Tailwind class candidates from materialized source. */
function collectClassCandidates(sourceByPath: Map<string, string>): Set<string> {
  return extractCandidatesFromFiles(
    [...sourceByPath.entries()].map(([path, content]) => ({ path, content })),
  );
}

/** Run an async task over items with a fixed concurrency limit. */
async function uploadWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      await task(items[current]!);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
