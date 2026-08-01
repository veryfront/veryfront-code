import { extractCandidatesWithByteLength } from "#veryfront/html/styles-builder/candidate-tokenizer.ts";
import { isAbsolute, resolve } from "#veryfront/compat/path/index.ts";
import {
  filterFilesForStyleScope,
  type StyleScopeProfile,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { getRouteModulePaths } from "#veryfront/modules/manifest/route-module-manifest.ts";
import { assertStyleProfileHash, rendererLogger } from "#veryfront/utils";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import {
  MAX_CSS_FILES,
  MAX_CSS_SELECTOR_TOKENS,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import {
  assertBoundedPathString,
  resolveCanonicalProjectRelativePath,
  toCanonicalProjectRelativePath,
} from "#veryfront/utils/project-relative-path.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  detachRetainedString,
  estimateRetainedStringBytes,
} from "#veryfront/html/styles-builder/css-cache-limits.ts";

interface SourceFileLike {
  path: string;
  content?: string;
}

interface CandidateManifest {
  projectScope: string;
  fileCandidates: Map<string, Set<string>>;
  allCandidates: Set<string>;
  builtAt: number;
  retainedBytes: number;
}

interface CandidateManifestResolution {
  manifestKey: string;
  manifest: CandidateManifest;
  cacheOwned: boolean;
}

interface RouteCandidateCacheEntry {
  manifestKey: string;
  projectScope: string;
  candidates: Set<string>;
  retainedBytes: number;
}

interface RouteCandidateOptions {
  projectScope: string;
  projectVersion: string;
  projectDir: string;
  styleProfile?: StyleScopeProfile;
  routeKey: string;
  routeFilePaths: string[];
  files: readonly SourceFileLike[];
  developmentMode: boolean;
}

interface ProjectCandidateOptions {
  projectScope: string;
  projectVersion: string;
  projectDir: string;
  styleProfile?: StyleScopeProfile;
  files: readonly SourceFileLike[];
  developmentMode: boolean;
}

const logger = rendererLogger.component("css-candidate-manifest");
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const DEV_MANIFEST_TTL_MS = 2_000;
const CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES = 200;
const ROUTE_CANDIDATE_CACHE_MAX_ENTRIES = 200;
const CANDIDATE_MANIFEST_CACHE_MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const CANDIDATE_MANIFEST_CACHE_MAX_ENTRY_RETAINED_BYTES = 16 * 1024 * 1024;
const ROUTE_CANDIDATE_CACHE_MAX_RETAINED_BYTES = 8 * 1024 * 1024;
const ROUTE_CANDIDATE_CACHE_MAX_ENTRY_RETAINED_BYTES = 4 * 1024 * 1024;
const MANIFEST_BASE_RETAINED_BYTES = 256;
const ROUTE_BASE_RETAINED_BYTES = 192;
const MAP_ENTRY_RETAINED_BYTES = 48;
const SET_RETAINED_BYTES = 64;
const SET_ENTRY_RETAINED_BYTES = 24;

const manifestCache = new Map<string, CandidateManifest>();
const routeCandidateCache = new Map<string, RouteCandidateCacheEntry>();
let manifestCacheRetainedBytes = 0;
let routeCandidateCacheRetainedBytes = 0;

registerCache("css-candidate-manifests", () => ({
  name: "css-candidate-manifests",
  entries: manifestCache.size,
  maxEntries: CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES,
  estimatedSizeBytes: manifestCacheRetainedBytes,
}));

registerCache("css-route-candidates", () => ({
  name: "css-route-candidates",
  entries: routeCandidateCache.size,
  maxEntries: ROUTE_CANDIDATE_CACHE_MAX_ENTRIES,
  estimatedSizeBytes: routeCandidateCacheRetainedBytes,
}));

export function getCandidateManifestCacheStats(): {
  manifests: {
    entries: number;
    maxEntries: number;
    estimatedSizeBytes: number;
    maxSizeBytes: number;
    maxEntrySizeBytes: number;
  };
  routeCandidates: {
    entries: number;
    maxEntries: number;
    estimatedSizeBytes: number;
    maxSizeBytes: number;
    maxEntrySizeBytes: number;
  };
} {
  return {
    manifests: {
      entries: manifestCache.size,
      maxEntries: CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES,
      estimatedSizeBytes: manifestCacheRetainedBytes,
      maxSizeBytes: CANDIDATE_MANIFEST_CACHE_MAX_RETAINED_BYTES,
      maxEntrySizeBytes: CANDIDATE_MANIFEST_CACHE_MAX_ENTRY_RETAINED_BYTES,
    },
    routeCandidates: {
      entries: routeCandidateCache.size,
      maxEntries: ROUTE_CANDIDATE_CACHE_MAX_ENTRIES,
      estimatedSizeBytes: routeCandidateCacheRetainedBytes,
      maxSizeBytes: ROUTE_CANDIDATE_CACHE_MAX_RETAINED_BYTES,
      maxEntrySizeBytes: ROUTE_CANDIDATE_CACHE_MAX_ENTRY_RETAINED_BYTES,
    },
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function toRelativeProjectPath(path: string, projectDir: string): string {
  const admittedPath = assertBoundedPathString(path, "CSS candidate path");
  return toCanonicalProjectRelativePath(
    projectDir,
    normalizePath(admittedPath),
    "CSS candidate path",
  );
}

function resolveCandidateProjectRoot(projectDir: string): string {
  const admittedProjectDir = assertBoundedPathString(
    projectDir,
    "CSS candidate project directory",
  );
  if (!isAbsolute(admittedProjectDir)) {
    throw new TypeError("CSS candidate project directory must be absolute");
  }
  return resolve(admittedProjectDir);
}

function buildManifestCacheKey(
  projectScope: string,
  projectVersion: string,
  styleProfileHash?: string,
): string {
  const admittedProjectScope = assertBoundedPathString(
    projectScope,
    "CSS candidate project scope",
  );
  const admittedProjectVersion = assertBoundedPathString(
    projectVersion,
    "CSS candidate project version",
  );
  return JSON.stringify([
    admittedProjectScope,
    admittedProjectVersion,
    styleProfileHash === undefined ? null : assertStyleProfileHash(styleProfileHash),
  ]);
}

function buildRouteCacheKey(manifestKey: string, routeKey: string): string {
  const admittedRouteKey = assertBoundedPathString(routeKey, "CSS candidate route key");
  return JSON.stringify([manifestKey, admittedRouteKey]);
}

function shouldRebuildManifest(
  existing: CandidateManifest | undefined,
  developmentMode: boolean,
): boolean {
  if (!existing) return true;
  if (!developmentMode) return false;
  return (Date.now() - existing.builtAt) > DEV_MANIFEST_TTL_MS;
}

function buildSourceCandidatePaths(modulePath: string): string[] {
  const admittedModulePath = assertBoundedPathString(
    modulePath,
    "CSS route module path",
  );
  const normalized = normalizePath(admittedModulePath).replace(/^\/+/, "").replace(
    /^_vf_modules\//,
    "",
  );
  if (!normalized.endsWith(".js")) return [normalized];
  const withoutJs = normalized.slice(0, -3);
  return [
    `${withoutJs}.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.jsx`,
    `${withoutJs}.mdx`,
    `${withoutJs}.js`,
  ];
}

function buildCandidateManifest(
  projectScope: string,
  files: SourceFileLike[],
  projectDir: string,
): CandidateManifest {
  const fileCandidates = new Map<string, Set<string>>();
  const allCandidates = new Set<string>();
  let sourceBytes = 0;
  let retainedCandidateEntries = 0;
  let retainedBytes = MANIFEST_BASE_RETAINED_BYTES + SET_RETAINED_BYTES +
    estimateRetainedStringBytes(projectScope);

  for (const file of files) {
    const path = assertBoundedPathString(file.path, "CSS candidate source path");
    if (file.content === undefined) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;

    const extracted = extractCandidatesWithByteLength(
      file.content,
      `CSS candidate source ${path}`,
    );
    if (extracted.sourceBytes > MAX_CSS_TOTAL_BYTES - sourceBytes) {
      throw new TypeError(`CSS candidate sources exceed ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    sourceBytes += extracted.sourceBytes;

    if (extracted.candidates.length > MAX_CSS_SELECTOR_TOKENS - retainedCandidateEntries) {
      throw new TypeError(
        `CSS candidate manifest cannot retain more than ${MAX_CSS_SELECTOR_TOKENS} candidates`,
      );
    }
    const candidates = new Set(extracted.candidates);
    retainedCandidateEntries += candidates.size;
    const relativePath = toRelativeProjectPath(path, projectDir);
    const resolvedAbsolutePath = normalizePath(
      resolveCanonicalProjectRelativePath(
        projectDir,
        relativePath,
        "CSS candidate source path",
      ),
    );
    const absolutePath = resolvedAbsolutePath === relativePath
      ? relativePath
      : resolvedAbsolutePath;

    retainedBytes += SET_RETAINED_BYTES + 2 * MAP_ENTRY_RETAINED_BYTES +
      estimateRetainedStringBytes(relativePath) + estimateRetainedStringBytes(absolutePath) +
      candidates.size * SET_ENTRY_RETAINED_BYTES;

    fileCandidates.set(relativePath, candidates);
    fileCandidates.set(absolutePath, candidates);

    for (const cls of candidates) {
      if (!allCandidates.has(cls) && allCandidates.size >= MAX_CSS_SELECTOR_TOKENS) {
        throw new TypeError(
          `CSS candidate manifest cannot retain more than ${MAX_CSS_SELECTOR_TOKENS} candidates`,
        );
      }
      if (!allCandidates.has(cls)) {
        retainedBytes += SET_ENTRY_RETAINED_BYTES + estimateRetainedStringBytes(cls);
      }
      allCandidates.add(cls);
    }
  }

  return {
    projectScope,
    fileCandidates,
    allCandidates,
    builtAt: Date.now(),
    retainedBytes,
  };
}

function detachCandidateManifest(manifest: CandidateManifest): CandidateManifest {
  const retainedCandidates = new Map<string, string>();
  const retainedSets = new Map<Set<string>, Set<string>>();
  const detachCandidate = (candidate: string): string => {
    const existing = retainedCandidates.get(candidate);
    if (existing !== undefined) return existing;
    const retained = detachRetainedString(candidate);
    retainedCandidates.set(retained, retained);
    return retained;
  };

  const fileCandidates = new Map<string, Set<string>>();
  for (const [path, candidates] of manifest.fileCandidates) {
    let retainedSet = retainedSets.get(candidates);
    if (retainedSet === undefined) {
      retainedSet = new Set<string>();
      for (const candidate of candidates) retainedSet.add(detachCandidate(candidate));
      retainedSets.set(candidates, retainedSet);
    }
    fileCandidates.set(detachRetainedString(path), retainedSet);
  }

  const allCandidates = new Set<string>();
  for (const candidate of manifest.allCandidates) {
    allCandidates.add(detachCandidate(candidate));
  }
  return {
    projectScope: detachRetainedString(manifest.projectScope),
    fileCandidates,
    allCandidates,
    builtAt: manifest.builtAt,
    retainedBytes: manifest.retainedBytes,
  };
}

function snapshotDenseDataArray(
  value: unknown,
  label: string,
  maximumEntries: number,
): unknown[] {
  if (isProxyWithoutHooks(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumEntries) {
    throw new TypeError(`${label} cannot exceed ${maximumEntries} entries`);
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    throw new TypeError(`${label} must be a dense data-property array`);
  }

  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
    snapshot[index] = descriptor.value;
  }

  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
  }

  return snapshot;
}

function snapshotCandidateSourceFiles(
  value: unknown,
  projectDir: string,
): SourceFileLike[] {
  const entries = snapshotDenseDataArray(
    value,
    "CSS candidate manifest source files",
    MAX_CSS_FILES,
  );
  const snapshot = new Array<SourceFileLike>(entries.length);
  const seenCanonicalPaths = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const file = entries[index];
    if (isProxyWithoutHooks(file)) {
      throw new TypeError("CSS candidate manifest source entries must not be a Proxy");
    }
    if (
      typeof file !== "object" ||
      file === null ||
      Array.isArray(file)
    ) {
      throw new TypeError(
        "CSS candidate manifest source entries must be non-Proxy objects with path/content data properties",
      );
    }
    const keys = Reflect.ownKeys(file);
    for (const key of keys) {
      if (key !== "path" && key !== "content") {
        throw new TypeError(
          "CSS candidate manifest source entries must contain only path/content data properties",
        );
      }
    }
    const pathDescriptor = Object.getOwnPropertyDescriptor(file, "path");
    const contentDescriptor = Object.getOwnPropertyDescriptor(file, "content");
    if (
      pathDescriptor === undefined ||
      !("value" in pathDescriptor) ||
      typeof pathDescriptor.value !== "string" ||
      (contentDescriptor !== undefined &&
        (!("value" in contentDescriptor) ||
          (contentDescriptor.value !== undefined &&
            typeof contentDescriptor.value !== "string")))
    ) {
      throw new TypeError(
        "CSS candidate manifest source entries must expose path/content as data properties",
      );
    }
    const path = pathDescriptor.value;
    const canonicalPath = toRelativeProjectPath(path, projectDir);
    if (seenCanonicalPaths.has(canonicalPath)) {
      throw new TypeError(
        `CSS candidate manifest source files contain a duplicate canonical path: ${canonicalPath}`,
      );
    }
    seenCanonicalPaths.add(canonicalPath);
    snapshot[index] = Object.freeze(Object.assign(Object.create(null), {
      path,
      content: contentDescriptor === undefined ? undefined : contentDescriptor.value,
    })) as SourceFileLike;
  }
  return Object.freeze(snapshot) as SourceFileLike[];
}

function snapshotRouteFilePaths(
  value: unknown,
  projectDir: string,
): string[] {
  const entries = snapshotDenseDataArray(
    value,
    "CSS route file paths",
    MAX_CSS_FILES,
  );
  const snapshot = new Array<string>(entries.length);
  for (let index = 0; index < entries.length; index++) {
    const path = assertBoundedPathString(entries[index], "CSS route file path");
    toRelativeProjectPath(path, projectDir);
    snapshot[index] = path;
  }
  return Object.freeze(snapshot) as string[];
}

function deleteRouteEntriesForManifest(manifestKey: string): void {
  for (const [routeKey, entry] of routeCandidateCache) {
    if (entry.manifestKey === manifestKey) deleteRouteCandidateCacheEntry(routeKey);
  }
}

function deleteRouteCandidateCacheEntry(routeCacheKey: string): boolean {
  const existing = routeCandidateCache.get(routeCacheKey);
  if (!existing) return false;
  routeCandidateCache.delete(routeCacheKey);
  routeCandidateCacheRetainedBytes -= existing.retainedBytes;
  return true;
}

function deleteManifestCacheEntry(manifestKey: string): boolean {
  const existing = manifestCache.get(manifestKey);
  if (!existing) return false;
  manifestCache.delete(manifestKey);
  manifestCacheRetainedBytes -= existing.retainedBytes + MAP_ENTRY_RETAINED_BYTES +
    estimateRetainedStringBytes(manifestKey);
  return true;
}

function touchManifest(manifestKey: string, manifest: CandidateManifest): void {
  if (!manifestCache.has(manifestKey)) return;
  manifestCache.delete(manifestKey);
  manifestCache.set(manifestKey, manifest);
}

function cacheManifest(
  manifestKey: string,
  manifest: CandidateManifest,
): CandidateManifest | undefined {
  const retainedBytes = manifest.retainedBytes + MAP_ENTRY_RETAINED_BYTES +
    estimateRetainedStringBytes(manifestKey);
  deleteManifestCacheEntry(manifestKey);
  if (
    retainedBytes > CANDIDATE_MANIFEST_CACHE_MAX_ENTRY_RETAINED_BYTES ||
    retainedBytes > CANDIDATE_MANIFEST_CACHE_MAX_RETAINED_BYTES
  ) return undefined;

  while (
    manifestCache.size >= CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES ||
    manifestCacheRetainedBytes > CANDIDATE_MANIFEST_CACHE_MAX_RETAINED_BYTES - retainedBytes
  ) {
    const oldest = manifestCache.keys().next();
    if (oldest.done) break;
    const oldestKey = oldest.value;
    deleteManifestCacheEntry(oldestKey);
    deleteRouteEntriesForManifest(oldestKey);
  }
  if (
    manifestCache.size >= CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES ||
    manifestCacheRetainedBytes > CANDIDATE_MANIFEST_CACHE_MAX_RETAINED_BYTES - retainedBytes
  ) return undefined;
  const retainedManifestKey = detachRetainedString(manifestKey);
  const retainedManifest = detachCandidateManifest(manifest);
  manifestCache.set(retainedManifestKey, retainedManifest);
  manifestCacheRetainedBytes += retainedBytes;
  return retainedManifest;
}

function estimateRouteCandidateCacheEntryRetainedBytes(
  routeCacheKey: string,
  entry: Omit<RouteCandidateCacheEntry, "retainedBytes">,
): number {
  let retainedBytes = ROUTE_BASE_RETAINED_BYTES + SET_RETAINED_BYTES +
    estimateRetainedStringBytes(routeCacheKey) + estimateRetainedStringBytes(entry.manifestKey) +
    estimateRetainedStringBytes(entry.projectScope);
  for (const candidate of entry.candidates) {
    retainedBytes += SET_ENTRY_RETAINED_BYTES + estimateRetainedStringBytes(candidate);
  }
  return retainedBytes;
}

function touchRouteCandidates(
  routeCacheKey: string,
  entry: RouteCandidateCacheEntry,
): void {
  routeCandidateCache.delete(routeCacheKey);
  routeCandidateCache.set(routeCacheKey, entry);
}

function cacheRouteCandidates(
  routeCacheKey: string,
  entry: Omit<RouteCandidateCacheEntry, "retainedBytes">,
): RouteCandidateCacheEntry | undefined {
  const retainedBytes = estimateRouteCandidateCacheEntryRetainedBytes(routeCacheKey, entry);
  deleteRouteCandidateCacheEntry(routeCacheKey);
  if (
    retainedBytes > ROUTE_CANDIDATE_CACHE_MAX_ENTRY_RETAINED_BYTES ||
    retainedBytes > ROUTE_CANDIDATE_CACHE_MAX_RETAINED_BYTES
  ) return undefined;

  while (
    routeCandidateCache.size >= ROUTE_CANDIDATE_CACHE_MAX_ENTRIES ||
    routeCandidateCacheRetainedBytes > ROUTE_CANDIDATE_CACHE_MAX_RETAINED_BYTES - retainedBytes
  ) {
    const oldest = routeCandidateCache.keys().next();
    if (oldest.done) break;
    deleteRouteCandidateCacheEntry(oldest.value);
  }
  if (
    routeCandidateCache.size >= ROUTE_CANDIDATE_CACHE_MAX_ENTRIES ||
    routeCandidateCacheRetainedBytes > ROUTE_CANDIDATE_CACHE_MAX_RETAINED_BYTES - retainedBytes
  ) return undefined;
  const retainedCandidates = new Set<string>();
  for (const candidate of entry.candidates) {
    retainedCandidates.add(detachRetainedString(candidate));
  }
  const retainedEntry: RouteCandidateCacheEntry = {
    manifestKey: detachRetainedString(entry.manifestKey),
    projectScope: detachRetainedString(entry.projectScope),
    candidates: retainedCandidates,
    retainedBytes,
  };
  routeCandidateCache.set(detachRetainedString(routeCacheKey), retainedEntry);
  routeCandidateCacheRetainedBytes += retainedBytes;
  return retainedEntry;
}

function getOrBuildManifest(
  options: Pick<
    ProjectCandidateOptions,
    "projectScope" | "projectVersion" | "projectDir" | "files" | "developmentMode" | "styleProfile"
  >,
): CandidateManifestResolution {
  const projectDir = resolveCandidateProjectRoot(options.projectDir);
  const manifestKey = buildManifestCacheKey(
    options.projectScope,
    options.projectVersion,
    options.styleProfile?.hash,
  );
  const existingManifest = manifestCache.get(manifestKey);
  // Snapshot before style-scope filtering so live arrays, accessors, or
  // provider mutation cannot change the admitted manifest input mid-build.
  const sourceFiles = snapshotCandidateSourceFiles(options.files, projectDir);
  const scopedFiles = options.styleProfile
    ? filterFilesForStyleScope(sourceFiles, options.styleProfile, projectDir)
    : sourceFiles;
  const manifest = shouldRebuildManifest(existingManifest, options.developmentMode)
    ? buildCandidateManifest(options.projectScope, scopedFiles, projectDir)
    : existingManifest!;

  if (manifest !== existingManifest) {
    deleteRouteEntriesForManifest(manifestKey);
    const retainedManifest = cacheManifest(manifestKey, manifest);
    return {
      manifestKey,
      manifest: retainedManifest ?? manifest,
      cacheOwned: retainedManifest !== undefined,
    };
  } else {
    touchManifest(manifestKey, manifest);
  }

  return { manifestKey, manifest, cacheOwned: true };
}

function addCandidatesForPath(
  target: Set<string>,
  manifest: CandidateManifest,
  path: string,
  projectDir: string,
): boolean {
  const absolutePath = normalizePath(path);
  const relativePath = toRelativeProjectPath(path, projectDir);
  const candidates = manifest.fileCandidates.get(absolutePath) ??
    manifest.fileCandidates.get(relativePath);
  if (!candidates) return false;
  for (const cls of candidates) target.add(cls);
  return true;
}

/**
 * Resolve route-scoped CSS candidates from a precomputed per-project manifest.
 */
export function getRouteCandidates(options: RouteCandidateOptions): Set<string> {
  const routeKey = assertBoundedPathString(options.routeKey, "CSS candidate route key");
  const projectDir = resolveCandidateProjectRoot(options.projectDir);
  const routeFilePaths = snapshotRouteFilePaths(options.routeFilePaths, projectDir);
  const { manifestKey, manifest } = getOrBuildManifest(options);
  const routeCacheKey = buildRouteCacheKey(manifestKey, routeKey);
  const cachedRoute = routeCandidateCache.get(routeCacheKey);
  if (cachedRoute) {
    touchRouteCandidates(routeCacheKey, cachedRoute);
    return new Set(cachedRoute.candidates);
  }

  const routeCandidates = new Set<string>();
  let matchedRouteSource = false;

  for (const path of routeFilePaths) {
    if (addCandidatesForPath(routeCandidates, manifest, path, projectDir)) {
      matchedRouteSource = true;
    }
  }

  for (const modulePath of getRouteModulePaths(options.projectScope, routeKey)) {
    for (const sourcePath of buildSourceCandidatePaths(modulePath)) {
      if (addCandidatesForPath(routeCandidates, manifest, sourcePath, projectDir)) {
        matchedRouteSource = true;
      }
    }
  }

  let usedFullProjectFallback = false;

  // Fallback to full-project candidates for correctness if route manifest is incomplete.
  if (!matchedRouteSource) {
    usedFullProjectFallback = true;
    for (const cls of manifest.allCandidates) routeCandidates.add(cls);
  }

  let cachedRouteEntry: RouteCandidateCacheEntry | undefined;
  if (!usedFullProjectFallback) {
    cachedRouteEntry = cacheRouteCandidates(routeCacheKey, {
      manifestKey,
      projectScope: manifest.projectScope,
      candidates: routeCandidates,
    });
  }

  logger.debug("Resolved route candidates", {
    projectScope: options.projectScope,
    projectVersion: options.projectVersion,
    styleProfileHash: options.styleProfile?.hash,
    route: routeKey,
    count: routeCandidates.size,
  });

  return cachedRouteEntry === undefined ? routeCandidates : new Set(cachedRouteEntry.candidates);
}

/**
 * Resolve full-project CSS candidates from a precomputed per-project manifest.
 */
export function getProjectCandidates(options: ProjectCandidateOptions): Set<string> {
  const { manifest, cacheOwned } = getOrBuildManifest(options);
  return cacheOwned ? new Set(manifest.allCandidates) : manifest.allCandidates;
}

/**
 * Invalidate cached candidate manifests for one project scope (or all scopes).
 */
export function invalidateProjectCandidateManifests(projectScope?: string): void {
  if (!projectScope) {
    manifestCache.clear();
    routeCandidateCache.clear();
    manifestCacheRetainedBytes = 0;
    routeCandidateCacheRetainedBytes = 0;
    return;
  }

  for (const [key, manifest] of manifestCache) {
    if (manifest.projectScope !== projectScope) continue;
    deleteManifestCacheEntry(key);
    deleteRouteEntriesForManifest(key);
  }

  for (const [key, entry] of routeCandidateCache) {
    if (entry.projectScope === projectScope) deleteRouteCandidateCacheEntry(key);
  }
}
