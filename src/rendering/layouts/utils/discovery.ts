import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "#veryfront/types";
import { dirname, extname, isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { LAYOUT_EXTENSIONS } from "../types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";

const discoveryLog = logger.component("discovery");

interface CacheEntry {
  layouts: LayoutItem[];
  accessedAt: number;
  projectDir: string;
}

const MAX_CACHE_SIZE = 500;
const layoutDiscoveryCache = new LRUCache<string, CacheEntry>({
  maxEntries: MAX_CACHE_SIZE,
});

// Register cache for monitoring and bulk clearing
registerLRUCache("layout-discovery-cache", layoutDiscoveryCache);

export function clearLayoutDiscoveryCache(projectDir?: string): void {
  if (!projectDir) {
    discoveryLog.debug("Clearing entire layout discovery cache", {
      size: layoutDiscoveryCache.size,
    });
    layoutDiscoveryCache.clear();
    return;
  }

  let cleared = 0;
  for (const key of [...layoutDiscoveryCache.keys()]) {
    const entry = layoutDiscoveryCache.get(key);
    if (entry && entry.projectDir === projectDir) {
      layoutDiscoveryCache.delete(key);
      cleared++;
    }
  }

  discoveryLog.debug("Cleared layout discovery cache for project", {
    cleared,
    remaining: layoutDiscoveryCache.size,
  });
}

registerProcessStateReset("layout discovery", clearLayoutDiscoveryCache);

export function getLayoutDiscoveryCacheStats(): { size: number; maxSize: number } {
  return { size: layoutDiscoveryCache.size, maxSize: MAX_CACHE_SIZE };
}

export async function discoverNestedLayouts(
  pageFilePath: string,
  rootDir: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  cacheScope = projectDir,
): Promise<LayoutItem[]> {
  const key = JSON.stringify([cacheScope, projectDir, pageFilePath, rootDir]);
  const cached = layoutDiscoveryCache.get(key);
  if (cached) {
    cached.accessedAt = Date.now();
    discoveryLog.debug("Layout cache HIT", {
      layoutCount: cached.layouts.length,
    });
    return cloneLayouts(cached.layouts);
  }

  discoveryLog.debug("Layout cache MISS, discovering layouts");

  const layouts = await discoverNestedLayoutsImpl(pageFilePath, rootDir, adapter);

  discoveryLog.debug("Found layouts", {
    layoutCount: layouts.length,
  });

  layoutDiscoveryCache.set(key, {
    layouts: cloneLayouts(layouts),
    accessedAt: Date.now(),
    projectDir,
  });

  return cloneLayouts(layouts);
}

async function discoverNestedLayoutsImpl(
  pageFilePath: string,
  rootDir: string,
  adapter: RuntimeAdapter,
): Promise<LayoutItem[]> {
  if (!isPathWithinRoot(pageFilePath, rootDir)) return [];
  const candidates = collectLayoutCandidates(pageFilePath, rootDir);
  const existing = await resolveExistingFiles(candidates, rootDir, adapter);
  const nestedLayouts: LayoutItem[] = [];
  addLayoutsFromFiles(existing, nestedLayouts);
  return nestedLayouts;
}

function collectLayoutCandidates(pageFilePath: string, rootDir: string): string[] {
  const directories: string[] = [];
  let currentDir = dirname(pageFilePath);

  while (isPathWithinRoot(currentDir, rootDir)) {
    directories.push(currentDir);
    const parent = dirname(currentDir);
    if (parent === currentDir || currentDir === rootDir) break;
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
  rootDir: string,
  adapter: RuntimeAdapter,
): Promise<string[]> {
  const existing: string[] = [];
  const seenDirs = new Set<string>();

  for (const candidate of candidates) {
    const dir = dirname(candidate);
    if (seenDirs.has(dir)) continue;
    let stat;
    try {
      stat = await adapter.fs.stat(candidate);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
    if (!stat.isFile || stat.isSymlink) continue;
    if (!await isCanonicalCandidateWithinRoot(candidate, rootDir, adapter)) continue;

    existing.push(candidate);
    seenDirs.add(dir);
  }

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
      nestedLayouts.push({
        kind: "tsx",
        component: undefined,
        componentPath: file,
        path: file,
      });
    }
  }
}

function isPathWithinRoot(path: string, rootDir: string): boolean {
  const relativePath = relative(normalize(rootDir), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

async function isCanonicalCandidateWithinRoot(
  candidate: string,
  rootDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (adapter.fs.lstat) {
    try {
      if ((await adapter.fs.lstat(candidate)).isSymlink) return false;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }
  if (!adapter.fs.realPath) return true;

  try {
    const [canonicalCandidate, canonicalRoot] = await Promise.all([
      adapter.fs.realPath(candidate),
      adapter.fs.realPath(rootDir),
    ]);
    return isPathWithinRoot(canonicalCandidate, canonicalRoot);
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function cloneLayouts(layouts: readonly LayoutItem[]): LayoutItem[] {
  return layouts.map((layout) => ({ ...layout }));
}
