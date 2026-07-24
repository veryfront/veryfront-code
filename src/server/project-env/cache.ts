/**
 * In-memory cache for project environment variables with TTL and request deduplication.
 *
 * @module server/project-env/cache
 */

import { createProjectEnvSnapshot, type ProjectEnvSnapshot } from "./snapshot.ts";

interface CacheEntry {
  environmentId: string;
  projectSlug: string;
  vars: ProjectEnvSnapshot;
  fetchedAtMs: number;
}

interface InflightEntry {
  environmentId: string;
  projectSlug: string;
  marker: object;
  promise: Promise<ProjectEnvSnapshot>;
}

type Fetcher = (
  environmentId: string,
  token: string,
  projectSlug: string,
  signal: AbortSignal,
) => Promise<ProjectEnvSnapshot>;

/** Max number of environments to cache. Evicts oldest entry when exceeded. */
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INFLIGHT = 100;
const DEFAULT_MAX_INFLIGHT_PER_PROJECT = 16;
const MAX_CACHE_IDENTITY_CHARS = 1_024;
const MAX_CACHE_ENTRIES = 10_000;
const MAX_CACHE_TTL_MS = 2_147_483_647;
const MAX_CACHE_TOKEN_CHARS = 16_384;
const MAX_FETCH_TIMEOUT_MS = 300_000;
const HEX_DIGITS = "0123456789abcdef";
const IntrinsicAbortController = AbortController;
const IntrinsicMap = Map;
const IntrinsicUint8Array = Uint8Array;
const MapPrototypeClear = Map.prototype.clear;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeEntries = Map.prototype.entries;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeKeys = Map.prototype.keys;
const MapPrototypeSet = Map.prototype.set;
const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const mapIteratorPrototype = Object.getPrototypeOf(new IntrinsicMap().keys());
const mapIteratorPrototypeNext = mapIteratorPrototype?.next;
const MathMin = Math.min;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectFreeze = Object.freeze;
const ReflectApply = Reflect.apply;
const SubtleCryptoPrototypeDigest = SubtleCrypto.prototype.digest;
const TextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const intrinsicSubtleCrypto = crypto.subtle;
const intrinsicTextEncoder = new TextEncoder();
const monotonicNow = performance.now.bind(performance);
const scheduleTimeout = globalThis.setTimeout;
const cancelTimeout = globalThis.clearTimeout;

if (!mapSizeGetter || typeof mapIteratorPrototypeNext !== "function") {
  throw new TypeError("Map intrinsics are unavailable");
}
const intrinsicMapSizeGetter = mapSizeGetter as () => number;
const intrinsicMapIteratorNext = mapIteratorPrototypeNext as () => IteratorResult<unknown>;

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapClear<K, V>(map: Map<K, V>): void {
  ReflectApply(MapPrototypeClear, map, []);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return ReflectApply(intrinsicMapSizeGetter, map, []) as number;
}

function mapEntries<K, V>(map: Map<K, V>): Iterator<[K, V]> {
  return ReflectApply(MapPrototypeEntries, map, []) as Iterator<[K, V]>;
}

function mapKeys<K, V>(map: Map<K, V>): Iterator<K> {
  return ReflectApply(MapPrototypeKeys, map, []) as Iterator<K>;
}

function iteratorNext<T>(iterator: Iterator<T>): IteratorResult<T> {
  return ReflectApply(intrinsicMapIteratorNext, iterator, []) as IteratorResult<T>;
}

export interface EnvironmentVariableCacheOptions {
  readonly fetchTimeoutMs?: number;
  readonly maxInflight?: number;
  readonly maxInflightPerProject?: number;
}

export type ProjectEnvCacheErrorCode =
  | "capacity-exceeded"
  | "fetch-timeout";

export class ProjectEnvCacheError extends Error {
  readonly code: ProjectEnvCacheErrorCode;
  readonly retryable = true;

  constructor(code: ProjectEnvCacheErrorCode, message: string) {
    super(message);
    this.name = "ProjectEnvCacheError";
    this.code = code;
  }
}

