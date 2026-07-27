import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  DATA_FETCHING_MAX_ENTRIES,
  DATA_FETCHING_MAX_ENTRIES_PER_PROJECT,
  DATA_FETCHING_MAX_SIZE_BYTES,
  DATA_FETCHING_MAX_SIZE_BYTES_PER_PROJECT,
  DATA_FETCHING_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";
import {
  getProjectScopedKey,
  isProjectScopedKeyCandidate,
  parseProjectScopedKey,
  runWithCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { normalizeRoutePathname } from "#veryfront/utils/route-pathname.ts";
import type { CacheEntry, DataContext } from "./types.ts";
import { requireDataProjectId } from "./project-identity.ts";

const DATA_CACHE_NAMESPACE = "veryfront:data:v3";
const ObjectFreeze = Object.freeze;

export interface DataCacheScope {
  projectId: string;
  mode: "production" | "preview";
  versionId: string;
}

export interface DataCacheMatchOptions {
  scope?: DataCacheScope;
  projectId?: string;
  pathname?: string;
  pattern?: string;
}

/**
 * Snapshot an untrusted or mutable cache scope into one immutable identity.
 *
 * Reading each field exactly once prevents accessors or proxies from assigning
 * admission, publication, and invalidation work to different tenants.
 */
export function snapshotDataCacheScope(
  scope: unknown,
): Readonly<DataCacheScope> {
  if (typeof scope !== "object" || scope === null) {
    throw new TypeError("Data cache scope must be an object");
  }

  const candidate = scope as Record<PropertyKey, unknown>;
  const projectId = candidate.projectId;
  const mode = candidate.mode;
  const versionId = candidate.versionId;
  const validatedProjectId = requireDataProjectId(
    projectId,
    "Data cache scope projectId",
  );
  if (mode !== "production" && mode !== "preview") {
    throw new TypeError("Data cache scope mode must be production or preview");
  }
  if (typeof versionId !== "string" || versionId.length === 0) {
    throw new TypeError("Data cache scope versionId must be a non-empty string");
  }

  return ObjectFreeze({ projectId: validatedProjectId, mode, versionId });
}

interface ParsedDataCacheKey extends DataCacheScope {
  namespace: string;
  modulePath: string;
  url: string;
  params: string;
}

interface FramedSegment {
  value: string;
  end: number;
}

interface ProjectCacheUsage {
  readonly entries: Map<string, number>;
  sizeBytes: number;
}

interface ProjectCacheMetadata {
  readonly projectId: string;
  readonly sizeBytes: number;
}

/** @internal Injectable limits are used by focused quota tests. */
export interface CacheManagerOptions {
  maxEntries?: number;
  maxSizeBytes?: number;
  maxEntriesPerProject?: number;
  maxSizeBytesPerProject?: number;
  ttlMs?: number;
  now?: () => number;
  /** Estimate the complete retained size for one original key and value. */
  estimateSizeOf?: (entry: CacheEntry, key: string) => number;
}

function readFramedSegment(value: string, offset: number): FramedSegment | null {
  const separator = value.indexOf(":", offset);
  if (separator < 0) return null;
  const lengthText = value.slice(offset, separator);
  if (!/^\d+$/.test(lengthText)) return null;
  const length = Number(lengthText);
  if (!Number.isSafeInteger(length) || String(length) !== lengthText) {
    return null;
  }
  const start = separator + 1;
  const end = start + length;
  if (end > value.length) return null;
  return { value: value.slice(start, end), end };
}

function parseFramedSegments(
  value: string,
  offset: number,
  count: number,
  decode: (segment: string) => string | null,
): string[] | null {
  const segments: string[] = [];
  for (let index = 0; index < count; index++) {
    const segment = readFramedSegment(value, offset);
    if (!segment) return null;
    const decoded = decode(segment.value);
    if (decoded === null) return null;
    segments.push(decoded);
    offset = segment.end;
    if (index < count - 1) {
      if (value[offset] !== "|") return null;
      offset++;
    }
  }
  return offset === value.length ? segments : null;
}

function parseDataCacheKey(key: string): ParsedDataCacheKey | null {
  const outer = parseProjectScopedKey(key);
  if (!outer || outer.prefix !== DATA_CACHE_NAMESPACE) return null;

  const resource = parseFramedSegments(
    outer.resourceKey,
    0,
    3,
    (segment) => segment,
  );
  if (!resource) return null;

  return {
    namespace: outer.prefix,
    projectId: outer.projectId,
    mode: outer.mode,
    versionId: outer.versionId,
    modulePath: resource[0]!,
    url: resource[1]!,
    params: resource[2]!,
  };
}

export function dataCacheKeyMatches(
  key: string,
  options: DataCacheMatchOptions = {},
): boolean {
  const suppliedScope = options.scope;
  const scope = suppliedScope === undefined ? undefined : snapshotDataCacheScope(suppliedScope);
  const projectId = options.projectId;
  const pathnameOption = options.pathname;
  const pattern = options.pattern;
  const parsed = parseDataCacheKey(key);
  if (!parsed) {
    // Preserve legacy/raw test and integration keys, but fail closed for a
    // malformed key that claims the framed v2 format.
    return !isProjectScopedKeyCandidate(key) &&
      scope === undefined &&
      projectId === undefined &&
      pathnameOption === undefined &&
      (pattern === undefined || key.includes(pattern));
  }

  if (
    scope &&
    (parsed.projectId !== scope.projectId ||
      parsed.mode !== scope.mode ||
      parsed.versionId !== scope.versionId)
  ) {
    return false;
  }
  if (
    projectId !== undefined &&
    parsed.projectId !== projectId
  ) {
    return false;
  }
  if (pathnameOption !== undefined) {
    let pathname: string;
    try {
      pathname = normalizeRoutePathname(new URL(parsed.url).pathname);
    } catch {
      return false;
    }
    if (pathname !== normalizeRoutePathname(pathnameOption)) return false;
  }
  if (pattern === undefined) return true;

  return [
    parsed.namespace,
    parsed.projectId,
    parsed.mode,
    parsed.versionId,
    parsed.modulePath,
    parsed.url,
    parsed.params,
  ].some((segment) => segment.includes(pattern));
}

function serializeParams(params: DataContext["params"]): string {
  const canonicalParams: DataContext["params"] = Object.create(null);
  for (const key of Object.keys(params).sort()) {
    canonicalParams[key] = params[key]!;
  }
  return JSON.stringify(canonicalParams);
}

function frameDataCacheKeySegment(value: string): string {
  return `${value.length}:${value}`;
}

function requireRetryDelay(retryDelayMs: number): void {
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError("Revalidation retry delay must be a non-negative safe integer");
  }
}

