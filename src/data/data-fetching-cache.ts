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
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const ArrayIsArray = Array.isArray;
const ArrayBufferIsView = ArrayBuffer.isView;

const MAX_DATA_CACHE_ESTIMATION_DEPTH = 10;
const MAX_DATA_CACHE_ESTIMATION_NODES = 100_000;
const MAX_DATA_CACHE_BIGINT_BITS = 100_000n;
const MAX_DATA_CACHE_BIGINT_MAGNITUDE = 1n << MAX_DATA_CACHE_BIGINT_BITS;

const OBJECT_OVERHEAD_BYTES = 32;
const ARRAY_OVERHEAD_BYTES = 24;
const MAP_OVERHEAD_BYTES = 48;
const SET_OVERHEAD_BYTES = 40;
const STRING_OVERHEAD_BYTES = 16;
const BIGINT_OVERHEAD_BYTES = 16;
const SYMBOL_OVERHEAD_BYTES = 16;
const FUNCTION_REFERENCE_BYTES = 64;

const BigIntToString = BigInt.prototype.toString;
const SymbolDescriptionGetter = ObjectGetOwnPropertyDescriptor(
  Symbol.prototype,
  "description",
)?.get;
const ArrayBufferByteLengthGetter = ObjectGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const SharedArrayBufferByteLengthGetter = typeof SharedArrayBuffer === "function"
  ? ObjectGetOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")?.get
  : undefined;
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const TypedArrayBufferGetter = ObjectGetOwnPropertyDescriptor(
  TypedArrayPrototype,
  "buffer",
)?.get;
const TypedArrayLengthGetter = ObjectGetOwnPropertyDescriptor(
  TypedArrayPrototype,
  "length",
)?.get;
const DataViewBufferGetter = ObjectGetOwnPropertyDescriptor(
  DataView.prototype,
  "buffer",
)?.get;
const BlobSizeGetter = typeof Blob === "function"
  ? ObjectGetOwnPropertyDescriptor(Blob.prototype, "size")?.get
  : undefined;
const MapSizeGetter = ObjectGetOwnPropertyDescriptor(Map.prototype, "size")?.get;
const MapEntries = Map.prototype.entries;
const SetSizeGetter = ObjectGetOwnPropertyDescriptor(Set.prototype, "size")?.get;
const SetValues = Set.prototype.values;

interface DataCacheSizeEstimationState {
  readonly seen: WeakSet<object>;
  visited: number;
}

function throwUnsafeDataCacheEstimate(): never {
  throw new RangeError("Data cache value is too complex to estimate safely");
}

function retainDataCacheEstimationWork(
  state: DataCacheSizeEstimationState,
  amount = 1,
): void {
  if (
    !Number.isSafeInteger(amount) || amount < 0 ||
    amount > MAX_DATA_CACHE_ESTIMATION_NODES - state.visited
  ) {
    throwUnsafeDataCacheEstimate();
  }
  state.visited += amount;
}

function estimateSymbolSize(value: symbol): number {
  if (!SymbolDescriptionGetter) return SYMBOL_OVERHEAD_BYTES;
  const description = ReflectApply(SymbolDescriptionGetter, value, []) as
    | string
    | undefined;
  return SYMBOL_OVERHEAD_BYTES + (description?.length ?? 0) * 2;
}

function estimateBigIntSize(value: bigint): number {
  if (
    value <= -MAX_DATA_CACHE_BIGINT_MAGNITUDE ||
    value >= MAX_DATA_CACHE_BIGINT_MAGNITUDE
  ) {
    throwUnsafeDataCacheEstimate();
  }

  // Hex conversion is bounded by MAX_DATA_CACHE_BIGINT_BITS and uses a
  // captured intrinsic, so no application conversion hook can run.
  const hexadecimal = ReflectApply(BigIntToString, value, [16]) as string;
  const digits = hexadecimal[0] === "-" ? hexadecimal.length - 1 : hexadecimal.length;
  return BIGINT_OVERHEAD_BYTES + Math.ceil(digits / 2);
}

function propertyIdentitySize(key: PropertyKey): number {
  if (typeof key === "symbol") return estimateSymbolSize(key);
  const text = typeof key === "string" ? key : key.toString();
  return text.length * 2 + 8;
}

function tryApplyNumberGetter(
  getter: ((this: unknown) => unknown) | undefined,
  value: object,
): number | undefined {
  if (!getter) return undefined;
  try {
    const result = ReflectApply(getter, value, []);
    return typeof result === "number" && Number.isSafeInteger(result) && result >= 0
      ? result
      : undefined;
  } catch {
    return undefined;
  }
}

