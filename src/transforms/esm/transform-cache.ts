import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { buildTransformCacheKey } from "#veryfront/cache/keys.ts";
import { Singleflight, waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import {
  buildRevisionedCacheKey,
  type CacheBackend,
  CacheBackends,
  isDistributedBackend,
  isRevisionedCacheBackend,
  requireCacheExchangeResult,
  type RevisionedCacheBackend,
  snapshotCacheRevisionResult,
  type TokenizingCacheGateway,
} from "#veryfront/cache/backend.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
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
import type {
  TransformProgressEvent,
  TransformProgressListener,
} from "#veryfront/transforms/progress.ts";
import type { DependencyResolutionObservation } from "../import-rewriter/dependency-resolution.ts";

const logger = baseLogger.component("transform-cache");

const DEFAULT_TTL_SECONDS = DEFAULT_CACHE_TTL_SECONDS;
const FALLBACK_MAX_ENTRIES = 500;
export const TRANSFORM_FLIGHT_STALE_EVICTION_MS = 5 * 60_000;
const FALLBACK_MAX_BYTES = 64 * 1024 * 1024;
const MAX_TRANSFORM_CODE_BYTES = 32 * 1024 * 1024;
const MAX_STORED_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_KEY_LENGTH = 32 * 1024;
const MAX_HASH_LENGTH = 1_024;
const MAX_MANIFEST_ID_LENGTH = 2_048;
const MAX_DEPENDENCY_OBSERVATIONS = 10_000;
const MAX_DEPENDENCY_OBSERVATION_FIELD_LENGTH = 4_096;
const MAX_INFLIGHT_TRANSFORMS = 1_000;
const MAX_TRANSFORM_WRITE_PERMITS = 1_000;
const TRANSFORM_CACHE_FORMAT_VERSION = 2;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const STORED_ENTRY_KEYS = new Set([
  "bundleManifestId",
  "code",
  "codeHash",
  "dependencyResolutionObservations",
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
  /**
   * Inert unresolved imports observed while producing this entry. Presence is
   * mandatory for dependency-pinning cache entries so legacy entries cannot
   * bypass retry replay.
   */
  dependencyResolutionObservations?: ReadonlyArray<DependencyResolutionObservation>;
}

interface StoredTransformCacheEntry extends TransformCacheEntry {
  codeHash: string;
}

let cacheGateway: TokenizingCacheGateway | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;
let transformFlight = new Singleflight<TransformCacheResult>();

interface TransformProgressState {
  listeners: Set<TransformProgressListener>;
  flights: number;
  lastEvent?: TransformProgressEvent;
}

const transformProgress = new Map<string, TransformProgressState>();

function ensureTransformProgressState(key: string): TransformProgressState {
  let state = transformProgress.get(key);
  if (!state) {
    state = { listeners: new Set(), flights: 0 };
    transformProgress.set(key, state);
  }
  return state;
}

function deleteTransformProgressStateIfIdle(key: string, state: TransformProgressState): void {
  if (state.flights === 0 && state.listeners.size === 0) {
    transformProgress.delete(key);
  }
}

function beginTransformProgressFlight(key: string): {
  state: TransformProgressState;
  end: () => void;
} {
  const state = ensureTransformProgressState(key);
  state.flights++;

  return {
    state,
    end: () => {
      state.flights = Math.max(0, state.flights - 1);
      if (transformProgress.get(key) === state) {
        deleteTransformProgressStateIfIdle(key, state);
      }
    },
  };
}

function notifyTransformProgressListener(
  key: string,
  listener: TransformProgressListener,
  event: TransformProgressEvent,
): void {
  try {
    listener(event);
  } catch (error) {
    logger.debug("Transform progress listener failed", {
      keyLength: key.length,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function subscribeToTransformProgress(
  key: string,
  listener?: TransformProgressListener,
): () => void {
  if (!listener) return () => {};

  const state = ensureTransformProgressState(key);
  state.listeners.add(listener);
  if (state.lastEvent) notifyTransformProgressListener(key, listener, state.lastEvent);

  return () => {
    state.listeners.delete(listener);
    if (transformProgress.get(key) === state) {
      deleteTransformProgressStateIfIdle(key, state);
    }
  };
}

function publishTransformProgress(
  key: string,
  state: TransformProgressState,
  event: TransformProgressEvent,
): void {
  if (transformProgress.get(key) !== state) return;
  state.lastEvent = event;
  for (const listener of state.listeners) {
    notifyTransformProgressListener(key, listener, event);
  }
}
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
    (entry.bundleManifestId ? sizeEncoder.encode(entry.bundleManifestId).byteLength : 0) +
    (entry.dependencyResolutionObservations
      ? sizeEncoder.encode(JSON.stringify(entry.dependencyResolutionObservations)).byteLength
      : 0) +
    64;
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
type TransformCacheGateway = TokenizingCacheGateway | CacheBackend;

const transformCacheWritePermitBrand = Symbol("transform-cache-write-permit");

/**
 * Opaque authority to publish one transform against the revision observed
 * before its computation began.
 *
 * @internal
 */
export interface TransformCacheWritePermit {
  readonly [transformCacheWritePermitBrand]: true;
}

interface TransformCacheWritePermitState {
  readonly permit: TransformCacheWritePermit;
  readonly key: string;
  readonly reservedKey: string | null;
  readonly backend: RevisionedCacheBackend | null;
  readonly generation: number;
  readonly timestamp: number;
  readonly expiresAtMs: number;
  readonly deleteOnly: boolean;
  revision?: string;
  active: boolean;
}

interface TransformCacheWriteObservation {
  readonly entry?: TransformCacheEntry;
  readonly permit: TransformCacheWritePermit;
}

const transformCacheWritePermitStates = new WeakMap<
  TransformCacheWritePermit,
  TransformCacheWritePermitState
>();
const transformCacheWritePermitsByKey = new Map<string, TransformCacheWritePermit>();
let atomicRevisionUnavailableWarningGeneration = -1;

function getLocalFallback(): LocalFallbackLike<string, TransformCacheEntry> {
  return injectedLocalFallback ?? defaultLocalFallback;
}

function getEffectiveCacheGateway(): TokenizingCacheGateway | CacheBackend | null {
  return injectedCacheGateway !== undefined ? injectedCacheGateway : cacheGateway;
}

function warnAtomicRevisionUnavailable(gateway: TransformCacheGateway): void {
  if (atomicRevisionUnavailableWarningGeneration === cacheLifecycleGeneration) return;
  atomicRevisionUnavailableWarningGeneration = cacheLifecycleGeneration;
  logger.warn("Shared transform persistence is unavailable; using the local cache", {
    backend: gateway.type,
    reason: "atomic-revision-unavailable",
  });
}

function getRevisionedDistributedBackend(
  gateway: TransformCacheGateway | null,
  warnIfUnavailable = true,
): RevisionedCacheBackend | null {
  if (!gateway || !isDistributedGateway(gateway)) return null;
  if (isRevisionedCacheBackend(gateway)) return gateway;
  if (warnIfUnavailable) warnAtomicRevisionUnavailable(gateway);
  return null;
}

function getTransformCacheBackendStatus(): string {
  const gateway = getEffectiveCacheGateway();
  if (!gateway) return "uninitialized";
  if (
    isDistributedGateway(gateway) &&
    getRevisionedDistributedBackend(gateway, false) === null
  ) {
    return gateway.type + ":local-only:atomic-revision-unavailable";
  }
  if (!isDistributedGateway(gateway)) return gateway.type + ":local-only";
  return gateway.type;
}

function invalidateTransformCacheWritePermit(
  permit: TransformCacheWritePermit,
): void {
  const state = transformCacheWritePermitStates.get(permit);
  if (!state || !state.active) return;
  state.active = false;
  if (transformCacheWritePermitsByKey.get(state.key) === permit) {
    transformCacheWritePermitsByKey.delete(state.key);
  }
}

function invalidateAllTransformCacheWritePermits(): void {
  for (const permit of transformCacheWritePermitsByKey.values()) {
    const state = transformCacheWritePermitStates.get(permit);
    if (state) state.active = false;
  }
  transformCacheWritePermitsByKey.clear();
}

function registerTransformCacheWritePermit(
  key: string,
  backend: RevisionedCacheBackend | null,
  reservedKey: string | null,
  timestamp: number,
  expiresAtMs: number,
  deleteOnly: boolean,
): TransformCacheWritePermitState {
  const previous = transformCacheWritePermitsByKey.get(key);
  if (previous) invalidateTransformCacheWritePermit(previous);

  while (transformCacheWritePermitsByKey.size >= MAX_TRANSFORM_WRITE_PERMITS) {
    const oldest = transformCacheWritePermitsByKey.keys().next();
    if (oldest.done) break;
    const evicted = transformCacheWritePermitsByKey.get(oldest.value);
    if (evicted) invalidateTransformCacheWritePermit(evicted);
  }

  const permit = Object.freeze({
    [transformCacheWritePermitBrand]: true as const,
  });
  const state: TransformCacheWritePermitState = {
    permit,
    key,
    reservedKey,
    backend,
    generation: cacheLifecycleGeneration,
    timestamp,
    expiresAtMs,
    deleteOnly,
    active: true,
  };
  transformCacheWritePermitStates.set(permit, state);
  transformCacheWritePermitsByKey.set(key, permit);
  return state;
}

function isCurrentTransformCacheWritePermit(
  state: TransformCacheWritePermitState,
): boolean {
  return state.active &&
    state.generation === cacheLifecycleGeneration &&
    transformCacheWritePermitsByKey.get(state.key) === state.permit;
}

function requireTransformCacheWritePermit(
  permit: TransformCacheWritePermit,
): TransformCacheWritePermitState {
  if (
    permit === null ||
    (typeof permit !== "object" && typeof permit !== "function")
  ) {
    throw new TypeError("Transform cache publication permit is invalid");
  }
  const state = transformCacheWritePermitStates.get(permit);
  if (!state) throw new TypeError("Transform cache publication permit is invalid");
  return state;
}

/** Release an unused publication permit after a validated cache hit. @internal */
export function releaseCachedTransformWritePermit(
  permit: TransformCacheWritePermit,
): void {
  invalidateTransformCacheWritePermit(permit);
}

function isDistributedGateway(
  gateway: TokenizingCacheGateway | CacheBackend,
): boolean {
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
  invalidateAllTransformCacheWritePermits();
  cacheInitialized = false;
  cacheInitPromise = null;
  cacheGateway = null;
}

registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: getLocalFallback().size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: getTransformCacheBackendStatus(),
}));

export async function initializeTransformCache(): Promise<boolean> {
  if (cacheInitialized && cacheGateway) {
    return getRevisionedDistributedBackend(cacheGateway) !== null;
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
        logger.debug("Initialized with gateway", { backend: gateway.type });
      } catch (error) {
        if (cacheLifecycleGeneration !== generation) return;
        cacheGateway = null;
        cacheInitialized = false;
        throw error;
      }
    })();
  }

  const pending = cacheInitPromise;
  try {
    await pending;
  } finally {
    if (cacheInitPromise === pending) cacheInitPromise = null;
  }

  return getRevisionedDistributedBackend(cacheGateway) !== null;
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

function validateDependencyObservations(
  value: unknown,
): value is ReadonlyArray<DependencyResolutionObservation> {
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCY_OBSERVATIONS) {
    return false;
  }
  return value.every((observation) => {
    if (
      observation === null ||
      typeof observation !== "object" ||
      Array.isArray(observation)
    ) {
      return false;
    }
    const packageName = getOwnData(observation, "packageName");
    const declaration = getOwnData(observation, "declaration");
    return validateBoundedString(
      packageName,
      MAX_DEPENDENCY_OBSERVATION_FIELD_LENGTH,
    ) &&
      (declaration === null ||
        validateBoundedString(
          declaration,
          MAX_DEPENDENCY_OBSERVATION_FIELD_LENGTH,
          true,
        ));
  });
}

