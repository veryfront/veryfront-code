import { registerLRUCache } from "#veryfront/cache";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const RELEASE_MODULE_RESPONSE_CACHE_MAX_ENTRIES = 10_000;
const RELEASE_MODULE_RESPONSE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const RELEASE_MODULE_RESPONSE_DISTRIBUTED_TTL_SEC = TRANSFORM_DISTRIBUTED_TTL_SEC;
const MAX_CACHE_KEY_LENGTH = 8_192;
const MAX_IDENTITY_LENGTH = 4_096;
const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_DISTRIBUTED_ENTRY_BYTES = MAX_RESPONSE_BODY_BYTES + 64 * 1024;
const MAX_RESPONSE_HEADERS = 64;
const MAX_HEADER_VALUE_LENGTH = 8_192;
const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;
const CACHE_KEY_PATTERN = /^[a-zA-Z0-9_:./-]+$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "location",
  "proxy-authenticate",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
]);

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

function isValidCacheKey(cacheKey: string): boolean {
  return cacheKey.length > 0 && cacheKey.length <= MAX_CACHE_KEY_LENGTH &&
    CACHE_KEY_PATTERN.test(cacheKey);
}

function cloneEntry(entry: ReleaseModuleResponseCacheEntry): ReleaseModuleResponseCacheEntry {
  return {
    body: entry.body,
    status: entry.status,
    headers: entry.headers.map(([name, value]) => [name, value]),
  };
}

function validateEntry(value: unknown): ReleaseModuleResponseCacheEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const parsed = value as Partial<ReleaseModuleResponseCacheEntry>;
  if (
    typeof parsed.body !== "string" ||
    new TextEncoder().encode(parsed.body).byteLength > MAX_RESPONSE_BODY_BYTES ||
    !Number.isSafeInteger(parsed.status) || parsed.status! < 100 || parsed.status! > 599 ||
    !Array.isArray(parsed.headers) || parsed.headers.length > MAX_RESPONSE_HEADERS
  ) {
    return null;
  }

  const headers: Array<[string, string]> = [];
  const seenHeaderNames = new Set<string>();
  let headerBytes = 0;
  for (const entry of parsed.headers) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [name, headerValue] = entry;
    if (typeof name !== "string" || typeof headerValue !== "string") return null;
    const normalizedName = name.toLowerCase();
    if (
      !HEADER_NAME_PATTERN.test(name) || FORBIDDEN_RESPONSE_HEADERS.has(normalizedName) ||
      seenHeaderNames.has(normalizedName) ||
      headerValue.length > MAX_HEADER_VALUE_LENGTH ||
      hasUnsafeControlCharacters(headerValue)
    ) {
      return null;
    }
    headerBytes += new TextEncoder().encode(name).byteLength +
      new TextEncoder().encode(headerValue).byteLength;
    if (headerBytes > MAX_RESPONSE_HEADER_BYTES) return null;
    seenHeaderNames.add(normalizedName);
    headers.push([name, headerValue]);
  }

  if ([204, 205, 304].includes(parsed.status!) && parsed.body.length > 0) return null;

  return { body: parsed.body, status: parsed.status!, headers };
}

function parseDistributedEntry(raw: string): ReleaseModuleResponseCacheEntry | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_DISTRIBUTED_ENTRY_BYTES) return null;
  try {
    return validateEntry(JSON.parse(raw));
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
  const requiredIdentities = [
    options.projectIdentity,
    options.projectDir,
    options.releaseId,
    options.runtimeVersion,
    options.modulePath,
  ];
  if (requiredIdentities.some((identity) => identity.length === 0)) {
    throw new RangeError("Invalid release module response cache identity");
  }
  for (
    const identity of [
      options.projectIdentity,
      options.projectDir,
      options.projectSlug ?? "",
      options.branch ?? "",
      options.releaseId,
      options.runtimeVersion,
      options.reactVersion ?? "",
      options.modulePath,
    ]
  ) {
    if (
      identity.length > MAX_IDENTITY_LENGTH ||
      hasUnsafeControlCharacters(identity)
    ) {
      throw new RangeError("Invalid release module response cache identity");
    }
  }
  if (
    options.releaseDependencyManifestVersion != null &&
    (!Number.isSafeInteger(options.releaseDependencyManifestVersion) ||
      options.releaseDependencyManifestVersion < 0)
  ) {
    throw new RangeError("Invalid release dependency manifest version");
  }

  const projectScope = [
    options.projectIdentity,
    options.projectDir,
    options.projectSlug ?? "",
    options.branch ?? "",
  ].join("\0");

  // Fields are joined with `:` (an allowed key character) rather than a NUL
  // byte, which the distributed cache backend's key validator also rejects.
  const key = [
    "module-server-release-response",
    hashString(projectScope),
    hashString(options.releaseId),
    hashString(options.runtimeVersion),
    options.reactVersion ? hashString(options.reactVersion) : "default",
    options.releaseDependencyManifestVersion == null
      ? ""
      : `release-dependency-manifest:${options.releaseDependencyManifestVersion}`,
    sanitizeModulePathForCacheKey(options.modulePath),
  ].join(":");
  if (!isValidCacheKey(key)) throw new RangeError("Invalid release module response cache key");
  return key;
}

export async function getReleaseModuleResponse(
  cacheKey: string,
): Promise<ReleaseModuleResponseCacheHit | undefined> {
  if (!isValidCacheKey(cacheKey)) return undefined;
  const localEntry = releaseModuleResponseCache.get(cacheKey);
  if (localEntry) {
    return { entry: cloneEntry(localEntry), source: "memory" };
  }

  const distributedCache = await getDistributedCache();
  if (!distributedCache) return undefined;

  try {
    const raw = await distributedCache.get(cacheKey);
    if (!raw) return undefined;

    const entry = parseDistributedEntry(raw);
    if (!entry) return undefined;

    releaseModuleResponseCache.set(cacheKey, cloneEntry(entry));
    return { entry: cloneEntry(entry), source: "distributed" };
  } catch {
    return undefined;
  }
}

export async function rememberReleaseModuleResponse(
  cacheKey: string,
  entry: ReleaseModuleResponseCacheEntry,
): Promise<void> {
  if (!isValidCacheKey(cacheKey)) {
    throw new TypeError("Invalid release module response cache key");
  }
  const validatedEntry = validateEntry(entry);
  if (!validatedEntry) {
    throw new TypeError("Invalid release module response cache entry");
  }
  releaseModuleResponseCache.set(cacheKey, cloneEntry(validatedEntry));

  const distributedCache = await getDistributedCache();
  if (!distributedCache) return;

  try {
    await distributedCache.set(
      cacheKey,
      JSON.stringify(validatedEntry),
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