interface ArrayBufferViewBacking {
  readonly buffer: ArrayBufferLike;
  readonly typedArrayLength?: number;
}

function readArrayBufferViewBacking(value: ArrayBufferView): ArrayBufferViewBacking {
  let buffer: ArrayBufferLike | undefined;
  let typedArrayLength: number | undefined;
  if (TypedArrayBufferGetter) {
    try {
      buffer = ReflectApply(TypedArrayBufferGetter, value, []) as ArrayBufferLike;
    } catch {
      // A DataView does not carry the TypedArray internal slot.
    }
  }
  if (buffer !== undefined) {
    typedArrayLength = tryApplyNumberGetter(TypedArrayLengthGetter, value);
    if (typedArrayLength === undefined) throwUnsafeDataCacheEstimate();
  }
  if (buffer === undefined && DataViewBufferGetter) {
    try {
      buffer = ReflectApply(DataViewBufferGetter, value, []) as ArrayBufferLike;
    } catch {
      // ArrayBuffer.isView() promised one of these two native view brands.
    }
  }
  if (buffer === undefined) throwUnsafeDataCacheEstimate();
  return typedArrayLength === undefined ? { buffer } : { buffer, typedArrayLength };
}

function isTypedArrayIndex(key: PropertyKey, length: number): boolean {
  if (typeof key !== "string") return false;
  if (key === "0") return length > 0;
  const first = key.charCodeAt(0);
  if (first < 49 || first > 57) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < length && String(index) === key;
}

function estimateOwnProperties(
  value: object,
  depth: number,
  state: DataCacheSizeEstimationState,
  ignoredKeys: ReadonlySet<PropertyKey> = new Set(),
  ignoreKey?: (key: PropertyKey) => boolean,
): number {
  const keys = ReflectOwnKeys(value);
  retainDataCacheEstimationWork(state, keys.length);
  let size = 0;
  for (const key of keys) {
    if (ignoredKeys.has(key) || ignoreKey?.(key)) continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    size += propertyIdentitySize(key);
    if ("value" in descriptor) {
      size += estimateDataCacheValueSize(descriptor.value, depth + 1, state);
    } else {
      // Accessors are retained by reference. Never execute application code
      // merely because its containing result is considered for caching.
      if (descriptor.get) {
        size += estimateDataCacheValueSize(descriptor.get, depth + 1, state);
      }
      if (descriptor.set) {
        size += estimateDataCacheValueSize(descriptor.set, depth + 1, state);
      }
    }
  }
  return size;
}

function estimateRecognizedObjectSize(
  value: object,
  intrinsicSize: number,
  depth: number,
  state: DataCacheSizeEstimationState,
  ignoreKey?: (key: PropertyKey) => boolean,
): number {
  return intrinsicSize + estimateOwnProperties(
    value,
    depth,
    state,
    undefined,
    ignoreKey,
  );
}

function tryReadCollection<T>(
  value: object,
  sizeGetter: ((this: unknown) => unknown) | undefined,
  values: (this: unknown) => IterableIterator<T>,
): { size: number; values: IterableIterator<T> } | undefined {
  const size = tryApplyNumberGetter(sizeGetter, value);
  if (size === undefined) return undefined;
  try {
    return {
      size,
      values: ReflectApply(values, value, []) as IterableIterator<T>,
    };
  } catch {
    return undefined;
  }
}