function cloneDependencyObservations(
  value?: ReadonlyArray<DependencyResolutionObservation>,
): ReadonlyArray<DependencyResolutionObservation> | undefined {
  if (value === undefined) return undefined;
  if (!validateDependencyObservations(value)) {
    throw new TypeError("Transform dependency observations are invalid");
  }
  return value.map((observation) => ({ ...observation }));
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
  const dependencyResolutionObservations = getOwnData(
    value,
    "dependencyResolutionObservations",
  );

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
  if (
    dependencyResolutionObservations !== undefined &&
    !validateDependencyObservations(dependencyResolutionObservations)
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
    ...(dependencyResolutionObservations === undefined ? {} : {
      dependencyResolutionObservations: cloneDependencyObservations(
        dependencyResolutionObservations,
      ),
    }),
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
      !validateBoundedString(entry.bundleManifestId, MAX_MANIFEST_ID_LENGTH)) ||
    (entry.dependencyResolutionObservations !== undefined &&
      !validateDependencyObservations(entry.dependencyResolutionObservations))
  ) {
    fallback.delete(key);
    return undefined;
  }
  return entry;
}

interface DecodedSharedTransformEntry {
  readonly entry?: TransformCacheEntry;
  readonly invalidReason?: string;
}

async function decodeSharedTransformEntry(
  raw: string,
): Promise<DecodedSharedTransformEntry> {
  const entry = parseStoredEntry(raw);
  if (!entry) return { invalidReason: "invalid payload" };
  if (await computeHash(entry.code) !== entry.codeHash) {
    return { invalidReason: "integrity mismatch" };
  }
  if (Date.now() >= entry.expiresAt) {
    return { invalidReason: "expired payload" };
  }

  let code: string;
  try {
    code = detokenizeAllCachePaths(entry.code);
  } catch {
    return { invalidReason: "invalid tokenized payload" };
  }
  if (!validateCode(code)) {
    return { invalidReason: "invalid detokenized payload" };
  }
  return { entry: { ...entry, code } };
}

