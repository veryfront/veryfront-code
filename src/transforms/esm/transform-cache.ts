import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { buildTransformCacheKey } from "#veryfront/cache/keys.ts";
import {
  type CacheBackend,
  CacheBackends,
  isDistributedBackend,
  type TokenizingCacheGateway,
} from "#veryfront/cache/backend.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  assertPortableCode,
  detokenizeAllCachePaths,
  tokenizeAllVeryFrontPaths,
} from "#veryfront/cache/paths.ts";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  expiresImmediately,
  MAX_CACHE_TTL_MILLISECONDS,
  resolveCacheTtlSeconds,
} from "#veryfront/cache/backends/ttl.ts";

const logger = baseLogger.component("transform-cache");

const DEFAULT_TTL_SECONDS = DEFAULT_CACHE_TTL_SECONDS;
const FALLBACK_MAX_ENTRIES = 500;
const FALLBACK_MAX_BYTES = 64 * 1024 * 1024;
const MAX_TRANSFORM_CODE_BYTES = 16 * 1024 * 1024;
const MAX_STORED_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_KEY_LENGTH = 32 * 1024;
const MAX_HASH_LENGTH = 1_024;
const MAX_MANIFEST_ID_LENGTH = 2_048;
const MAX_INFLIGHT_TRANSFORMS = 1_000;
const CACHE_INIT_RETRY_MS = 30_000;
const TRANSFORM_CACHE_FORMAT_VERSION = 2;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const STORED_ENTRY_KEYS = new Set([
  "bundleManifestId",
  "code",
  "codeHash",
  "expiresAt",
  "formatVersion",
  "hash",
  "timestamp",
]);
const sizeEncoder = new TextEncoder();

/**
 * Pattern to match unresolved /_vf_modules/_veryfront/ imports.
 * These should have been resolved to file:// paths by ssrVfModulesPlugin.
 */
const UNRESOLVED_VF_MODULES_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/_veryfront\/[^"']+)["']/;

interface TransformCacheEntry {
  code: string;
  /** Source/config identity retained for diagnostics and compatibility. */
  hash: string;
  timestamp: number;
  expiresAt: number;
  codeHash?: string;
  formatVersion: typeof TRANSFORM_CACHE_FORMAT_VERSION;
  bundleManifestId?: string;
}

interface StoredTransformCacheEntry extends TransformCacheEntry {
  codeHash: string;
}

let cacheGateway: TokenizingCacheGateway | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;
let lastCacheInitFailureTime: number | undefined;
let cacheLifecycleGeneration = 0;

interface LocalFallbackLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
  readonly size: number;
  entries(): IterableIterator<[K, V]>;
}

function estimateEntryBytes(key: string, entry: TransformCacheEntry): number {
  return sizeEncoder.encode(key).byteLength + sizeEncoder.encode(entry.code).byteLength +
    sizeEncoder.encode(entry.hash).byteLength +
    (entry.codeHash ? sizeEncoder.encode(entry.codeHash).byteLength : 0) +
    (entry.bundleManifestId ? sizeEncoder.encode(entry.bundleManifestId).byteLength : 0) + 64;
}

class BoundedTransformFallback implements LocalFallbackLike<string, TransformCacheEntry> {
  private readonly store = new Map<string, TransformCacheEntry>();
  private readonly sizes = new Map<string, number>();
  private currentBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get(key: string): TransformCacheEntry | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: string, value: TransformCacheEntry): void {
    this.delete(key);
    const size = estimateEntryBytes(key, value);
    if (this.maxEntries === 0 || this.maxBytes === 0 || size > this.maxBytes) return;

    while (
      this.store.size > 0 &&
      (this.store.size >= this.maxEntries || this.currentBytes + size > this.maxBytes)
    ) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }

    this.store.set(key, value);
    this.sizes.set(key, size);
    this.currentBytes += size;
  }

  delete(key: string): boolean {
    const size = this.sizes.get(key);
    if (size !== undefined) {
      this.currentBytes -= size;
      this.sizes.delete(key);
    }
    return this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
    this.sizes.clear();
    this.currentBytes = 0;
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[string, TransformCacheEntry]> {
    return this.store.entries();
  }
}

