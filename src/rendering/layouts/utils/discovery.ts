import { memoizeHash as simpleHash, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem } from "#veryfront/types";
import { dirname, extname, join } from "#veryfront/platform/compat/path-helper.ts";
import { LAYOUT_EXTENSIONS } from "../types.ts";

/**
 * LRU cache for layout discovery with project isolation.
 * Key format: "projectDir:hash(pageFilePath, rootDir)"
 * This format allows efficient project-scoped clearing.
 */
interface CacheEntry {
  layouts: LayoutItem[];
  accessedAt: number;
  projectDir: string;
}

const MAX_CACHE_SIZE = 500;
const layoutDiscoveryCache = new Map<string, CacheEntry>();

/**
 * Clear the layout discovery cache.
 * Call this when config or layout files change to ensure HMR works correctly.
 * @param projectDir - Optional: clear only entries for a specific project
 */
export function clearLayoutDiscoveryCache(projectDir?: string): void {
  if (projectDir) {
    // Clear entries for specific project
    let cleared = 0;
    for (const [key, entry] of layoutDiscoveryCache.entries()) {
      if (entry.projectDir === projectDir) {
        layoutDiscoveryCache.delete(key);
        cleared++;
      }
    }
    logger.debug("[discovery] Cleared layout discovery cache for project", {
      projectDir,
      cleared,
      remaining: layoutDiscoveryCache.size,
    });
  } else {
    // Clear entire cache
    logger.debug("[discovery] Clearing entire layout discovery cache", {
      size: layoutDiscoveryCache.size,
    });
    layoutDiscoveryCache.clear();
  }
}

/**
 * Get cache statistics for monitoring.
 */
export function getLayoutDiscoveryCacheStats(): { size: number; maxSize: number } {
  return {
    size: layoutDiscoveryCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}

/**
 * Evict oldest entries when cache exceeds max size.
 */
function evictOldestEntries(): void {
  if (layoutDiscoveryCache.size <= MAX_CACHE_SIZE) return;

  // Sort by access time and remove oldest 10%
  const entries = [...layoutDiscoveryCache.entries()].sort(
    (a, b) => a[1].accessedAt - b[1].accessedAt,
  );
  const toRemove = Math.ceil(layoutDiscoveryCache.size * 0.1);

  for (let i = 0; i < toRemove && i < entries.length; i++) {
    layoutDiscoveryCache.delete(entries[i]![0]);
  }

  logger.debug("[discovery] Evicted old cache entries", {
    removed: toRemove,
    remaining: layoutDiscoveryCache.size,
  });
}

export async function discoverNestedLayouts(
  pageFilePath: string,
  rootDir: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<LayoutItem[]> {
  // Include projectDir in cache key for multi-tenant isolation
  const key = simpleHash(projectDir, pageFilePath, rootDir);
  const cached = layoutDiscoveryCache.get(key);
  if (cached) {
    // Update access time for LRU
    cached.accessedAt = Date.now();
    return cached.layouts;
  }

  const result = await discoverNestedLayoutsImpl(pageFilePath, rootDir, projectDir, adapter);

  // Evict before adding if needed
  evictOldestEntries();

  layoutDiscoveryCache.set(key, {
    layouts: result,
    accessedAt: Date.now(),
    projectDir,
  });

  return result;
}

async function discoverNestedLayoutsImpl(
  pageFilePath: string,
  rootDir: string,
  _projectDir: string,
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
      const candidatePath = candidates[i]!;
      const dir = dirname(candidatePath);

      // Only include the first layout found per directory (based on extension priority)
      if (!seenDirs.has(dir)) {
        existing.push(candidatePath);
        seenDirs.add(dir);
      }
      continue;
    }

    if (result.status === "rejected") {
      logger.debug("[layout] stat layout candidate failed", result.reason as Error);
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
    // Track directories that already have a layout
    const dirsWithLayouts = new Set(existing.map((p) => dirname(p)));
    const candidates: string[] = [];
    let dir = dirname(pageFilePath);

    while (dir.startsWith(rootDir)) {
      // Skip directories that already have a layout
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
        // Only add if this directory doesn't already have a layout
        if (!dirsWithLayouts.has(candDir)) {
          addLayoutsFromFiles([cand], nestedLayouts);
          included.add(cand);
          dirsWithLayouts.add(candDir);
        }
        continue;
      }

      if (result.status === "rejected") {
        logger.debug("[layout] stat nested tsx/jsx layout failed", result.reason as Error);
      }
    }
  } catch (e) {
    logger.debug("[layout] nested layout fallback scan failed", e as Error);
  }
}
