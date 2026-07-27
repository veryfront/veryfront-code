import { extractCandidates } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import {
  filterFilesForStyleScope,
  type StyleScopeProfile,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { getRouteModulePaths } from "#veryfront/modules/manifest/route-module-manifest.ts";
import { rendererLogger } from "#veryfront/utils";
import { registerCache } from "#veryfront/utils/memory/index.ts";

interface SourceFileLike {
  path: string;
  content?: string;
}

interface CandidateManifest {
  projectScope: string;
  fileCandidates: Map<string, Set<string>>;
  allCandidates: Set<string>;
  builtAt: number;
}

interface RouteCandidateCacheEntry {
  manifestKey: string;
  projectScope: string;
  candidates: Set<string>;
}

interface RouteCandidateOptions {
  projectScope: string;
  projectVersion: string;
  projectDir: string;
  styleProfile?: StyleScopeProfile;
  routeKey: string;
  routeFilePaths: string[];
  files: SourceFileLike[];
  developmentMode: boolean;
}

interface ProjectCandidateOptions {
  projectScope: string;
  projectVersion: string;
  projectDir: string;
  styleProfile?: StyleScopeProfile;
  files: SourceFileLike[];
  developmentMode: boolean;
}

const logger = rendererLogger.component("css-candidate-manifest");
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const DEV_MANIFEST_TTL_MS = 2_000;
const CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES = 200;
const ROUTE_CANDIDATE_CACHE_MAX_ENTRIES = 200;

const manifestCache = new Map<string, CandidateManifest>();
const routeCandidateCache = new Map<string, RouteCandidateCacheEntry>();

registerCache("css-candidate-manifests", () => ({
  name: "css-candidate-manifests",
  entries: manifestCache.size,
  maxEntries: CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES,
}));

registerCache("css-route-candidates", () => ({
  name: "css-route-candidates",
  entries: routeCandidateCache.size,
  maxEntries: ROUTE_CANDIDATE_CACHE_MAX_ENTRIES,
}));

export function getCandidateManifestCacheStats(): {
  manifests: { entries: number; maxEntries: number };
  routeCandidates: { entries: number; maxEntries: number };
} {
  return {
    manifests: {
      entries: manifestCache.size,
      maxEntries: CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES,
    },
    routeCandidates: {
      entries: routeCandidateCache.size,
      maxEntries: ROUTE_CANDIDATE_CACHE_MAX_ENTRIES,
    },
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function toRelativeProjectPath(path: string, projectDir: string): string {
  const normalized = normalizePath(path);
  const normalizedProjectDir = normalizePath(projectDir).replace(/\/+$/, "");
  if (normalized.startsWith(normalizedProjectDir)) {
    return normalized.slice(normalizedProjectDir.length).replace(/^\/+/, "");
  }
  return normalized.replace(/^\/+/, "");
}

function buildManifestCacheKey(
  projectScope: string,
  projectVersion: string,
  styleProfileHash?: string,
): string {
  return JSON.stringify([projectScope, projectVersion, styleProfileHash ?? null]);
}

function buildRouteCacheKey(manifestKey: string, routeKey: string): string {
  return JSON.stringify([manifestKey, routeKey]);
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
  const normalized = normalizePath(modulePath).replace(/^\/+/, "").replace(/^_vf_modules\//, "");
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

  for (const file of files) {
    if (!file.content) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

    const candidates = new Set(extractCandidates(file.content));
    const relativePath = toRelativeProjectPath(file.path, projectDir);
    const absolutePath = normalizePath(file.path);

    fileCandidates.set(relativePath, candidates);
    fileCandidates.set(absolutePath, candidates);

    for (const cls of candidates) allCandidates.add(cls);
  }

  return { projectScope, fileCandidates, allCandidates, builtAt: Date.now() };
}

function deleteRouteEntriesForManifest(manifestKey: string): void {
  for (const [routeKey, entry] of routeCandidateCache) {
    if (entry.manifestKey === manifestKey) routeCandidateCache.delete(routeKey);
  }
}

function touchManifest(manifestKey: string, manifest: CandidateManifest): void {
  manifestCache.delete(manifestKey);
  manifestCache.set(manifestKey, manifest);
}

function cacheManifest(manifestKey: string, manifest: CandidateManifest): void {
  touchManifest(manifestKey, manifest);

  while (manifestCache.size > CANDIDATE_MANIFEST_CACHE_MAX_ENTRIES) {
    const oldestKey = manifestCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    manifestCache.delete(oldestKey);
    deleteRouteEntriesForManifest(oldestKey);
  }
}

function cacheRouteCandidates(
  routeCacheKey: string,
  entry: RouteCandidateCacheEntry,
): void {
  routeCandidateCache.delete(routeCacheKey);
  routeCandidateCache.set(routeCacheKey, entry);

  while (routeCandidateCache.size > ROUTE_CANDIDATE_CACHE_MAX_ENTRIES) {
    const oldestKey = routeCandidateCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    routeCandidateCache.delete(oldestKey);
  }
}

function getOrBuildManifest(
  options: Pick<
    ProjectCandidateOptions,
    "projectScope" | "projectVersion" | "projectDir" | "files" | "developmentMode" | "styleProfile"
  >,
): CandidateManifest {
  const manifestKey = buildManifestCacheKey(
    options.projectScope,
    options.projectVersion,
    options.styleProfile?.hash,
  );
  const existingManifest = manifestCache.get(manifestKey);
  const scopedFiles = options.styleProfile
    ? filterFilesForStyleScope(options.files, options.styleProfile, options.projectDir)
    : options.files;
  const manifest = shouldRebuildManifest(existingManifest, options.developmentMode)
    ? buildCandidateManifest(options.projectScope, scopedFiles, options.projectDir)
    : existingManifest!;

  if (manifest !== existingManifest) {
    deleteRouteEntriesForManifest(manifestKey);
    cacheManifest(manifestKey, manifest);
  } else {
    touchManifest(manifestKey, manifest);
  }

  return manifest;
}

function addCandidatesForPath(
  target: Set<string>,
  manifest: CandidateManifest,
  path: string,
  projectDir: string,
): void {
  const absolutePath = normalizePath(path);
  const relativePath = toRelativeProjectPath(path, projectDir);
  const candidates = manifest.fileCandidates.get(absolutePath) ??
    manifest.fileCandidates.get(relativePath);
  if (!candidates) return;
  for (const cls of candidates) target.add(cls);
}

/**
 * Resolve route-scoped Tailwind candidates from a precomputed per-project manifest.
 */
export function getRouteCandidates(options: RouteCandidateOptions): Set<string> {
  const manifestKey = buildManifestCacheKey(
    options.projectScope,
    options.projectVersion,
    options.styleProfile?.hash,
  );
  const manifest = getOrBuildManifest(options);
  const routeCacheKey = buildRouteCacheKey(manifestKey, options.routeKey);
  const cachedRoute = routeCandidateCache.get(routeCacheKey);
  if (cachedRoute) {
    cacheRouteCandidates(routeCacheKey, cachedRoute);
    return new Set(cachedRoute.candidates);
  }

  const routeCandidates = new Set<string>();

  for (const path of options.routeFilePaths) {
    addCandidatesForPath(routeCandidates, manifest, path, options.projectDir);
  }

  for (const modulePath of getRouteModulePaths(options.projectScope, options.routeKey)) {
    for (const sourcePath of buildSourceCandidatePaths(modulePath)) {
      addCandidatesForPath(routeCandidates, manifest, sourcePath, options.projectDir);
    }
  }

  let usedFullProjectFallback = false;

  // Fallback to full-project candidates for correctness if route manifest is incomplete.
  if (routeCandidates.size === 0) {
    usedFullProjectFallback = true;
    for (const cls of manifest.allCandidates) routeCandidates.add(cls);
  }

  if (!usedFullProjectFallback) {
    cacheRouteCandidates(routeCacheKey, {
      manifestKey,
      projectScope: options.projectScope,
      candidates: routeCandidates,
    });
  }

  logger.debug("Resolved route candidates", {
    projectScope: options.projectScope,
    projectVersion: options.projectVersion,
    styleProfileHash: options.styleProfile?.hash,
    route: options.routeKey,
    count: routeCandidates.size,
  });

  return new Set(routeCandidates);
}

/**
 * Resolve full-project Tailwind candidates from a precomputed per-project manifest.
 */
export function getProjectCandidates(options: ProjectCandidateOptions): Set<string> {
  const manifest = getOrBuildManifest(options);
  return new Set(manifest.allCandidates);
}

/**
 * Invalidate cached candidate manifests for one project scope (or all scopes).
 */
export function invalidateProjectCandidateManifests(projectScope?: string): void {
  if (!projectScope) {
    manifestCache.clear();
    routeCandidateCache.clear();
    return;
  }

  for (const [key, manifest] of manifestCache) {
    if (manifest.projectScope !== projectScope) continue;
    manifestCache.delete(key);
    deleteRouteEntriesForManifest(key);
  }

  for (const [key, entry] of routeCandidateCache) {
    if (entry.projectScope === projectScope) routeCandidateCache.delete(key);
  }
}