async function getValidLocalEntryWithIntegrity(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  const local = getValidLocalEntry(key);
  if (!local) return undefined;
  if (local.codeHash && await computeHash(local.code) !== local.codeHash) {
    getLocalFallback().delete(key);
    return undefined;
  }
  return local;
}

async function conditionallyDiscardInvalidSharedEntry(
  backend: RevisionedCacheBackend,
  reservedKey: string,
  revision: string,
  keyLength: number,
  reason: string,
): Promise<void> {
  const deleted = requireCacheExchangeResult(
    await backend.compareExchange(reservedKey, revision, { kind: "delete" }),
  );
  if (!deleted) {
    logger.debug("Skipped stale invalid transform cleanup", {
      keyLength,
      reason,
    });
  }
}

export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  validateCacheKey(key);
  const gateway = getEffectiveCacheGateway();
  const backend = getRevisionedDistributedBackend(gateway);
  if (!backend) return await getValidLocalEntryWithIntegrity(key);

  const reservedKey = buildRevisionedCacheKey(key);
  let snapshot;
  try {
    snapshot = snapshotCacheRevisionResult(
      await backend.getWithRevision(reservedKey),
    );
  } catch (error) {
    logger.warn("Transform cache revision read failed", {
      keyLength: key.length,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }

  if (snapshot.value === null) {
    return await getValidLocalEntryWithIntegrity(key);
  }

  const decoded = await decodeSharedTransformEntry(snapshot.value);
  if (decoded.entry) return decoded.entry;

  getLocalFallback().delete(key);
  await conditionallyDiscardInvalidSharedEntry(
    backend,
    reservedKey,
    snapshot.revision,
    key.length,
    decoded.invalidReason ?? "invalid payload",
  );
  return undefined;
}

/**
 * Observe the shared revision before a transform may begin producing a write.
 * The returned permit is opaque and remains bound to this exact observation.
 *
 * @internal
 */
export async function observeCachedTransformForWrite(
  key: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<TransformCacheWriteObservation> {
  validateCacheKey(key);
  const ttl = resolveTransformTtl(ttlSeconds);
  const timestamp = Date.now();
  const deleteOnly = expiresImmediately(ttl);
  const expiresAtMs = deleteOnly ? timestamp : timestamp + Math.ceil(ttl * 1_000);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
    throw new RangeError("Transform cache deadline is invalid");
  }

  const gateway = getEffectiveCacheGateway();
  const backend = getRevisionedDistributedBackend(gateway);
  const reservedKey = backend ? buildRevisionedCacheKey(key) : null;
  // Registration is deliberately synchronous and precedes the first await.
  const state = registerTransformCacheWritePermit(
    key,
    backend,
    reservedKey,
    timestamp,
    expiresAtMs,
    deleteOnly,
  );

  try {
    if (!backend || !reservedKey) {
      if (deleteOnly) return Object.freeze({ permit: state.permit });
      const entry = await getValidLocalEntryWithIntegrity(key);
      if (!isCurrentTransformCacheWritePermit(state)) {
        return Object.freeze({ permit: state.permit });
      }
      return Object.freeze({
        ...(entry ? { entry } : {}),
        permit: state.permit,
      });
    }

    const snapshot = snapshotCacheRevisionResult(
      await backend.getWithRevision(reservedKey),
    );
    state.revision = snapshot.revision;
    if (!isCurrentTransformCacheWritePermit(state) || deleteOnly) {
      return Object.freeze({ permit: state.permit });
    }

    if (snapshot.value === null) {
      const entry = await getValidLocalEntryWithIntegrity(key);
      if (!isCurrentTransformCacheWritePermit(state)) {
        return Object.freeze({ permit: state.permit });
      }
      return Object.freeze({
        ...(entry ? { entry } : {}),
        permit: state.permit,
      });
    }

    const decoded = await decodeSharedTransformEntry(snapshot.value);
    if (!isCurrentTransformCacheWritePermit(state)) {
      return Object.freeze({ permit: state.permit });
    }
    return Object.freeze({
      ...(decoded.entry ? { entry: decoded.entry } : {}),
      permit: state.permit,
    });
  } catch (error) {
    invalidateTransformCacheWritePermit(state.permit);
    throw error;
  }
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
  dependencyResolutionObservations?: ReadonlyArray<DependencyResolutionObservation>,
): TransformCacheEntry {
  if (
    bundleManifestId !== undefined &&
    !validateBoundedString(bundleManifestId, MAX_MANIFEST_ID_LENGTH)
  ) {
    throw new TypeError("Transform bundle manifest ID is invalid");
  }
  const observations = cloneDependencyObservations(
    dependencyResolutionObservations,
  );
  return {
    formatVersion: TRANSFORM_CACHE_FORMAT_VERSION,
    code,
    hash,
    timestamp,
    expiresAt,
    ...(codeHash === undefined ? {} : { codeHash }),
    ...(bundleManifestId === undefined ? {} : { bundleManifestId }),
    ...(observations === undefined ? {} : { dependencyResolutionObservations: observations }),
  };
}

/**
 * Publish using the exact revision and deadline captured by a prior observation.
 *
 * @internal
 */
export async function publishCachedTransformWithPermit(
  permit: TransformCacheWritePermit,
  code: string,
  hash: string,
  bundleManifestId?: string,
  dependencyResolutionObservations?: ReadonlyArray<DependencyResolutionObservation>,
): Promise<boolean> {
  const state = requireTransformCacheWritePermit(permit);
  if (!isCurrentTransformCacheWritePermit(state)) return false;

  const fallback = getLocalFallback();
  if (state.deleteOnly) {
    fallback.delete(state.key);
    if (!state.backend || !state.reservedKey) {
      invalidateTransformCacheWritePermit(permit);
      return true;
    }
    if (state.revision === undefined) {
      invalidateTransformCacheWritePermit(permit);
      throw new TypeError("Transform cache publication permit has no observed revision");
    }

    try {
      const exchanged = requireCacheExchangeResult(
        await state.backend.compareExchange(
          state.reservedKey,
          state.revision,
          { kind: "delete" },
        ),
      );
      if (isCurrentTransformCacheWritePermit(state)) {
        fallback.delete(state.key);
        invalidateTransformCacheWritePermit(permit);
      }
      if (!exchanged) {
        logger.debug("Lost transform cache deletion", {
          keyLength: state.key.length,
        });
      }
      return exchanged;
    } catch (error) {
      invalidateTransformCacheWritePermit(permit);
      throw error;
    }
  }

  validateTransformPayload(code, hash);
  const localCodeHash = await computeHash(code);
  if (!isCurrentTransformCacheWritePermit(state)) return false;
  const localEntry = createEntry(
    code,
    hash,
    state.timestamp,
    state.expiresAtMs,
    localCodeHash,
    bundleManifestId,
    dependencyResolutionObservations,
  );

  if (!state.backend || !state.reservedKey) {
    if (Date.now() < state.expiresAtMs) fallback.set(state.key, localEntry);
    else fallback.delete(state.key);
    invalidateTransformCacheWritePermit(permit);
    return true;
  }
  if (state.revision === undefined) {
    invalidateTransformCacheWritePermit(permit);
    throw new TypeError("Transform cache publication permit has no observed revision");
  }

  try {
    const storedCode = tokenizeAllVeryFrontPaths(code);
    assertPortableCode(storedCode);
    const storedCodeHash = storedCode === code ? localCodeHash : await computeHash(storedCode);
    if (!isCurrentTransformCacheWritePermit(state)) return false;

    const storedEntry = createEntry(
      storedCode,
      hash,
      state.timestamp,
      state.expiresAtMs,
      storedCodeHash,
      bundleManifestId,
      dependencyResolutionObservations,
    ) as StoredTransformCacheEntry;
    const serialized = JSON.stringify(storedEntry);
    if (sizeEncoder.encode(serialized).byteLength > MAX_STORED_ENTRY_BYTES) {
      throw new RangeError("Serialized transform cache entry is too large");
    }
    if (!isCurrentTransformCacheWritePermit(state)) return false;

    const exchanged = requireCacheExchangeResult(
      await state.backend.compareExchange(
        state.reservedKey,
        state.revision,
        {
          kind: "set",
          value: serialized,
          expiresAtMs: state.expiresAtMs,
        },
      ),
    );

    if (isCurrentTransformCacheWritePermit(state)) {
      if (exchanged && Date.now() < state.expiresAtMs) {
        fallback.set(state.key, localEntry);
      } else {
        fallback.delete(state.key);
      }
      invalidateTransformCacheWritePermit(permit);
    }
    if (!exchanged) {
      logger.debug("Lost transform cache publication", {
        keyLength: state.key.length,
      });
    }
    return exchanged;
  } catch (error) {
    if (isCurrentTransformCacheWritePermit(state)) {
      if (Date.now() < state.expiresAtMs) fallback.set(state.key, localEntry);
      else fallback.delete(state.key);
      invalidateTransformCacheWritePermit(permit);
    }
    throw error;
  }
}

export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  bundleManifestId?: string,
  dependencyResolutionObservations?: ReadonlyArray<DependencyResolutionObservation>,
): Promise<void> {
  const observation = await observeCachedTransformForWrite(key, ttlSeconds);
  await publishCachedTransformWithPermit(
    observation.permit,
    code,
    hash,
    bundleManifestId,
    dependencyResolutionObservations,
  );
}

