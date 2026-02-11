import { memoizeHash as simpleHash, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "#veryfront/types";
import { dirname, extname, join } from "#veryfront/compat/path";
import { LAYOUT_EXTENSIONS } from "../types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";

const discoveryLog = logger.component("discovery");
const layoutLog = logger.component("layout");

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
    projectDir,
    cleared,
    remaining: layoutDiscoveryCache.size,
  });
}

export function getLayoutDiscoveryCacheStats(): { size: number; maxSize: number } {
  return { size: layoutDiscoveryCache.size, maxSize: MAX_CACHE_SIZE };
}

export async function discoverNestedLayouts(
  pageFilePath: string,
  rootDir: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<LayoutItem[]> {
  const key = simpleHash(projectDir, pageFilePath, rootDir);
  const cached = layoutDiscoveryCache.get(key);
  if (cached) {
    cached.accessedAt = Date.now();
    discoveryLog.info("Layout cache HIT", {
      pageFilePath,
      rootDir,
      layoutCount: cached.layouts.length,
      layoutPaths: cached.layouts.map((l) => l.path),
    });
    return cached.layouts;
  }

  discoveryLog.info("Layout cache MISS, discovering layouts", {
    pageFilePath,
    rootDir,
    projectDir,
  });

  const layouts = await discoverNestedLayoutsImpl(pageFilePath, rootDir, adapter);

  discoveryLog.info("Found layouts", {
    pageFilePath,
    layoutCount: layouts.length,
    layoutPaths: layouts.map((l) => l.path),
  });

  layoutDiscoveryCache.set(key, { layouts, accessedAt: Date.now(), projectDir });

  return layouts;
}

async function discoverNestedLayoutsImpl(
  pageFilePath: string,
  rootDir: string,
  adapter: RuntimeAdapter,
): Promise<LayoutItem[]> {
  const nestedLayouts: LayoutItem[] = [];

  try {
    const candidates = collectLayoutCandidates(pageFilePath, rootDir);
    const existing = await resolveExistingFiles(candidates.reverse(), adapter);

    logger.debug("Found layout files:", existing);
    addLayoutsFromFiles(existing, nestedLayouts);

    await addMissedAncestorLayouts(pageFilePath, rootDir, existing, nestedLayouts, adapter);
  } catch (e) {
    logger.warn("Nested layout discovery failed", e);
  }

  return nestedLayouts;
}

function collectLayoutCandidates(pageFilePath: string, rootDir: string): string[] {
  const candidates: string[] = [];
  let currentDir = dirname(pageFilePath);

  while (currentDir.startsWith(rootDir)) {
    for (const ext of LAYOUT_EXTENSIONS) {
      candidates.push(join(currentDir, `layout.${ext}`));
    }

    const parent = dirname(currentDir);
    if (parent === currentDir || currentDir === rootDir) break;
    currentDir = parent;
  }

  if (!candidates.includes(join(rootDir, "layout.mdx"))) {
    for (const ext of LAYOUT_EXTENSIONS) {
      candidates.push(join(rootDir, `layout.${ext}`));
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
      layoutLog.debug("stat layout candidate failed", result.reason as Error);
    }
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

async function addMissedAncestorLayouts(
  pageFilePath: string,
  rootDir: string,
  existing: string[],
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<void> {
  try {
    const included = new Set(existing);
    const dirsWithLayouts = new Set(existing.map((p) => dirname(p)));

    const candidates: string[] = [];
    let dir = dirname(pageFilePath);

    while (dir.startsWith(rootDir)) {
      if (!dirsWithLayouts.has(dir)) {
        for (const ext of LAYOUT_EXTENSIONS) {
          const candidate = join(dir, `layout.${ext}`);
          if (!included.has(candidate)) candidates.push(candidate);
        }
      }

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    const results = await Promise.allSettled(candidates.map((cand) => adapter.fs.stat(cand)));

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const cand = candidates[i];
      if (!result || !cand) continue;

      if (result.status === "fulfilled" && result.value.isFile) {
        const candDir = dirname(cand);
        if (dirsWithLayouts.has(candDir)) continue;

        addLayoutsFromFiles([cand], nestedLayouts);
        included.add(cand);
        dirsWithLayouts.add(candDir);
        continue;
      }

      if (result.status === "rejected") {
        layoutLog.debug("stat nested tsx/jsx layout failed", result.reason as Error);
      }
    }
  } catch (e) {
    layoutLog.debug("nested layout fallback scan failed", e as Error);
  }
}
