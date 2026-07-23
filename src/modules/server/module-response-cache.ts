import { registerLRUCache } from "#veryfront/cache";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const RELEASE_MODULE_RESPONSE_CACHE_MAX_ENTRIES = 10_000;
const RELEASE_MODULE_RESPONSE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const RELEASE_MODULE_RESPONSE_DISTRIBUTED_TTL_SEC = TRANSFORM_DISTRIBUTED_TTL_SEC;
const RELEASE_MODULE_RESPONSE_FORMAT_VERSION = 1;
const MAX_RELEASE_MODULE_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RELEASE_MODULE_DISTRIBUTED_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_RELEASE_MODULE_HEADERS = 128;
const MAX_RELEASE_MODULE_HEADER_VALUE_BYTES = 8 * 1024;
const MAX_RELEASE_MODULE_IDENTITY_BYTES = 32 * 1024;
const encoder = new TextEncoder();

export interface ReleaseModuleResponseCacheEntry {
  body: string;
  status: number;
  headers: Array<[string, string]>;
}

export interface ReleaseModuleResponseCacheKeyOptions {
  projectIdentity: string;
  projectDir: string;
  projectSlug?: string | null;
  branch?: string | null;
  releaseId: string;
  runtimeVersion: string;
  reactVersion?: string;
  releaseDependencyManifestVersion?: number | null;
  modulePath: string;
}

export interface ReleaseModuleResponseCacheHit {
  entry: ReleaseModuleResponseCacheEntry;
  source: "memory" | "distributed";
}

const releaseModuleResponseCache = new LRUCache<string, ReleaseModuleResponseCacheEntry>({
  maxEntries: RELEASE_MODULE_RESPONSE_CACHE_MAX_ENTRIES,
  maxSizeBytes: RELEASE_MODULE_RESPONSE_CACHE_MAX_BYTES,
});

registerLRUCache("module-server-release-response-cache", releaseModuleResponseCache);

const getDistributedModuleResponseCache = createDistributedCacheAccessor(
  () => CacheBackends.module(),
  "MODULE-RESPONSE-CACHE",
);

let injectedDistributedCache: CacheBackend | null | undefined;

interface DistributedReleaseModuleResponseEntry {
  formatVersion: number;
  cacheKey: string;
  bodyHash: string;
  entry: ReleaseModuleResponseCacheEntry;
}

function normalizeEntry(value: unknown): ReleaseModuleResponseCacheEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as Partial<ReleaseModuleResponseCacheEntry>;
  const status = parsed.status;
  if (
    typeof parsed.body !== "string" ||
    encoder.encode(parsed.body).byteLength > MAX_RELEASE_MODULE_BODY_BYTES ||
    typeof status !== "number" ||
    !Number.isSafeInteger(status) ||
    status < 100 ||
    status > 599 ||
    !Array.isArray(parsed.headers) ||
    parsed.headers.length > MAX_RELEASE_MODULE_HEADERS ||
    !parsed.headers.every((entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(entry[0]) &&
      typeof entry[1] === "string" &&
      !/[\r\n]/.test(entry[1]) &&
      encoder.encode(entry[1]).byteLength <= MAX_RELEASE_MODULE_HEADER_VALUE_BYTES
    )
  ) return null;

  return {
    body: parsed.body,
    status,
    headers: parsed.headers.map(([name, value]) => [name, value]),
  };
}

async function parseDistributedEntry(
  raw: string,
  expectedCacheKey: string,
): Promise<ReleaseModuleResponseCacheEntry | null> {
  if (encoder.encode(raw).byteLength > MAX_RELEASE_MODULE_DISTRIBUTED_ENTRY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DistributedReleaseModuleResponseEntry>;
    if (
      parsed.formatVersion !== RELEASE_MODULE_RESPONSE_FORMAT_VERSION ||
      parsed.cacheKey !== expectedCacheKey ||
      typeof parsed.bodyHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.bodyHash)
    ) return null;

    const entry = normalizeEntry(parsed.entry);
    if (!entry || await computeHash(entry.body) !== parsed.bodyHash) return null;
    return entry;
  } catch {
    return null;
  }
}