/**
 * Legacy synchronous writes are always process-local. Persisted entries require
 * an asynchronous revision observation and SHA-256 integrity digest.
 */
export function setCachedTransform(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): void {
  validateCacheKey(key);
  const ttl = resolveTransformTtl(ttlSeconds);
  const existingPermit = transformCacheWritePermitsByKey.get(key);
  if (existingPermit) invalidateTransformCacheWritePermit(existingPermit);

  const fallback = getLocalFallback();
  if (expiresImmediately(ttl)) {
    fallback.delete(key);
    return;
  }

  validateTransformPayload(code, hash);
  const timestamp = Date.now();
  fallback.set(
    key,
    createEntry(
      code,
      hash,
      timestamp,
      timestamp + Math.ceil(ttl * 1_000),
      undefined,
    ),
  );
}

export function destroyTransformCache(): void {
  cacheLifecycleGeneration++;
  invalidateAllTransformCacheWritePermits();
  getLocalFallback().clear();
  transformFlight = new Singleflight<TransformCacheResult>();
  transformProgress.clear();
  cacheGateway = null;
  cacheInitialized = false;
  cacheInitPromise = null;
}

export async function getDistributedTransformBackend(): Promise<RevisionedCacheBackend | null> {
  await initializeTransformCache();
  return getRevisionedDistributedBackend(getEffectiveCacheGateway());
}

