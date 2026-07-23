import { registerLRUCache } from "#veryfront/cache";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

type ModuleSourceResolver = "module-server" | "module-batch";

const SOURCE_MISS_CACHE_MAX_ENTRIES = 5_000;
const SOURCE_MISS_CACHE_TTL_MS = 1_000;
const MAX_SOURCE_IDENTITY_LENGTH = 4_096;
const MAX_SOURCE_MISS_CACHE_KEY_LENGTH = 32 * 1024;

const sourceMissCaches: Record<ModuleSourceResolver, LRUCache<string, true>> = {
  "module-server": new LRUCache<string, true>({
    maxEntries: SOURCE_MISS_CACHE_MAX_ENTRIES,
    ttlMs: SOURCE_MISS_CACHE_TTL_MS,
  }),
  "module-batch": new LRUCache<string, true>({
    maxEntries: SOURCE_MISS_CACHE_MAX_ENTRIES,
    ttlMs: SOURCE_MISS_CACHE_TTL_MS,
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
  const fields = [
    options.resolver,
    options.projectDir,
    options.projectId ?? "",
    options.projectSlug ?? "",
    options.branch ?? "",
    options.releaseId ?? "",
    options.reactVersion ?? "",
    options.basePath,
  ];
  if (
    fields.some((field) =>
      field.length > MAX_SOURCE_IDENTITY_LENGTH || hasUnsafeControlCharacters(field)
    )
  ) {
    throw new RangeError("Invalid module source miss cache identity");
  }
  const key = JSON.stringify(fields);
  if (key.length > MAX_SOURCE_MISS_CACHE_KEY_LENGTH) {
    throw new RangeError("Module source miss cache key is too large");
  }
  return key;
}

export function hasSourceMiss(cacheKey: string): boolean {
  const resolver = getResolverFromCacheKey(cacheKey);
  return resolver ? sourceMissCaches[resolver].has(cacheKey) : false;
}

export function rememberSourceMiss(cacheKey: string): void {
  const resolver = getResolverFromCacheKey(cacheKey);
  if (!resolver) throw new TypeError("Invalid module source miss cache key");
  sourceMissCaches[resolver].set(cacheKey, true);
}

export function clearSourceMissCache(resolver?: ModuleSourceResolver): void {
  if (resolver) {
    sourceMissCaches[resolver].clear();
    return;
  }

  for (const cache of Object.values(sourceMissCaches)) cache.clear();
}

function getResolverFromCacheKey(cacheKey: string): ModuleSourceResolver | null {
  if (cacheKey.length === 0 || cacheKey.length > MAX_SOURCE_MISS_CACHE_KEY_LENGTH) return null;
  try {
    const fields: unknown = JSON.parse(cacheKey);
    if (
      !Array.isArray(fields) || fields.length !== 8 ||
      fields.some((field) => typeof field !== "string")
    ) {
      return null;
    }
    const resolver = fields[0];
    return resolver === "module-server" || resolver === "module-batch" ? resolver : null;
  } catch {
    return null;
  }
}