const defaultLocalFallback = new BoundedTransformFallback(
  FALLBACK_MAX_ENTRIES,
  FALLBACK_MAX_BYTES,
);

/** Injected caches for testing. */
let injectedLocalFallback: LocalFallbackLike<string, TransformCacheEntry> | null = null;
let injectedCacheGateway: TokenizingCacheGateway | CacheBackend | null | undefined = undefined;

function getLocalFallback(): LocalFallbackLike<string, TransformCacheEntry> {
  return injectedLocalFallback ?? defaultLocalFallback;
}

function getEffectiveCacheGateway(): TokenizingCacheGateway | CacheBackend | null {
  return injectedCacheGateway !== undefined ? injectedCacheGateway : cacheGateway;
}

function isDistributedGateway(
  gateway: TokenizingCacheGateway | CacheBackend,
): boolean {
  if ("isDistributed" in gateway && typeof gateway.isDistributed === "function") {
    return gateway.isDistributed();
  }
  return isDistributedBackend(gateway);
}

/** Inject custom caches for testing. Call with null to restore default behavior. */
export function __injectCachesForTests(
  caches: {
    localFallback?: LocalFallbackLike<string, TransformCacheEntry> | null;
    cacheBackend?: CacheBackend | null;
  } | null,
): void {
  if (caches === null) {
    injectedLocalFallback = null;
    injectedCacheGateway = undefined;
    return;
  }

  if (caches.localFallback !== undefined) injectedLocalFallback = caches.localFallback;
  if (caches.cacheBackend !== undefined) injectedCacheGateway = caches.cacheBackend;
}

/** Reset initialization state for deterministic tests and lifecycle cleanup. */
export function __resetInitStateForTests(): void {
  cacheLifecycleGeneration++;
  cacheInitialized = false;
  cacheInitPromise = null;
  cacheGateway = null;
  lastCacheInitFailureTime = undefined;
}

registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: getLocalFallback().size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: getEffectiveCacheGateway()?.type ?? "uninitialized",
}));

export async function initializeTransformCache(): Promise<boolean> {
  if (cacheInitialized && cacheGateway) return isDistributedGateway(cacheGateway);

  if (
    lastCacheInitFailureTime !== undefined &&
    Date.now() - lastCacheInitFailureTime < CACHE_INIT_RETRY_MS
  ) {
    return false;
  }

  if (!cacheInitPromise) {
    const generation = cacheLifecycleGeneration;
    cacheInitPromise = (async () => {
      try {
        const gateway = await CacheBackends.codeStore("TRANSFORM-CACHE", {
          keyPrefix: "transform",
        });
        if (cacheLifecycleGeneration !== generation) return;
        cacheGateway = gateway;
        cacheInitialized = true;
        lastCacheInitFailureTime = undefined;
        logger.info("Initialized with gateway", { backend: gateway.type });
      } catch (error) {
        if (cacheLifecycleGeneration !== generation) return;
        cacheGateway = null;
        cacheInitialized = false;
        lastCacheInitFailureTime = Date.now();
        logger.warn("Backend init failed; local fallback remains active", {
          errorName: error instanceof Error ? error.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  const pending = cacheInitPromise;
  try {
    await pending;
  } finally {
    if (cacheInitPromise === pending) cacheInitPromise = null;
  }

  return cacheGateway ? isDistributedGateway(cacheGateway) : false;
}

interface CacheKeyOptions {
  depsHash?: string;
  configHash?: string;
  projectId?: string;
}

export function generateCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
  options?: CacheKeyOptions,
): string {
  return buildTransformCacheKey(filePath, contentHash, ssr, studioEmbed, options);
}

function validateCacheKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_CACHE_KEY_LENGTH) {
    throw new RangeError(
      `Transform cache key must contain 1 to ${MAX_CACHE_KEY_LENGTH} characters`,
    );
  }
  if (hasControlCharacters(key)) {
    throw new TypeError("Transform cache key cannot contain control characters");
  }
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function validateBoundedString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0) &&
    value.length <= maxLength && !hasControlCharacters(value);
}

function validateCode(code: unknown): code is string {
  if (typeof code !== "string" || code.length === 0 || code.length > MAX_TRANSFORM_CODE_BYTES) {
    return false;
  }
  return sizeEncoder.encode(code).byteLength <= MAX_TRANSFORM_CODE_BYTES;
}

function validateTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 &&
    (value as number) <= 8_640_000_000_000_000;
}

function getOwnData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.get || descriptor.set) return undefined;
  return descriptor.value;
}