interface TransformCacheResult {
  code: string;
  /** Bundle manifest ID if the cached entry has one. */
  bundleManifestId?: string;
  /** Inert unresolved dependency metadata used for authority-gated retries. */
  dependencyResolutionObservations?: ReadonlyArray<DependencyResolutionObservation>;
  /** Whether this was a cache hit */
  cacheHit: boolean;
}

/** Decide whether a cached transform is safe to reuse in the current runtime. */
export type TransformCachedEntryValidator = (
  entry: TransformCacheResult,
) => boolean | Promise<boolean>;

async function executeTransformFlight(
  key: string,
  computeFn: (reportProgress?: TransformProgressListener) => Promise<string>,
  ttlSeconds: number,
  mayPublish: () => boolean,
  validateCachedEntry?: TransformCachedEntryValidator,
  getDependencyResolutionObservations?: () => ReadonlyArray<DependencyResolutionObservation>,
): Promise<TransformCacheResult> {
  const progressFlight = beginTransformProgressFlight(key);
  const reportProgress: TransformProgressListener = (event) =>
    publishTransformProgress(key, progressFlight.state, event);
  const observation = await observeCachedTransformForWrite(key, ttlSeconds);
  let permitConsumed = false;

  try {
    const cached = observation.entry;
    if (cached) {
      if (UNRESOLVED_VF_MODULES_PATTERN.test(cached.code)) {
        const match = cached.code.match(UNRESOLVED_VF_MODULES_PATTERN);
        logger.warn("Cache contains unresolved _vf_modules import, recomputing", {
          keyLength: key.length,
          unresolvedImport: match?.[1]?.slice(0, 60),
        });
      } else {
        const cacheEntry: TransformCacheResult = {
          code: cached.code,
          bundleManifestId: cached.bundleManifestId,
          ...(cached.dependencyResolutionObservations === undefined ? {} : {
            dependencyResolutionObservations: cloneDependencyObservations(
              cached.dependencyResolutionObservations,
            ),
          }),
          cacheHit: true,
        };
        if (validateCachedEntry) {
          reportProgress({ phase: "transform-cache:validating" });
        }
        let cacheEntryValid = true;
        let cacheValidationError: string | undefined;
        if (validateCachedEntry) {
          try {
            cacheEntryValid = await validateCachedEntry(cacheEntry);
          } catch (error) {
            if (!isCanonicalNotFoundError(error)) throw error;
            cacheEntryValid = false;
            cacheValidationError = error instanceof Error ? error.message : String(error);
          }
        }
        if (cacheEntryValid) {
          releaseCachedTransformWritePermit(observation.permit);
          permitConsumed = true;
          logger.debug("Cache hit", { keyLength: key.length });
          reportProgress({ phase: "transform-cache:hit" });
          return cacheEntry;
        }
        logger.warn("Cached transform failed validation, recomputing", {
          keyLength: key.length,
          ...(cacheValidationError ? { error: cacheValidationError } : {}),
        });
        reportProgress({ phase: "transform-cache:invalidated" });
      }
    }

    logger.debug("Cache miss, computing", { keyLength: key.length });
    reportProgress({ phase: "transform-cache:miss" });
    const code = await computeFn(reportProgress);
    if (!validateCode(code)) {
      throw new RangeError("Computed transform is empty or exceeds the transform cache size limit");
    }
    const dependencyResolutionObservations = cloneDependencyObservations(
      getDependencyResolutionObservations?.(),
    );
    reportProgress({ phase: "transform-cache:computed" });

    if (mayPublish()) {
      const hash = await computeHash(code);
      if (mayPublish()) {
        await publishCachedTransformWithPermit(
          observation.permit,
          code,
          hash,
          undefined,
          dependencyResolutionObservations,
        );
        permitConsumed = true;
      } else {
        logger.debug("Skipped cache write from stale transform flight", {
          keyLength: key.length,
        });
      }
    } else {
      logger.debug("Skipped cache write from stale transform flight", {
        keyLength: key.length,
      });
    }

    return {
      code,
      cacheHit: false,
      ...(dependencyResolutionObservations === undefined
        ? {}
        : { dependencyResolutionObservations }),
    };
  } finally {
    if (!permitConsumed) {
      releaseCachedTransformWritePermit(observation.permit);
    }
    progressFlight.end();
  }
}

