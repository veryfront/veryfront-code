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
  fileCandidates: Map<string, Set<string>>;
  allCandidates: Set<string>;
  builtAt: number;
}

interface RouteCandidateOptions {
  projectScope: string;
  projectPartition?: string;
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
  projectPartition?: string;
  projectVersion: string;
  projectDir: string;
  styleProfile?: StyleScopeProfile;
  files: SourceFileLike[];
  developmentMode: boolean;
  /** Store a newly built manifest only while its source snapshot is current. */
  shouldCache?: () => boolean;
}

const logger = rendererLogger.component("css-candidate-manifest");
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const DEV_MANIFEST_TTL_MS = 2_000;
const ROUTE_CANDIDATE_CACHE_MAX_ENTRIES = 200;

const manifestCache = new Map<string, CandidateManifest>();
const routeCandidateCache = new Map<string, Set<string>>();

registerCache("css-candidate-manifests", () => ({
  name: "css-candidate-manifests",
  entries: manifestCache.size,
}));

registerCache("css-route-candidates", () => ({
  name: "css-route-candidates",
  entries: routeCandidateCache.size,
  maxEntries: ROUTE_CANDIDATE_CACHE_MAX_ENTRIES,
}));

export function getCandidateManifestCacheStats(): {
  manifests: { entries: number };
  routeCandidates: { entries: number; maxEntries: number };
} {
  return {
    manifests: {
      entries: manifestCache.size,
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

function toDiagnosticProjectPath(path: string, projectDir: string): string {
  const normalized = normalizePath(path);
  const normalizedProjectDir = normalizePath(projectDir).replace(/\/+$/, "");
  if (normalized === normalizedProjectDir) return ".";
  if (normalized.startsWith(`${normalizedProjectDir}/`)) {
    return normalized.slice(normalizedProjectDir.length + 1);
  }
  if (/^(?:[A-Za-z]:)?\//.test(normalized)) {
    return `[outside-project]/${normalized.split("/").pop() ?? "unknown"}`;
  }
  return normalized.replace(/^\/+/, "");
}

function buildManifestCacheKey(
  projectScope: string,
  projectPartition: string,
  projectVersion: string,
  styleProfileHash?: string,
): string {
  return `${projectScope}\u0000${projectPartition}\u0000${projectVersion}\u0000${
    styleProfileHash ?? "default"
  }`;
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

function buildCandidateManifest(files: SourceFileLike[], projectDir: string): CandidateManifest {
  const fileCandidates = new Map<string, Set<string>>();
  const allCandidates = new Set<string>();

  for (const file of files) {
    if (!file.content) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

    // A file the tokenizer refuses to admit (over the byte or candidate-count
    // cap) must degrade to "contributes no candidates", not abort the manifest:
    // an escaping throw here propagates to the SSR boundary and, because it
    // happens before manifestCache.set, is rebuilt and re-thrown on every
    // request to the project (VERYFRONT-SERVER-F).
    let extracted: string[];
    try {
      extracted = extractCandidates(file.content);
    } catch (error) {
      logger.warn("Skipping file rejected by candidate extraction", {
        path: toDiagnosticProjectPath(file.path, projectDir),
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const candidates = new Set(extracted);
    const relativePath = toRelativeProjectPath(file.path, projectDir);
    const absolutePath = normalizePath(file.path);

    fileCandidates.set(relativePath, candidates);
    fileCandidates.set(absolutePath, candidates);

    for (const cls of candidates) allCandidates.add(cls);
  }

  return { fileCandidates, allCandidates, builtAt: Date.now() };
}

function getOrBuildManifest(
  options: Pick<
    ProjectCandidateOptions,
    | "projectScope"
    | "projectPartition"
    | "projectVersion"
    | "projectDir"
    | "files"
    | "developmentMode"
    | "styleProfile"
    | "shouldCache"
  >,
): CandidateManifest {
  const manifestKey = buildManifestCacheKey(
    options.projectScope,
    options.projectPartition ?? options.projectScope,
    options.projectVersion,
    options.styleProfile?.hash,
  );
  const existingManifest = manifestCache.get(manifestKey);
  const scopedFiles = options.styleProfile
    ? filterFilesForStyleScope(options.files, options.styleProfile, options.projectDir)
    : options.files;
  const manifest = shouldRebuildManifest(existingManifest, options.developmentMode)
    ? buildCandidateManifest(scopedFiles, options.projectDir)
    : existingManifest!;

  if (manifest !== existingManifest && (options.shouldCache?.() ?? true)) {
    manifestCache.set(manifestKey, manifest);

    for (const key of routeCandidateCache.keys()) {
      if (key.startsWith(`${manifestKey}:`)) routeCandidateCache.delete(key);
    }
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
    options.projectPartition ?? options.projectScope,
    options.projectVersion,
    options.styleProfile?.hash,
  );
  const manifest = getOrBuildManifest(options);
  const routeCacheKey = `${manifestKey}:${options.routeKey}`;
  const cachedRoute = routeCandidateCache.get(routeCacheKey);
  if (cachedRoute) return new Set(cachedRoute);

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
    if (
      routeCandidateCache.size >= ROUTE_CANDIDATE_CACHE_MAX_ENTRIES &&
      !routeCandidateCache.has(routeCacheKey)
    ) {
      const oldestKey = routeCandidateCache.keys().next().value as string | undefined;
      if (oldestKey) routeCandidateCache.delete(oldestKey);
    }

    routeCandidateCache.set(routeCacheKey, routeCandidates);
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

  for (const key of manifestCache.keys()) {
    if (key.startsWith(`${projectScope}\u0000`)) manifestCache.delete(key);
  }

  for (const key of routeCandidateCache.keys()) {
    if (key.startsWith(`${projectScope}\u0000`)) routeCandidateCache.delete(key);
  }
}
