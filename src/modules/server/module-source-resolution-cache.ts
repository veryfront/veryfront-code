import { registerLRUCache } from "#veryfront/cache";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

type ModuleSourceResolver = "module-server" | "module-batch";

const SOURCE_MISS_CACHE_MAX_ENTRIES = 5_000;
const SOURCE_MISS_CACHE_KEY_PREFIX = "module-source-miss:v2:";
const MAX_SOURCE_MISS_CACHE_IDENTITY_BYTES = 32 * 1024;
const encoder = new TextEncoder();

type SourceMissCacheIdentity = [
  resolver: ModuleSourceResolver,
  projectDir: string,
  projectId: string,
  projectSlug: string,
  branch: string,
  releaseId: string,
  reactVersion: string,
  basePath: string,
];

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
  if (options.resolver !== "module-server" && options.resolver !== "module-batch") {
    throw new TypeError("Source miss cache resolver is invalid");
  }
  const identity: SourceMissCacheIdentity = [
    options.resolver,
    options.projectDir,
    options.projectId ?? "",
    options.projectSlug ?? "",
    options.branch ?? "",
    options.releaseId ?? "",
    options.reactVersion ?? "",
    options.basePath,
  ];
  for (const [index, field] of identity.entries()) {
    if (typeof field !== "string") {
      throw new TypeError(`Source miss cache identity field ${index} must be a string`);
    }
    if (encoder.encode(field).byteLength > MAX_SOURCE_MISS_CACHE_IDENTITY_BYTES) {
      throw new RangeError(`Source miss cache identity field ${index} exceeds its limit`);
    }
  }

  const cacheKey = SOURCE_MISS_CACHE_KEY_PREFIX + JSON.stringify(identity);
  if (encoder.encode(cacheKey).byteLength > MAX_SOURCE_MISS_CACHE_IDENTITY_BYTES) {
    throw new RangeError("Source miss cache identity exceeds its limit");
  }
  return cacheKey;
}

export function hasSourceMiss(cacheKey: string): boolean {
  return sourceMissCaches[parseSourceMissCacheKey(cacheKey)[0]].has(cacheKey);
}

export function rememberSourceMiss(cacheKey: string): void {
  sourceMissCaches[parseSourceMissCacheKey(cacheKey)[0]].set(cacheKey, true);
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
 * keys always preserve project ID, slug, and directory as separate JSON-framed
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
      const fields = parseSourceMissCacheKey(key);
      if (fields[matchField.index] === matchField.value && cache.delete(key)) deleted++;
    }
  }
  return deleted;
}

function parseSourceMissCacheKey(cacheKey: string): SourceMissCacheIdentity {
  const invalid = () => new TypeError("Invalid module source miss cache key");
  if (
    typeof cacheKey !== "string" ||
    !cacheKey.startsWith(SOURCE_MISS_CACHE_KEY_PREFIX) ||
    encoder.encode(cacheKey).byteLength > MAX_SOURCE_MISS_CACHE_IDENTITY_BYTES
  ) {
    throw invalid();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cacheKey.slice(SOURCE_MISS_CACHE_KEY_PREFIX.length));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 8 ||
    (parsed[0] !== "module-server" && parsed[0] !== "module-batch") ||
    !parsed.every((field) =>
      typeof field === "string" &&
      encoder.encode(field).byteLength <= MAX_SOURCE_MISS_CACHE_IDENTITY_BYTES
    )
  ) {
    throw invalid();
  }

  const identity = parsed as SourceMissCacheIdentity;
  if (cacheKey !== SOURCE_MISS_CACHE_KEY_PREFIX + JSON.stringify(identity)) {
    throw invalid();
  }
  return identity;
}