export async function getOrComputeTransform(
  key: string,
  computeFn: (reportProgress?: TransformProgressListener) => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  onProgress?: TransformProgressListener,
  signal?: AbortSignal,
  validateCachedEntry?: TransformCachedEntryValidator,
  getDependencyResolutionObservations?: () => ReadonlyArray<DependencyResolutionObservation>,
): Promise<TransformCacheResult> {
  signal?.throwIfAborted();
  validateCacheKey(key);
  const ttl = resolveTransformTtl(ttlSeconds);
  const flightRegistry = transformFlight;
  const alreadyInFlight = flightRegistry.has(key);
  if (!alreadyInFlight) {
    transformProgress.set(key, { listeners: new Set(), flights: 0 });
  }
  const unsubscribe = subscribeToTransformProgress(key, onProgress);

  try {
    let flight: Promise<TransformCacheResult>;
    if (!alreadyInFlight && flightRegistry.size >= MAX_INFLIGHT_TRANSFORMS) {
      logger.warn("Transform singleflight capacity reached; computing independently", {
        inflight: flightRegistry.size,
      });
      flight = executeTransformFlight(
        key,
        computeFn,
        ttl,
        () => transformFlight === flightRegistry,
        validateCachedEntry,
        getDependencyResolutionObservations,
      );
    } else {
      flight = flightRegistry.do(
        key,
        (control) =>
          executeTransformFlight(
            key,
            computeFn,
            ttl,
            () => transformFlight === flightRegistry && control.isCurrent(),
            validateCachedEntry,
            getDependencyResolutionObservations,
          ),
        {
          staleAfterMs: TRANSFORM_FLIGHT_STALE_EVICTION_MS,
          onStaleEvicted: () => {
            logger.warn("Evicted stalled transform-cache flight", {
              keyLength: key.length,
              timeoutMs: TRANSFORM_FLIGHT_STALE_EVICTION_MS,
            });
          },
        },
      );
    }

    // A caller timeout must detach that request without cancelling the shared
    // singleflight leader: another concurrent render may still depend on the
    // same cold transform, and completing it warms the cache for later work.
    return await waitForSharedPromise(flight, signal);
  } finally {
    unsubscribe();
  }
}
