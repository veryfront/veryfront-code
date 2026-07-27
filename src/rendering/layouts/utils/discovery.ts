import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "#veryfront/types";
import { dirname, extname, isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { LAYOUT_EXTENSIONS } from "../types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const discoveryLog = logger.component("discovery");

interface CacheEntry {
  layouts: readonly Readonly<LayoutItem>[];
  projectDir: string;
}

const MAX_CACHE_SIZE = 500;
const MAX_LAYOUT_ANCESTOR_DIRECTORIES = 256;
const layoutDiscoveryCache = new LRUCache<string, CacheEntry>({
  maxEntries: MAX_CACHE_SIZE,
});
const adapterCacheIds = new WeakMap<RuntimeAdapter, number>();
let nextAdapterCacheId = 1;
let cacheGeneration = 0;

function normalizeDirectoryPath(path: string): string {
  return normalize(join(path, "."));
}

// Register cache for monitoring and bulk clearing
registerLRUCache("layout-discovery-cache", layoutDiscoveryCache);

export function clearLayoutDiscoveryCache(projectDir?: string): void {
  cacheGeneration++;
  if (!projectDir) {
    discoveryLog.debug("Clearing entire layout discovery cache", {
      size: layoutDiscoveryCache.size,
    });
    layoutDiscoveryCache.clear();
    return;
  }

  const normalizedProjectDir = normalizeDirectoryPath(projectDir);
  let cleared = 0;
  for (const key of [...layoutDiscoveryCache.keys()]) {
    const entry = layoutDiscoveryCache.get(key);
    if (entry && entry.projectDir === normalizedProjectDir) {
      layoutDiscoveryCache.delete(key);
      cleared++;
    }
  }

  discoveryLog.debug("Cleared layout discovery cache for project", {
    projectDir,
    cleared,
    remaining: layoutDiscoveryCache.size,
  });
}

export function getLayoutDiscoveryCacheStats(): { size: number; maxSize: number } {
  return { size: layoutDiscoveryCache.size, maxSize: MAX_CACHE_SIZE };
}

export interface LayoutDiscoveryOptions {
  /**
   * Stable content identity for adapters that can expose multiple snapshots
   * through the same object. Distinct adapter instances are isolated even when
   * this is omitted.
   */
  cacheScope?: string;
}

export async function discoverNestedLayouts(
  pageFilePath: string,
  rootDir: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options: LayoutDiscoveryOptions = {},
): Promise<LayoutItem[]> {
  const normalizedPagePath = normalize(pageFilePath);
  const normalizedRootDir = normalizeDirectoryPath(rootDir);
  const normalizedProjectDir = normalizeDirectoryPath(projectDir);

  // The tuple is collision-free for string inputs. A short non-cryptographic
  // digest is not sufficient here: a collision can cross project boundaries.
  const key = JSON.stringify([
    options.cacheScope ?? `adapter:${getAdapterCacheId(adapter)}`,
    normalizedProjectDir,
    normalizedPagePath,
    normalizedRootDir,
  ]);
  const cached = layoutDiscoveryCache.get(key);
  if (cached) {
    discoveryLog.debug("Layout cache HIT", {
      pageFilePath: normalizedPagePath,
      rootDir: normalizedRootDir,
      layoutCount: cached.layouts.length,
      layoutPaths: cached.layouts.map((l) => l.path),
    });
    return cloneLayouts(cached.layouts);
  }

  discoveryLog.debug("Layout cache MISS, discovering layouts", {
    pageFilePath: normalizedPagePath,
    rootDir: normalizedRootDir,
    projectDir: normalizedProjectDir,
  });

  const generation = cacheGeneration;
  const layouts = await discoverNestedLayoutsImpl(
    normalizedPagePath,
    normalizedRootDir,
    adapter,
  );

  discoveryLog.debug("Found layouts", {
    pageFilePath: normalizedPagePath,
    layoutCount: layouts.length,
    layoutPaths: layouts.map((l) => l.path),
  });

  const snapshot = snapshotLayouts(layouts);
  if (generation === cacheGeneration) {
    layoutDiscoveryCache.set(key, {
      layouts: snapshot,
      projectDir: normalizedProjectDir,
    });
  }

  return cloneLayouts(snapshot);
}

async function discoverNestedLayoutsImpl(
  pageFilePath: string,
  rootDir: string,
  adapter: RuntimeAdapter,
): Promise<LayoutItem[]> {
  if (!isSameOrDescendant(rootDir, pageFilePath)) return [];

  const nestedLayouts: LayoutItem[] = [];
  const candidates = collectLayoutCandidates(pageFilePath, rootDir);
  const existing = await resolveExistingFiles(candidates, adapter);

  logger.debug("Found layout files:", existing);
  addLayoutsFromFiles(existing, nestedLayouts);

  return nestedLayouts;
}

function collectLayoutCandidates(pageFilePath: string, rootDir: string): string[] {
  const directories: string[] = [];
  let currentDir = dirname(pageFilePath);

  while (isSameOrDescendant(rootDir, currentDir)) {
    if (directories.length >= MAX_LAYOUT_ANCESTOR_DIRECTORIES) {
      throw new RangeError(
        `Layout discovery ancestor limit of ${MAX_LAYOUT_ANCESTOR_DIRECTORIES} was exceeded`,
      );
    }
    directories.push(currentDir);

    if (currentDir === rootDir) break;
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  const candidates: string[] = [];
  for (const directory of directories.reverse()) {
    for (const ext of LAYOUT_EXTENSIONS) {
      candidates.push(join(directory, `layout.${ext}`));
    }
  }

  return candidates;
}

async function resolveExistingFiles(
  candidates: string[],
  adapter: RuntimeAdapter,
): Promise<string[]> {
  const results = await Promise.allSettled(candidates.map((file) => adapter.fs.stat(file)));

  const existing: string[] = [];
  const seenDirs = new Set<string>();
  let operationalFailure: unknown;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue;

    if (result.status === "fulfilled" && result.value.isFile) {
      const candidatePath = candidates[i];
      if (!candidatePath) continue;

      const dir = dirname(candidatePath);
      if (seenDirs.has(dir)) continue;

      existing.push(candidatePath);
      seenDirs.add(dir);
      continue;
    }

    if (result.status === "rejected") {
      if (isNotFoundError(result.reason)) continue;
      operationalFailure ??= result.reason;
    }
  }

  if (operationalFailure !== undefined) throw operationalFailure;
  return existing;
}

function addLayoutsFromFiles(files: string[], nestedLayouts: LayoutItem[]): void {
  for (const file of files) {
    const ext = extname(file).toLowerCase();

    if (ext === ".mdx" || ext === ".md") {
      nestedLayouts.push({ kind: "mdx", path: file });
      continue;
    }

    if (ext === ".tsx" || ext === ".jsx" || ext === ".ts" || ext === ".js") {
      logger.debug("Adding TSX layout:", file);
      nestedLayouts.push({
        kind: "tsx",
        component: undefined,
        componentPath: file,
        path: file,
      });
    }
  }
}

function isSameOrDescendant(rootDir: string, path: string): boolean {
  const relativePath = relative(rootDir, path).replaceAll("\\", "/");
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !isAbsolute(relativePath));
}

function getAdapterCacheId(adapter: RuntimeAdapter): number {
  const existing = adapterCacheIds.get(adapter);
  if (existing !== undefined) return existing;

  const id = nextAdapterCacheId;
  nextAdapterCacheId += 1;
  adapterCacheIds.set(adapter, id);
  return id;
}

function cloneLayout(layout: Readonly<LayoutItem>): LayoutItem {
  if (layout.kind === "mdx") {
    const clone: LayoutItem = {
      kind: "mdx",
      path: layout.path,
    };
    if (layout.bundle !== undefined) clone.bundle = layout.bundle;
    return clone;
  }

  return {
    kind: "tsx",
    component: layout.component,
    componentPath: layout.componentPath,
    path: layout.path,
  };
}

function cloneLayouts(layouts: readonly Readonly<LayoutItem>[]): LayoutItem[] {
  return layouts.map(cloneLayout);
}

function snapshotLayouts(layouts: readonly LayoutItem[]): readonly Readonly<LayoutItem>[] {
  return Object.freeze(layouts.map((layout) => Object.freeze(cloneLayout(layout))));
}