function parseStoredEntry(raw: string): StoredTransformCacheEntry | undefined {
  if (raw.length === 0 || raw.length > MAX_STORED_ENTRY_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  if (Object.keys(value).some((key) => !STORED_ENTRY_KEYS.has(key))) return undefined;

  const formatVersion = getOwnData(value, "formatVersion");
  const code = getOwnData(value, "code");
  const hash = getOwnData(value, "hash");
  const codeHash = getOwnData(value, "codeHash");
  const timestamp = getOwnData(value, "timestamp");
  const expiresAt = getOwnData(value, "expiresAt");
  const bundleManifestId = getOwnData(value, "bundleManifestId");

  if (formatVersion !== TRANSFORM_CACHE_FORMAT_VERSION) return undefined;
  if (!validateCode(code)) return undefined;
  if (!validateBoundedString(hash, MAX_HASH_LENGTH)) return undefined;
  if (typeof codeHash !== "string" || !SHA256_HEX_PATTERN.test(codeHash)) return undefined;
  if (!validateTimestamp(timestamp) || !validateTimestamp(expiresAt)) return undefined;
  if (expiresAt <= timestamp || expiresAt - timestamp > MAX_CACHE_TTL_MILLISECONDS) {
    return undefined;
  }
  if (
    bundleManifestId !== undefined &&
    !validateBoundedString(bundleManifestId, MAX_MANIFEST_ID_LENGTH)
  ) {
    return undefined;
  }

  return {
    formatVersion,
    code,
    hash,
    codeHash,
    timestamp,
    expiresAt,
    ...(bundleManifestId === undefined ? {} : { bundleManifestId }),
  };
}

function getValidLocalEntry(key: string, now = Date.now()): TransformCacheEntry | undefined {
  const fallback = getLocalFallback();
  const entry = fallback.get(key);
  if (!entry) return undefined;
  if (
    entry.formatVersion !== TRANSFORM_CACHE_FORMAT_VERSION ||
    !validateCode(entry.code) ||
    !validateBoundedString(entry.hash, MAX_HASH_LENGTH) ||
    !validateTimestamp(entry.timestamp) ||
    !validateTimestamp(entry.expiresAt) ||
    entry.expiresAt <= entry.timestamp ||
    entry.expiresAt - entry.timestamp > MAX_CACHE_TTL_MILLISECONDS ||
    now >= entry.expiresAt ||
    (entry.codeHash !== undefined && !SHA256_HEX_PATTERN.test(entry.codeHash)) ||
    (entry.bundleManifestId !== undefined &&
      !validateBoundedString(entry.bundleManifestId, MAX_MANIFEST_ID_LENGTH))
  ) {
    fallback.delete(key);
    return undefined;
  }
  return entry;
}

async function deleteCacheEntry(key: string): Promise<void> {
  getLocalFallback().delete(key);
  const gateway = getEffectiveCacheGateway();
  if (gateway) await gateway.del(key);
}

async function discardInvalidGatewayEntry(
  gateway: TokenizingCacheGateway | CacheBackend,
  key: string,
  reason: string,
): Promise<void> {
  try {
    await gateway.del(key);
  } catch (error) {
    logger.warn("Failed to remove invalid transform cache entry", {
      keyLength: key.length,
      reason,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  validateCacheKey(key);
  const gateway = getEffectiveCacheGateway();

  if (gateway) {
    try {
      const raw = await gateway.get(key);
      if (raw !== null) {
        const entry = parseStoredEntry(raw);
        if (!entry) {
          await discardInvalidGatewayEntry(gateway, key, "invalid payload");
        } else if (Date.now() >= entry.expiresAt) {
          await discardInvalidGatewayEntry(gateway, key, "expired payload");
        } else if (await computeHash(entry.code) !== entry.codeHash) {
          await discardInvalidGatewayEntry(gateway, key, "integrity mismatch");
        } else {
          const code = isDistributedGateway(gateway)
            ? detokenizeAllCachePaths(entry.code)
            : entry.code;
          if (!validateCode(code)) {
            await discardInvalidGatewayEntry(gateway, key, "invalid detokenized payload");
          } else {
            return { ...entry, code };
          }
        }
      }
    } catch (error) {
      logger.warn("Transform cache backend get failed", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const local = getValidLocalEntry(key);
  if (!local) return undefined;
  if (local.codeHash && await computeHash(local.code) !== local.codeHash) {
    getLocalFallback().delete(key);
    return undefined;
  }
  return local;
}

/** Synchronous access is intentionally limited to trusted process-local entries. */
export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  validateCacheKey(key);
  return getValidLocalEntry(key);
}

function resolveTransformTtl(ttlSeconds: number | undefined): number {
  return resolveCacheTtlSeconds(ttlSeconds, DEFAULT_TTL_SECONDS)!;
}

function validateTransformPayload(code: string, hash: string): void {
  if (!validateCode(code)) {
    throw new RangeError(
      `Transform code must contain 1 to ${MAX_TRANSFORM_CODE_BYTES} UTF-8 bytes`,
    );
  }
  if (!validateBoundedString(hash, MAX_HASH_LENGTH)) {
    throw new TypeError("Transform source hash is invalid");
  }
}

function createEntry(
  code: string,
  hash: string,
  timestamp: number,
  expiresAt: number,
  codeHash: string | undefined,
  bundleManifestId?: string,
): TransformCacheEntry {
  if (
    bundleManifestId !== undefined &&
    !validateBoundedString(bundleManifestId, MAX_MANIFEST_ID_LENGTH)
  ) {
    throw new TypeError("Transform bundle manifest ID is invalid");
  }
  return {
    formatVersion: TRANSFORM_CACHE_FORMAT_VERSION,
    code,
    hash,
    timestamp,
    expiresAt,
    ...(codeHash === undefined ? {} : { codeHash }),
    ...(bundleManifestId === undefined ? {} : { bundleManifestId }),
  };
}

export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  bundleManifestId?: string,
): Promise<void> {
  validateCacheKey(key);
  const ttl = resolveTransformTtl(ttlSeconds);
  if (expiresImmediately(ttl)) {
    await deleteCacheEntry(key);
    return;
  }
  validateTransformPayload(code, hash);

  const timestamp = Date.now();
  const expiresAt = timestamp + Math.ceil(ttl * 1_000);
  const localCodeHash = await computeHash(code);
  const localEntry = createEntry(
    code,
    hash,
    timestamp,
    expiresAt,
    localCodeHash,
    bundleManifestId,
  );
  const gateway = getEffectiveCacheGateway();

  if (!gateway) {
    getLocalFallback().set(key, localEntry);
    return;
  }

  const distributed = isDistributedGateway(gateway);
  const storedCode = distributed ? tokenizeAllVeryFrontPaths(code) : code;
  if (distributed) assertPortableCode(storedCode);
  const storedCodeHash = distributed ? await computeHash(storedCode) : localCodeHash;
  const storedEntry = createEntry(
    storedCode,
    hash,
    timestamp,
    expiresAt,
    storedCodeHash,
    bundleManifestId,
  ) as StoredTransformCacheEntry;
  const serialized = JSON.stringify(storedEntry);
  if (sizeEncoder.encode(serialized).byteLength > MAX_STORED_ENTRY_BYTES) {
    throw new RangeError("Serialized transform cache entry is too large");
  }

  try {
    await gateway.set(key, serialized, ttl);
  } catch (error) {
    getLocalFallback().set(key, localEntry);
    throw new Error("Transform cache backend set failed; stored in local fallback", {
      cause: error,
    });
  }
}

/**
 * Legacy synchronous writes are process-local. Persisted entries require an
 * asynchronous SHA-256 integrity digest and therefore use setCachedTransformAsync.
 */
export function setCachedTransform(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): void {
  validateCacheKey(key);
  const ttl = resolveTransformTtl(ttlSeconds);
  if (expiresImmediately(ttl)) {
    getLocalFallback().delete(key);
    const gateway = getEffectiveCacheGateway();
    gateway?.del(key).catch((error) => {
      logger.warn("Failed to expire synchronous transform cache entry", {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    });
    return;
  }
  validateTransformPayload(code, hash);
  const timestamp = Date.now();
  getLocalFallback().set(
    key,
    createEntry(code, hash, timestamp, timestamp + Math.ceil(ttl * 1_000), undefined),
  );
}

const inFlightTransforms = new Map<
  string,
  { generation: number; promise: Promise<TransformCacheResult> }
>();

export function destroyTransformCache(): void {
  cacheLifecycleGeneration++;
  getLocalFallback().clear();
  inFlightTransforms.clear();
  cacheGateway = null;
  cacheInitialized = false;
  cacheInitPromise = null;
  lastCacheInitFailureTime = undefined;
}

export async function getDistributedTransformBackend(): Promise<CacheBackend | null> {
  await initializeTransformCache();
  const gateway = getEffectiveCacheGateway();
  if (!gateway || !isDistributedGateway(gateway)) return null;
  return gateway as CacheBackend;
}

interface TransformCacheResult {
  code: string;
  /** Bundle manifest ID if the cached entry has one. */
  bundleManifestId?: string;
  cacheHit: boolean;
}

async function computeAndCacheTransform(
  key: string,
  computeFn: () => Promise<string>,
  ttlSeconds: number,
): Promise<TransformCacheResult> {
  logger.debug("Cache miss, computing", { keyLength: key.length });
  const code = await computeFn();
  if (!validateCode(code)) {
    throw new RangeError("Computed transform is empty or exceeds the transform cache size limit");
  }
  const hash = await computeHash(code);
  try {
    await setCachedTransformAsync(key, code, hash, ttlSeconds);
  } catch (error) {
    logger.warn("Failed to cache computed transform", {
      keyLength: key.length,
      errorName: error instanceof Error ? error.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { code, cacheHit: false };
}

export async function getOrComputeTransform(
  key: string,
  computeFn: () => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<TransformCacheResult> {
  validateCacheKey(key);
  const ttl = resolveTransformTtl(ttlSeconds);
  const cached = await getCachedTransformAsync(key);
  if (cached) {
    if (UNRESOLVED_VF_MODULES_PATTERN.test(cached.code)) {
      const match = cached.code.match(UNRESOLVED_VF_MODULES_PATTERN);
      logger.warn("Cache contains unresolved _vf_modules import, invalidating", {
        keyLength: key.length,
        unresolvedImport: match?.[1]?.slice(0, 60),
      });
      try {
        await deleteCacheEntry(key);
      } catch (error) {
        logger.warn("Failed to delete stale transform cache entry", {
          keyLength: key.length,
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
    } else {
      logger.debug("Cache hit", { keyLength: key.length });
      return { code: cached.code, bundleManifestId: cached.bundleManifestId, cacheHit: true };
    }
  }

  const generation = cacheLifecycleGeneration;
  const existing = inFlightTransforms.get(key);
  if (existing?.generation === generation) return existing.promise;

  if (inFlightTransforms.size >= MAX_INFLIGHT_TRANSFORMS) {
    logger.warn("Transform singleflight capacity reached; computing independently", {
      inflight: inFlightTransforms.size,
    });
    return computeAndCacheTransform(key, computeFn, ttl);
  }

  const promise = computeAndCacheTransform(key, computeFn, ttl);
  inFlightTransforms.set(key, { generation, promise });
  try {
    return await promise;
  } finally {
    const current = inFlightTransforms.get(key);
    if (current?.generation === generation && current.promise === promise) {
      inFlightTransforms.delete(key);
    }
  }
}