function estimateDataCacheValueSize(
  value: unknown,
  depth: number,
  state: DataCacheSizeEstimationState,
): number {
  retainDataCacheEstimationWork(state);
  if (value == null) return 0;

  const type = typeof value;
  if (type === "string") return (value as string).length * 2 + STRING_OVERHEAD_BYTES;
  if (type === "number") return 8;
  if (type === "bigint") return estimateBigIntSize(value as bigint);
  if (type === "boolean") return 4;
  if (type === "symbol") return estimateSymbolSize(value as symbol);
  if (type !== "object" && type !== "function") return FUNCTION_REFERENCE_BYTES;

  const retainedObject = value as object;
  if (state.seen.has(retainedObject)) return 0;
  if (depth >= MAX_DATA_CACHE_ESTIMATION_DEPTH) throwUnsafeDataCacheEstimate();
  state.seen.add(retainedObject);

  if (type === "function") {
    return FUNCTION_REFERENCE_BYTES + estimateOwnProperties(
      retainedObject,
      depth,
      state,
    );
  }

  if (ArrayBufferIsView(value)) {
    const backing = readArrayBufferViewBacking(value);
    if (
      backing.typedArrayLength !== undefined &&
      backing.typedArrayLength > MAX_DATA_CACHE_ESTIMATION_NODES - state.visited
    ) {
      throwUnsafeDataCacheEstimate();
    }
    const backingSize = estimateDataCacheValueSize(
      backing.buffer,
      depth + 1,
      state,
    );
    const ignoreKey = backing.typedArrayLength === undefined
      ? undefined
      : (key: PropertyKey): boolean => isTypedArrayIndex(key, backing.typedArrayLength!);
    return backingSize + estimateOwnProperties(
      value,
      depth,
      state,
      undefined,
      ignoreKey,
    );
  }

  const arrayBufferBytes = tryApplyNumberGetter(ArrayBufferByteLengthGetter, value);
  if (arrayBufferBytes !== undefined) {
    return estimateRecognizedObjectSize(value, arrayBufferBytes, depth, state);
  }
  const sharedBufferBytes = tryApplyNumberGetter(
    SharedArrayBufferByteLengthGetter,
    value,
  );
  if (sharedBufferBytes !== undefined) {
    return estimateRecognizedObjectSize(value, sharedBufferBytes, depth, state);
  }
  const blobBytes = tryApplyNumberGetter(BlobSizeGetter, value);
  if (blobBytes !== undefined) {
    return estimateRecognizedObjectSize(value, blobBytes, depth, state);
  }

  if (ArrayIsArray(value)) {
    const lengthDescriptor = ObjectGetOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (!Number.isSafeInteger(length) || length < 0) throwUnsafeDataCacheEstimate();
    // Reject before enumerating a dense attacker-controlled array whose own
    // keys alone would exhaust the traversal budget.
    if (length > MAX_DATA_CACHE_ESTIMATION_NODES - state.visited) {
      throwUnsafeDataCacheEstimate();
    }
    return ARRAY_OVERHEAD_BYTES + length * 8 +
      estimateOwnProperties(value, depth, state, new Set<PropertyKey>(["length"]));
  }

  const map = tryReadCollection<[unknown, unknown]>(value, MapSizeGetter, MapEntries);
  if (map) {
    retainDataCacheEstimationWork(state, map.size);
    let size = MAP_OVERHEAD_BYTES + map.size * 16;
    for (const [key, child] of map.values) {
      size += estimateDataCacheValueSize(key, depth + 1, state);
      size += estimateDataCacheValueSize(child, depth + 1, state);
    }
    return size + estimateOwnProperties(value, depth, state);
  }

  const set = tryReadCollection<unknown>(value, SetSizeGetter, SetValues);
  if (set) {
    retainDataCacheEstimationWork(state, set.size);
    let size = SET_OVERHEAD_BYTES + set.size * 8;
    for (const child of set.values) {
      size += estimateDataCacheValueSize(child, depth + 1, state);
    }
    return size + estimateOwnProperties(value, depth, state);
  }

  return OBJECT_OVERHEAD_BYTES + estimateOwnProperties(value, depth, state);
}

function estimateDataCacheEntrySize(entry: CacheEntry): number {
  return estimateDataCacheValueSize(entry, 0, {
    seen: new WeakSet(),
    visited: 0,
  });
}

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

/**
 * The default byte quotas use a bounded insertion-time estimate of observable
 * own data and recognized backing storage. Entries remain reference-preserving,
 * so closure, prototype, Proxy, and engine-internal retention are not a hard
 * memory-security boundary. A restricted cacheability/snapshot contract would
 * be required for that stronger guarantee.
 *
 * @internal Injectable limits are used by focused quota tests.
 */
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
  private readonly maxSizeBytes: number;
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
    this.maxSizeBytes = maxSizeBytes;
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
      if (sizeBytes > this.maxSizeBytes) {
        throw new RangeError(
          `Cache entry size ${sizeBytes} exceeds maxSizeBytes ${this.maxSizeBytes}`,
        );
      }
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

    const valueSizeBytes = estimateDataCacheEntrySize(entry);
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

  /** Return a scoped key, or null when caching lacks scope or module identity. */
  createCacheKey(
    context: DataContext,
    modulePath?: string,
    scope?: DataCacheScope | null,
  ): string | null {
    const snapshot = scope === undefined || scope === null ? scope : snapshotDataCacheScope(scope);
    if (modulePath === undefined || modulePath.length === 0) return null;
    const params = serializeParams(context.params);
    const url = context.url.href;
    const resourceKey = [
      modulePath,
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
