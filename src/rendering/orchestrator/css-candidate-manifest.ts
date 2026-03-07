import { extractCandidates } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { getRouteModulePaths } from "#veryfront/modules/manifest/route-module-manifest.ts";
import { rendererLogger } from "#veryfront/utils";

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
  projectVersion: string;
  projectDir: string;
  routeKey: string;
  routeFilePaths: string[];
  files: SourceFileLike[];
  developmentMode: boolean;
}

const logger = rendererLogger.component("css-candidate-manifest");
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const DEV_MANIFEST_TTL_MS = 2_000;

const manifestCache = new Map<string, CandidateManifest>();
const routeCandidateCache = new Map<string, Set<string>>();

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

function buildManifestCacheKey(projectScope: string, projectVersion: string): string {
  return `${projectScope}:${projectVersion}`;
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

    const candidates = new Set(extractCandidates(file.content));
    const relativePath = toRelativeProjectPath(file.path, projectDir);
    const absolutePath = normalizePath(file.path);

    fileCandidates.set(relativePath, candidates);
    fileCandidates.set(absolutePath, candidates);

    for (const cls of candidates) allCandidates.add(cls);
  }

  return { fileCandidates, allCandidates, builtAt: Date.now() };
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
  const manifestKey = buildManifestCacheKey(options.projectScope, options.projectVersion);
  const existingManifest = manifestCache.get(manifestKey);
  const manifest = shouldRebuildManifest(existingManifest, options.developmentMode)
    ? buildCandidateManifest(options.files, options.projectDir)
    : existingManifest!;

  if (manifest !== existingManifest) {
    manifestCache.set(manifestKey, manifest);

    // Clear route subsets when project-level file manifest is rebuilt.
    for (const key of routeCandidateCache.keys()) {
      if (key.startsWith(`${manifestKey}:`)) routeCandidateCache.delete(key);
    }
  }

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

  // Fallback to full-project candidates for correctness if route manifest is incomplete.
  if (routeCandidates.size === 0) {
    for (const cls of manifest.allCandidates) routeCandidates.add(cls);
  }

  routeCandidateCache.set(routeCacheKey, routeCandidates);

  logger.debug("Resolved route candidates", {
    projectScope: options.projectScope,
    projectVersion: options.projectVersion,
    route: options.routeKey,
    count: routeCandidates.size,
  });

  return new Set(routeCandidates);
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
    if (key.startsWith(`${projectScope}:`)) manifestCache.delete(key);
  }

  for (const key of routeCandidateCache.keys()) {
    if (key.startsWith(`${projectScope}:`)) routeCandidateCache.delete(key);
  }
}