async function getDistributedCache(): Promise<CacheBackend | null> {
  const cache = injectedDistributedCache !== undefined
    ? injectedDistributedCache
    : await getDistributedModuleResponseCache();
  if (!cache) return null;
  return cache.type === "api" || cache.type === "redis" ? cache : null;
}

function assertBoundedIdentity(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    encoder.encode(value).byteLength > MAX_RELEASE_MODULE_IDENTITY_BYTES
  ) {
    throw new RangeError(`${label} is empty or exceeds its cache-identity limit`);
  }
  return value;
}

function normalizeOptionalIdentity(value: string | null | undefined, label: string): string | null {
  return value == null ? null : assertBoundedIdentity(value, label);
}

export async function buildReleaseModuleResponseCacheKey(
  options: ReleaseModuleResponseCacheKeyOptions,
): Promise<string> {
  const manifestVersion = options.releaseDependencyManifestVersion;
  if (
    manifestVersion != null &&
    (!Number.isSafeInteger(manifestVersion) || manifestVersion < 0)
  ) {
    throw new RangeError("Release dependency manifest version must be a non-negative integer");
  }
  const identity = JSON.stringify([
    assertBoundedIdentity(options.projectIdentity, "Project identity"),
    assertBoundedIdentity(options.projectDir, "Project directory"),
    normalizeOptionalIdentity(options.projectSlug, "Project slug"),
    normalizeOptionalIdentity(options.branch, "Branch"),
    assertBoundedIdentity(options.releaseId, "Release identity"),
    assertBoundedIdentity(options.runtimeVersion, "Runtime version"),
    normalizeOptionalIdentity(options.reactVersion, "React version"),
    manifestVersion ?? null,
    assertBoundedIdentity(options.modulePath, "Module path"),
  ]);
  if (encoder.encode(identity).byteLength > MAX_RELEASE_MODULE_IDENTITY_BYTES) {
    throw new RangeError("Release module response cache identity exceeds its limit");
  }
  return `module-server-release-response:v2:${await computeHash(identity)}`;
}

export async function getReleaseModuleResponse(
  cacheKey: string,
): Promise<ReleaseModuleResponseCacheHit | undefined> {
  const localEntry = releaseModuleResponseCache.get(cacheKey);
  if (localEntry) {
    return { entry: localEntry, source: "memory" };
  }

  const distributedCache = await getDistributedCache();
  if (!distributedCache) return undefined;

  try {
    const raw = await distributedCache.get(cacheKey);
    if (!raw) return undefined;

    const entry = await parseDistributedEntry(raw, cacheKey);
    if (!entry) {
      await distributedCache.del(cacheKey).catch(() => {});
      return undefined;
    }

    releaseModuleResponseCache.set(cacheKey, entry);
    return { entry, source: "distributed" };
  } catch {
    return undefined;
  }
}

export async function rememberReleaseModuleResponse(
  cacheKey: string,
  entry: ReleaseModuleResponseCacheEntry,
): Promise<void> {
  const normalizedEntry = normalizeEntry(entry);
  if (!normalizedEntry) throw new TypeError("Invalid release module response cache entry");
  releaseModuleResponseCache.set(cacheKey, normalizedEntry);

  const distributedCache = await getDistributedCache();
  if (!distributedCache) return;

  try {
    const payload: DistributedReleaseModuleResponseEntry = {
      formatVersion: RELEASE_MODULE_RESPONSE_FORMAT_VERSION,
      cacheKey,
      bodyHash: await computeHash(normalizedEntry.body),
      entry: normalizedEntry,
    };
    const serialized = JSON.stringify(payload);
    if (encoder.encode(serialized).byteLength > MAX_RELEASE_MODULE_DISTRIBUTED_ENTRY_BYTES) {
      throw new RangeError("Release module response distributed entry exceeds its limit");
    }
    await distributedCache.set(
      cacheKey,
      serialized,
      RELEASE_MODULE_RESPONSE_DISTRIBUTED_TTL_SEC,
    );
  } catch {
    /* best-effort shared cache */
  }
}

export function clearReleaseModuleResponseCache(): void {
  releaseModuleResponseCache.clear();
}

export function __setReleaseModuleResponseDistributedCacheForTests(
  cache: CacheBackend | null | undefined,
): void {
  injectedDistributedCache = cache;
}
