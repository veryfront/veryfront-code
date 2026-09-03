import { registerLRUCache } from "#veryfront/cache";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

type ModuleSourceResolver = "module-server" | "module-batch";

const SOURCE_MISS_CACHE_MAX_ENTRIES = 5_000;

const sourceMissCaches: Record<ModuleSourceResolver, LRUCache<string, true>> = {
  "module-server": new LRUCache<string, true>({
    maxEntries: SOURCE_MISS_CACHE_MAX_ENTRIES,
  }),
  "module-batch": new LRUCache<string, true>({
    maxEntries: SOURCE_MISS_CACHE_MAX_ENTRIES,
  }),
};

registerLRUCache("module-server-source-miss-cache", sourceMissCaches["module-server"]);
registerLRUCache("module-batch-source-miss-cache", sourceMissCaches["module-batch"]);

export function buildSourceMissCacheKey(options: {
  resolver: ModuleSourceResolver;
  projectDir: string;
  projectId?: string;
  projectSlug?: string | null;
  branch?: string | null;
  releaseId?: string | null;
  basePath: string;
  /**
   * The extension suffix already present on the looked-up path (e.g. `.json`),
   * and the extension the request asked for. Both change which candidate paths
   * a lookup stats — a non-JSON request never probes `.json` — so a miss
   * recorded for one extension must not answer for another. Leaving them out
   * lets a request for `app/page.js` cache a miss that suppresses the later,
   * resolvable lookup of `app/page.json`.
   */
  basePathExtension?: string | null;
  requestedExtension?: string | null;
  reactVersion?: string;
}): string {
  return [
    options.resolver,
    options.projectDir,
    options.projectId ?? "",
    options.projectSlug ?? "",
    options.branch ?? "",
    options.releaseId ?? "",
    options.reactVersion ?? "",
    options.basePath,
    options.basePathExtension ?? "",
    options.requestedExtension ?? "",
  ].join("\0");
}

export function hasSourceMiss(cacheKey: string): boolean {
  return sourceMissCaches[getResolverFromCacheKey(cacheKey)].has(cacheKey);
}

export function rememberSourceMiss(cacheKey: string): void {
  sourceMissCaches[getResolverFromCacheKey(cacheKey)].set(cacheKey, true);
}

export function clearSourceMissCache(resolver?: ModuleSourceResolver): void {
  if (resolver) {
    sourceMissCaches[resolver].clear();
    return;
  }

  for (const cache of Object.values(sourceMissCaches)) cache.clear();
}

function getResolverFromCacheKey(cacheKey: string): ModuleSourceResolver {
  const resolver = cacheKey.split("\0", 1)[0];
  return resolver === "module-batch" ? "module-batch" : "module-server";
}