function requirePositiveSafeInteger(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${option} must be a non-negative safe integer`);
  }
  return value;
}

function requireProjectQuota(
  value: number,
  globalLimit: number,
  option: string,
): number {
  requirePositiveSafeInteger(value, option);
  if (value > globalLimit) {
    throw new RangeError(`${option} must not exceed its global cache limit`);
  }
  return value;
}

export class CacheManager {
  private readonly cache: LRUCache<string, CacheEntry>;
  private readonly maxEntriesPerProject: number;
  private readonly maxSizeBytesPerProject: number;
  private readonly projectUsage = new Map<string, ProjectCacheUsage>();
  private readonly projectMetadata = new Map<string, ProjectCacheMetadata>();
  private readonly revalidationRetryAt = new WeakMap<CacheEntry, number>();
  private readonly estimateSizeOf?: CacheManagerOptions["estimateSizeOf"];

  constructor(options: CacheManagerOptions = {}) {
    const maxEntries = requirePositiveSafeInteger(
      options.maxEntries ?? DATA_FETCHING_MAX_ENTRIES,
      "maxEntries",
    );
    const maxSizeBytes = requirePositiveSafeInteger(
      options.maxSizeBytes ?? DATA_FETCHING_MAX_SIZE_BYTES,
      "maxSizeBytes",
    );
    this.maxEntriesPerProject = requireProjectQuota(
      options.maxEntriesPerProject ??
        Math.min(DATA_FETCHING_MAX_ENTRIES_PER_PROJECT, maxEntries),
      maxEntries,
      "maxEntriesPerProject",
    );
    this.maxSizeBytesPerProject = requireProjectQuota(
      options.maxSizeBytesPerProject ??
        Math.min(DATA_FETCHING_MAX_SIZE_BYTES_PER_PROJECT, maxSizeBytes),
      maxSizeBytes,
      "maxSizeBytesPerProject",
    );
    this.estimateSizeOf = options.estimateSizeOf;
    this.cache = new LRUCache<string, CacheEntry>({
      maxEntries,
      maxSizeBytes,
      // LRUCache itself suppresses only the periodic cleanup timer in test or
      // embedded runtimes. Keeping the TTL here preserves lazy expiry on get.
      ttlMs: options.ttlMs ?? DATA_FETCHING_TTL_MS,
      now: options.now,
      onEvict: (key) => this.untrackProjectEntry(key),
    });
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key) ?? null;
    if (entry) this.touchProjectEntry(key);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    const parsed = parseDataCacheKey(key);
    if (!parsed && isProjectScopedKeyCandidate(key)) {
      throw new TypeError("Malformed or non-data project-scoped cache key");
    }
    const sizeBytes = this.estimateRetainedSize(key, entry);
    if (!parsed) {
      this.cache.cleanup();
      this.cache.set(key, entry, sizeBytes);
      return;
    }
    if (sizeBytes > this.maxSizeBytesPerProject) {
      throw new RangeError(
        `Data cache entry size ${sizeBytes} exceeds per-project byte limit ${this.maxSizeBytesPerProject}`,
      );
    }

    // Keep project accounting exact even when the periodic timer is disabled.
    this.cache.cleanup();
    const existing = this.projectMetadata.get(key);
    if (existing && existing.projectId !== parsed.projectId) {
      throw new Error("Data cache project ownership invariant violated");
    }

    const usage = this.projectUsage.get(parsed.projectId);
    let projectedEntries = (usage?.entries.size ?? 0) + (existing ? 0 : 1);
    let projectedSizeBytes = (usage?.sizeBytes ?? 0) -
      (existing?.sizeBytes ?? 0) + sizeBytes;
    const keysToEvict: string[] = [];

    if (
      projectedEntries > this.maxEntriesPerProject ||
      projectedSizeBytes > this.maxSizeBytesPerProject
    ) {
      for (const [candidate, candidateSize] of usage?.entries ?? []) {
        if (
          projectedEntries <= this.maxEntriesPerProject &&
          projectedSizeBytes <= this.maxSizeBytesPerProject
        ) {
          break;
        }
        if (candidate === key) continue;
        keysToEvict.push(candidate);
        projectedEntries--;
        projectedSizeBytes -= candidateSize;
      }
    }

    if (
      projectedEntries > this.maxEntriesPerProject ||
      projectedSizeBytes > this.maxSizeBytesPerProject
    ) {
      throw new Error("Unable to satisfy the configured per-project data cache quota");
    }

    this.cache.setWithEvictions(key, entry, keysToEvict, sizeBytes);
    if (existing) this.untrackProjectEntry(key);
    this.trackProjectEntry(key, parsed.projectId, sizeBytes);
  }

  private estimateRetainedSize(key: string, entry: CacheEntry): number {
    if (this.estimateSizeOf) {
      return requireNonNegativeSafeInteger(
        this.estimateSizeOf(entry, key),
        "estimateSizeOf result",
      );
    }

    const valueSizeBytes = this.cache.estimateSize(entry);
    const keySizeBytes = key.length * 2 + 16;
    return requireNonNegativeSafeInteger(
      valueSizeBytes + keySizeBytes,
      "Data cache retained size",
    );
  }

  private trackProjectEntry(
    key: string,
    projectId: string,
    sizeBytes: number,
  ): void {
    const usage = this.projectUsage.get(projectId) ?? {
      entries: new Map<string, number>(),
      sizeBytes: 0,
    };
    usage.entries.set(key, sizeBytes);
    usage.sizeBytes += sizeBytes;
    this.projectUsage.set(projectId, usage);
    this.projectMetadata.set(key, { projectId, sizeBytes });
  }

  private touchProjectEntry(key: string): void {
    const metadata = this.projectMetadata.get(key);
    if (!metadata) return;
    const usage = this.projectUsage.get(metadata.projectId);
    if (!usage || !usage.entries.has(key)) {
      throw new Error("Data cache project LRU accounting invariant violated");
    }
    usage.entries.delete(key);
    usage.entries.set(key, metadata.sizeBytes);
  }

  private untrackProjectEntry(key: string): void {
    const metadata = this.projectMetadata.get(key);
    if (!metadata) return;
    const usage = this.projectUsage.get(metadata.projectId);
    if (!usage || !usage.entries.has(key)) {
      throw new Error("Data cache project quota accounting invariant violated");
    }

    usage.entries.delete(key);
    usage.sizeBytes -= metadata.sizeBytes;
    this.projectMetadata.delete(key);
    if (usage.entries.size === 0) this.projectUsage.delete(metadata.projectId);
  }

  /**
   * Atomically replace one exact cache generation.
   *
   * JavaScript execution is synchronous between the identity comparison and
   * set, so an older background refresh cannot resurrect an evicted entry or
   * overwrite a newer cold load.
   */
  replaceIfCurrent(
    key: string,
    expected: CacheEntry | null,
    replacement: CacheEntry,
  ): boolean {
    const current = this.get(key);
    if (current !== expected) return false;
    this.set(key, replacement);
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  clearPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (!dataCacheKeyMatches(key, { pattern })) continue;
      this.cache.delete(key);
    }
  }

  clearScope(scope: DataCacheScope, pattern?: string): void {
    const snapshot = snapshotDataCacheScope(scope);
    for (const key of this.cache.keys()) {
      if (!dataCacheKeyMatches(key, { scope: snapshot, pattern })) continue;
      this.cache.delete(key);
    }
  }

  clearProject(projectId: string, pattern?: string): void {
    for (const key of this.cache.keys()) {
      if (!dataCacheKeyMatches(key, { projectId, pattern })) continue;
      this.cache.delete(key);
    }
  }

  clearRoute(scope: DataCacheScope, pathname: string): void {
    const snapshot = snapshotDataCacheScope(scope);
    for (const key of this.cache.keys()) {
      if (!dataCacheKeyMatches(key, { scope: snapshot, pathname })) continue;
      this.cache.delete(key);
    }
  }

  clearProjectRoute(projectId: string, pathname: string): void {
    for (const key of this.cache.keys()) {
      if (!dataCacheKeyMatches(key, { projectId, pathname })) continue;
      this.cache.delete(key);
    }
  }

  clearRouteAcrossScopes(pathname: string): void {
    for (const key of this.cache.keys()) {
      if (!dataCacheKeyMatches(key, { pathname })) continue;
      this.cache.delete(key);
    }
  }

  shouldRevalidate(entry: CacheEntry, now: number = Date.now()): boolean {
    if (entry.revalidate === false) return false;
    if (typeof entry.revalidate !== "number") return false;
    const retryAt = this.revalidationRetryAt.get(entry);
    if (retryAt !== undefined && now <= retryAt) return false;

    return now - entry.timestamp > entry.revalidate * 1000;
  }

  /**
   * Keep the last known-good value while moving its next eligible
   * revalidation time forward. This prevents a fast-failing loader from being
   * called once per incoming request during a dependency outage.
   */
  deferRevalidation(
    key: string,
    retryDelayMs: number,
    now: number = Date.now(),
  ): void {
    requireRetryDelay(retryDelayMs);
    const entry = this.get(key);
    if (!entry) return;
    if (typeof entry.revalidate !== "number") return;
    this.revalidationRetryAt.set(entry, now + retryDelayMs);
  }

  /**
   * Defer only when the exact stale generation is still current.
   */
  deferRevalidationIfCurrent(
    key: string,
    expected: CacheEntry,
    retryDelayMs: number,
    now: number = Date.now(),
  ): boolean {
    requireRetryDelay(retryDelayMs);
    if (this.get(key) !== expected) return false;
    if (typeof expected.revalidate !== "number") return false;
    this.revalidationRetryAt.set(expected, now + retryDelayMs);
    return true;
  }

  createCacheKey(
    context: DataContext,
    modulePath?: string,
    scope?: DataCacheScope | null,
  ): string | null {
    const snapshot = scope === undefined || scope === null ? scope : snapshotDataCacheScope(scope);
    const params = serializeParams(context.params);
    const moduleKey = modulePath === undefined || modulePath.length === 0 ? "page" : modulePath;
    const url = context.url.href;
    const resourceKey = [
      moduleKey,
      url,
      params,
    ].map(frameDataCacheKeySegment).join("|");

    // A dedicated namespace prevents ambiguous legacy keys from being reused
    // after the independently framed identity format ships.
    if (snapshot === null) return null;
    if (snapshot !== undefined) {
      return runWithCacheKeyContext(
        snapshot,
        () => getProjectScopedKey(DATA_CACHE_NAMESPACE, resourceKey),
      );
    }
    return getProjectScopedKey(DATA_CACHE_NAMESPACE, resourceKey);
  }

  destroy(): void {
    this.cache.destroy();
  }
}
