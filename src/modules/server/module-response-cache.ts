import { registerLRUCache } from "#veryfront/cache";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";

const RELEASE_MODULE_RESPONSE_CACHE_MAX_ENTRIES = 10_000;
const RELEASE_MODULE_RESPONSE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const RELEASE_MODULE_RESPONSE_DISTRIBUTED_TTL_SEC = TRANSFORM_DISTRIBUTED_TTL_SEC;

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

function parseDistributedEntry(raw: string): ReleaseModuleResponseCacheEntry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseModuleResponseCacheEntry>;
    if (typeof parsed.body !== "string") return null;
    if (typeof parsed.status !== "number") return null;
    if (
      !Array.isArray(parsed.headers) ||
      !parsed.headers.every((entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string"
      )
    ) return null;

    return {
      body: parsed.body,
      status: parsed.status,
      headers: parsed.headers as Array<[string, string]>,
    };
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

/**
 * The distributed cache backend validates keys against a strict charset
 * (alphanumeric plus `_ : . - /`) and rejects anything else with HTTP 400.
 * Request module paths routinely contain characters outside that set — notably
 * `@` (e.g. `/@vite/env`) — so an unsanitized path makes the composed key
 * unstorable and the response is silently never cached.
 *
 * We prefix a hash of the exact path (collision resistance for two paths that
 * clamp to the same readable form) with a charset-clamped readable form (kept
 * for debuggability). `:` is deliberately excluded from the readable form so it
 * cannot be confused with the key's field separator.
 */
function sanitizeModulePathForCacheKey(modulePath: string): string {
  const readable = modulePath.replace(/[^a-zA-Z0-9_.\-/]/g, "-");
  return `${hashString(modulePath)}-${readable}`;
}

export function buildReleaseModuleResponseCacheKey(
  options: ReleaseModuleResponseCacheKeyOptions,
): string {
  const projectScope = [
    options.projectIdentity,
    options.projectDir,
    options.projectSlug ?? "",
    options.branch ?? "",
  ].join("\0");

  // Fields are joined with `:` (an allowed key character) rather than a NUL
  // byte, which the distributed cache backend's key validator also rejects.
  return [
    "module-server-release-response",
    hashString(projectScope),
    options.releaseId,
    options.runtimeVersion,
    options.reactVersion ?? "",
    options.releaseDependencyManifestVersion == null
      ? ""
      : `release-dependency-manifest:${options.releaseDependencyManifestVersion}`,
    sanitizeModulePathForCacheKey(options.modulePath),
  ].join(":");
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

    const entry = parseDistributedEntry(raw);
    if (!entry) return undefined;

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
  releaseModuleResponseCache.set(cacheKey, entry);

  const distributedCache = await getDistributedCache();
  if (!distributedCache) return;

  try {
    await distributedCache.set(
      cacheKey,
      JSON.stringify(entry),
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
