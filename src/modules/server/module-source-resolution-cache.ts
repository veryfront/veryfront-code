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

/**
 * Clear source-miss entries for exactly one project identity without evicting
 * unrelated tenants. The strongest available identity is used because cache
 * keys always preserve project ID, slug, and directory as separate NUL-framed
 * fields.
 */
export function clearSourceMissCacheForProject(identity: {
  projectDir?: string;
  projectId?: string;
  projectSlug?: string;
}): number {
  const projectId = identity.projectId?.trim();
  const projectSlug = identity.projectSlug?.trim();
  const projectDir = identity.projectDir?.trim();
  const matchField = projectId
    ? { index: 2, value: projectId }
    : projectSlug
    ? { index: 3, value: projectSlug }
    : projectDir
    ? { index: 1, value: projectDir }
    : undefined;

  if (!matchField) {
    throw new TypeError("A project ID, slug, or directory is required for scoped miss eviction");
  }

  let deleted = 0;
  for (const cache of Object.values(sourceMissCaches)) {
    for (const key of cache.keys()) {
      const fields = key.split("\0");
      if (fields[matchField.index] === matchField.value && cache.delete(key)) deleted++;
    }
  }
  return deleted;
}

function getResolverFromCacheKey(cacheKey: string): ModuleSourceResolver {
  const resolver = cacheKey.split("\0", 1)[0];
  return resolver === "module-batch" ? "module-batch" : "module-server";
}