function requireCacheIdentity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CACHE_IDENTITY_CHARS ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${field} must be a non-empty string of at most ${MAX_CACHE_IDENTITY_CHARS} characters`,
    );
  }
  return value;
}

function requireCacheToken(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CACHE_TOKEN_CHARS ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `token must be a non-empty string of at most ${MAX_CACHE_TOKEN_CHARS} characters`,
    );
  }
  return value;
}

async function fingerprintToken(token: string): Promise<string> {
  const encoded = ReflectApply(
    TextEncoderPrototypeEncode,
    intrinsicTextEncoder,
    [requireCacheToken(token)],
  ) as Uint8Array;
  const digest = await ReflectApply(
    SubtleCryptoPrototypeDigest,
    intrinsicSubtleCrypto,
    ["SHA-256", encoded],
  ) as ArrayBuffer;
  const bytes = new IntrinsicUint8Array(digest);
  let fingerprint = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    fingerprint += HEX_DIGITS[byte >>> 4]! + HEX_DIGITS[byte & 0x0f]!;
  }
  return fingerprint;
}

function buildCacheKey(
  projectSlug: string,
  environmentId: string,
  tokenFingerprint: string,
): string {
  return `${projectSlug.length}:${projectSlug}${environmentId.length}:${environmentId}${tokenFingerprint}`;
}

function requireBoundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!NumberIsSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be ${minimum}-${maximum}`);
  }
  return value;
}

export class EnvironmentVariableCache {
  private cache = new IntrinsicMap<string, CacheEntry>();
  private inflight = new IntrinsicMap<string, InflightEntry>();
  private activeFetches = 0;
  private activeFetchesByProject = new IntrinsicMap<string, number>();
  private readonly fetcher: Fetcher;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly fetchTimeoutMs: number;
  private readonly maxInflight: number;
  private readonly maxInflightPerProject: number;

  constructor(
    fetcher: Fetcher,
    ttlMs = 60_000,
    maxEntries = DEFAULT_MAX_ENTRIES,
    options: EnvironmentVariableCacheOptions = {},
  ) {
    if (typeof fetcher !== "function") {
      throw new TypeError("Project environment fetcher must be a function");
    }
    if (!NumberIsSafeInteger(ttlMs) || ttlMs < 0 || ttlMs > MAX_CACHE_TTL_MS) {
      throw new RangeError(`Project environment cache TTL must be 0-${MAX_CACHE_TTL_MS} ms`);
    }
    if (
      !NumberIsSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      maxEntries > MAX_CACHE_ENTRIES
    ) {
      throw new RangeError(
        `Project environment cache size must be 1-${MAX_CACHE_ENTRIES} entries`,
      );
    }
    this.fetcher = fetcher;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.fetchTimeoutMs = requireBoundedInteger(
      options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      "Project environment fetch timeout",
      1,
      MAX_FETCH_TIMEOUT_MS,
    );
    this.maxInflight = requireBoundedInteger(
      options.maxInflight ?? DEFAULT_MAX_INFLIGHT,
      "Project environment global in-flight limit",
      1,
      MAX_CACHE_ENTRIES,
    );
    this.maxInflightPerProject = requireBoundedInteger(
      options.maxInflightPerProject ??
        MathMin(DEFAULT_MAX_INFLIGHT_PER_PROJECT, this.maxInflight),
      "Project environment per-project in-flight limit",
      1,
      this.maxInflight,
    );
  }

  async get(
    environmentId: string,
    token: string,
    projectSlug: string,
  ): Promise<ProjectEnvSnapshot> {
    const validProjectSlug = requireCacheIdentity(projectSlug, "projectSlug");
    const validEnvironmentId = requireCacheIdentity(environmentId, "environmentId");
    const cacheKey = buildCacheKey(
      validProjectSlug,
      validEnvironmentId,
      await fingerprintToken(token),
    );
    const cached = mapGet(this.cache, cacheKey);
    const now = monotonicNow();

    if (cached && now - cached.fetchedAtMs < this.ttlMs) {
      // Promote cache hits so bounded eviction is true least-recently-used,
      // rather than merely least-recently-fetched.
      mapDelete(this.cache, cacheKey);
      mapSet(this.cache, cacheKey, cached);
      return cached.vars;
    }

    // Deduplicate only within the exact project/environment capability.
    const existing = mapGet(this.inflight, cacheKey);
    if (existing) return existing.promise;

    this.admitFetch(validProjectSlug);
    // Construct fallible request state before reserving capacity.
    const controller = new IntrinsicAbortController();
    this.incrementActiveFetches(validProjectSlug);
    const marker = ObjectFreeze({});
    const promise = this.fetch(
      cacheKey,
      environmentId,
      token,
      projectSlug,
      marker,
      controller,
    );
    mapSet(this.inflight, cacheKey, {
      environmentId,
      projectSlug,
      marker,
      promise,
    });

    try {
      return await promise;
    } finally {
      if (mapGet(this.inflight, cacheKey)?.promise === promise) {
        mapDelete(this.inflight, cacheKey);
      }
    }
  }

  invalidate(environmentId?: string, projectSlug?: string): void {
    if (environmentId === undefined) {
      mapClear(this.cache);
      mapClear(this.inflight);
      return;
    }

    requireCacheIdentity(environmentId, "environmentId");
    if (projectSlug !== undefined) {
      requireCacheIdentity(projectSlug, "projectSlug");
    }

    const cacheEntries = mapEntries(this.cache);
    while (true) {
      const step = iteratorNext(cacheEntries);
      if (step.done) break;
      const cacheKey = step.value[0];
      const entry = step.value[1];
      if (
        entry.environmentId === environmentId &&
        (projectSlug === undefined || entry.projectSlug === projectSlug)
      ) {
        mapDelete(this.cache, cacheKey);
      }
    }
    const inflightEntries = mapEntries(this.inflight);
    while (true) {
      const step = iteratorNext(inflightEntries);
      if (step.done) break;
      const cacheKey = step.value[0];
      const entry = step.value[1];
      if (
        entry.environmentId === environmentId &&
        (projectSlug === undefined || entry.projectSlug === projectSlug)
      ) {
        mapDelete(this.inflight, cacheKey);
      }
    }
  }

  private async fetch(
    cacheKey: string,
    environmentId: string,
    token: string,
    projectSlug: string,
    marker: object,
    controller: AbortController,
  ): Promise<ProjectEnvSnapshot> {
    const work = this.performFetch(
      cacheKey,
      environmentId,
      token,
      projectSlug,
      marker,
      controller.signal,
    );
    // Capacity follows the underlying work rather than the deadline observed
    // by callers. A non-cooperative fetcher that ignores abort therefore keeps
    // its slot until it actually settles.
    void work.then(
      () => this.decrementActiveFetches(projectSlug),
      () => this.decrementActiveFetches(projectSlug),
    );

    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = scheduleTimeout(() => {
        const error = new ProjectEnvCacheError(
          "fetch-timeout",
          `Project environment fetch exceeded ${this.fetchTimeoutMs} ms`,
        );
        controller.abort(error);
        reject(error);
      }, this.fetchTimeoutMs);
    });

    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timeoutId !== undefined) cancelTimeout(timeoutId);
    }
  }

  private async performFetch(
    cacheKey: string,
    environmentId: string,
    token: string,
    projectSlug: string,
    marker: object,
    signal: AbortSignal,
  ): Promise<ProjectEnvSnapshot> {
    const fetched = await this.fetcher(
      environmentId,
      token,
      projectSlug,
      signal,
    );
    const vars = createProjectEnvSnapshot(fetched);
    if (mapGet(this.inflight, cacheKey)?.marker === marker) {
      // Delete before set to move refreshed entries to the end of Map iteration order,
      // ensuring eviction targets the least-recently-fetched entry (LRU behavior).
      mapDelete(this.cache, cacheKey);
      mapSet(this.cache, cacheKey, {
        environmentId,
        projectSlug,
        vars,
        fetchedAtMs: monotonicNow(),
      });
      this.evictIfNeeded();
    }
    return vars;
  }

  private admitFetch(projectSlug: string): void {
    if (this.activeFetches >= this.maxInflight) {
      throw new ProjectEnvCacheError(
        "capacity-exceeded",
        "Project environment fetch capacity is exhausted",
      );
    }
    if (
      (mapGet(this.activeFetchesByProject, projectSlug) ?? 0) >=
        this.maxInflightPerProject
    ) {
      throw new ProjectEnvCacheError(
        "capacity-exceeded",
        "Project environment fetch capacity for this project is exhausted",
      );
    }
  }

  private incrementActiveFetches(projectSlug: string): void {
    this.activeFetches += 1;
    mapSet(
      this.activeFetchesByProject,
      projectSlug,
      (mapGet(this.activeFetchesByProject, projectSlug) ?? 0) + 1,
    );
  }

  private decrementActiveFetches(projectSlug: string): void {
    this.activeFetches -= 1;
    const remaining = (mapGet(this.activeFetchesByProject, projectSlug) ?? 1) - 1;
    if (remaining === 0) mapDelete(this.activeFetchesByProject, projectSlug);
    else mapSet(this.activeFetchesByProject, projectSlug, remaining);
  }

  /** Evict oldest entries when cache exceeds maxEntries. */
  private evictIfNeeded(): void {
    const size = mapSize(this.cache);
    if (size <= this.maxEntries) return;
    // Map iterates in insertion order; delete the first (oldest) entries
    const excess = size - this.maxEntries;
    let removed = 0;
    const keys = mapKeys(this.cache);
    while (removed < excess) {
      const step = iteratorNext(keys);
      if (step.done) break;
      const key = step.value;
      mapDelete(this.cache, key);
      removed++;
    }
  }
}
