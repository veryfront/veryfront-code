import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import type { CacheAdapter, LRUCacheOptions, LRUCacheStats, LRUEntry } from "./types.ts";
import { LRUNode } from "./lru-node.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { EvictionManager } from "../../eviction/eviction-manager.ts";
import { EntryManager } from "./entry-manager.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";

const logger = serverLogger.component("cache");

const MAX_ESTIMATION_DEPTH = 10;
const MAX_ESTIMATION_NODES = 100_000;
const MAX_TAGS_PER_ENTRY = 100;
const MAX_TAG_CODE_UNITS = 256;
const MAX_KEY_CODE_UNITS = 16_384;

const OBJECT_OVERHEAD_BYTES = 32;
const ARRAY_OVERHEAD_BYTES = 24;
const MAP_OVERHEAD_BYTES = 48;
const SET_OVERHEAD_BYTES = 40;
const STRING_OVERHEAD_BYTES = 16;

function requirePositiveSafeInteger(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive safe integer`);
  }
  return value;
}

function requireCacheTtl(value: number, option: string): number {
  if (
    !Number.isFinite(value) || value <= 0 ||
    value > MAX_CACHE_TTL_MILLISECONDS
  ) {
    throw new RangeError(
      `${option} must be a positive finite number no greater than ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  return value;
}

interface SizeEstimationState {
  readonly seen: WeakSet<object>;
  visited: number;
}

function retainEstimationWork(state: SizeEstimationState, amount = 1): void {
  state.visited += amount;
  if (state.visited > MAX_ESTIMATION_NODES) {
    throw new RangeError("Cache value is too complex to estimate safely");
  }
}

function propertyIdentitySize(key: PropertyKey): number {
  return typeof key === "string" ? key.length * 2 + 8 : 16;
}

function estimateOwnProperties(
  value: object,
  depth: number,
  state: SizeEstimationState,
  ignoredKeys: ReadonlySet<PropertyKey> = new Set(),
): number {
  const keys = Reflect.ownKeys(value).filter((key) => !ignoredKeys.has(key));
  retainEstimationWork(state, keys.length);
  let size = 0;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    size += propertyIdentitySize(key);
    if ("value" in descriptor) {
      size += estimateSizeRecursive(descriptor.value, depth + 1, state);
    } else {
      // Accessors are retained as function references, but sizing must never
      // execute application code merely because a value is cached.
      size += 64;
    }
  }
  return size;
}

function estimateSizeRecursive(
  value: unknown,
  depth: number,
  state: SizeEstimationState,
): number {
  retainEstimationWork(state);
  if (value == null) return 0;

  const type = typeof value;

  if (type === "string") return (value as string).length * 2 + STRING_OVERHEAD_BYTES;
  if (type === "number" || type === "bigint") return 8;
  if (type === "boolean") return 4;

  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
    return value.byteLength;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;

  if (depth >= MAX_ESTIMATION_DEPTH) return OBJECT_OVERHEAD_BYTES * 2;
  if (type !== "object") return 64;

  if (state.seen.has(value)) return 0;
  state.seen.add(value);

  if (Array.isArray(value)) {
    return ARRAY_OVERHEAD_BYTES + value.length * 8 +
      estimateOwnProperties(value, depth, state, new Set<PropertyKey>(["length"]));
  }

  if (value instanceof Map) {
    retainEstimationWork(state, value.size);
    let size = MAP_OVERHEAD_BYTES + value.size * 16;
    const entries = Map.prototype.entries.call(value) as IterableIterator<[unknown, unknown]>;
    for (const [key, child] of entries) {
      size += estimateSizeRecursive(key, depth + 1, state);
      size += estimateSizeRecursive(child, depth + 1, state);
    }
    return size;
  }

  if (value instanceof Set) {
    retainEstimationWork(state, value.size);
    let size = SET_OVERHEAD_BYTES + value.size * 8;
    const values = Set.prototype.values.call(value) as IterableIterator<unknown>;
    for (const child of values) size += estimateSizeRecursive(child, depth + 1, state);
    return size;
  }

  return OBJECT_OVERHEAD_BYTES + estimateOwnProperties(value, depth, state);
}

function defaultSizeEstimator(value: unknown): number {
  return estimateSizeRecursive(value, 0, { seen: new WeakSet(), visited: 0 });
}

function validateKey(key: string): void {
  if (typeof key !== "string" || key.length > MAX_KEY_CODE_UNITS) {
    throw new RangeError(`Cache key must contain at most ${MAX_KEY_CODE_UNITS} characters`);
  }
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  if (!Array.isArray(tags)) throw new TypeError("Cache tags must be an array of strings");
  if (tags.length > MAX_TAGS_PER_ENTRY) {
    throw new RangeError(`Cache entries may have at most ${MAX_TAGS_PER_ENTRY} tags`);
  }

  const normalized = [...new Set(tags)];
  for (const tag of normalized) {
    if (
      typeof tag !== "string" ||
      tag.length === 0 ||
      tag.length > MAX_TAG_CODE_UNITS ||
      /\p{Cc}/u.test(tag)
    ) {
      throw new RangeError(
        `Cache tags must contain 1-${MAX_TAG_CODE_UNITS} characters without control characters`,
      );
    }
  }
  return normalized;
}

export class LRUCacheAdapter implements CacheAdapter {
  private readonly store = new Map<string, LRUNode<unknown>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly listManager = new LRUListManager<unknown>();
  private readonly evictionManager: EvictionManager<LRUEntry<unknown>>;
  private readonly entryManager: EntryManager;
  private currentSize = 0;
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private readonly defaultTtlMs?: number;
  private readonly onEvict?: (key: string, value: unknown) => void;

  constructor(options: LRUCacheOptions = {}) {
    this.maxEntries = requirePositiveSafeInteger(options.maxEntries ?? 1000, "maxEntries");
    this.maxSizeBytes = requirePositiveSafeInteger(
      options.maxSizeBytes ?? 50 * 1024 * 1024,
      "maxSizeBytes",
    );
    this.defaultTtlMs = options.ttlMs === undefined
      ? undefined
      : requireCacheTtl(options.ttlMs, "ttlMs");
    this.onEvict = options.onEvict;

    const estimateSizeOf = options.estimateSizeOf ?? defaultSizeEstimator;

    this.evictionManager = new EvictionManager({
      onEvict: this.onEvict,
      loggerContext: "MemoryCache",
    });
    this.entryManager = new EntryManager(estimateSizeOf);
  }

  private isExpired(entry: LRUEntry<unknown>, now = Date.now()): boolean {
    return typeof entry.expiry === "number" && now >= entry.expiry;
  }

  get<T>(key: string): T | undefined {
    const node = this.store.get(key);
    if (!node) return undefined;

    if (this.isExpired(node.entry)) {
      this.delete(key);
      return undefined;
    }

    this.listManager.moveToFront(node);
    return node.entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void {
    validateKey(key);
    if (ttlMs !== undefined) requireCacheTtl(ttlMs, "ttlMs");
    const normalizedTags = normalizeTags(tags);
    const existingNode = this.store.get(key);
    const valueSize = this.entryManager.estimateSize(value);
    if (valueSize > this.maxSizeBytes) {
      throw new RangeError(
        `Cache entry size ${valueSize} exceeds maxSizeBytes ${this.maxSizeBytes}`,
      );
    }

    if (existingNode) {
      this.currentSize += this.entryManager.updateExistingEntry(
        existingNode,
        value,
        ttlMs,
        normalizedTags,
        this.defaultTtlMs,
        this.listManager,
        this.tagIndex,
        key,
        valueSize,
      );
    } else {
      const [, size] = this.entryManager.createNewEntry(
        key,
        value,
        ttlMs,
        normalizedTags,
        this.defaultTtlMs,
        this.listManager,
        this.store,
        valueSize,
      );
      this.currentSize += size;
    }

    if (normalizedTags?.length) {
      this.entryManager.updateTagIndex(normalizedTags, key, this.tagIndex);
    }

    this.currentSize = this.evictionManager.enforceMemoryLimits(
      this.listManager,
      this.store,
      this.tagIndex,
      this.currentSize,
      this.maxEntries,
      this.maxSizeBytes,
    );
  }

  delete(key: string): void {
    const node = this.store.get(key);
    if (!node) return;

    this.listManager.removeNode(node);
    this.store.delete(key);
    this.currentSize -= node.entry.size;

    if (node.entry.tags) this.entryManager.cleanupTags(node.entry.tags, key, this.tagIndex);

    try {
      this.onEvict?.(key, node.entry.value);
    } catch (error) {
      logger.warn("onEvict callback threw during delete", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  invalidateTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;

    let count = 0;
    for (const key of keys) {
      this.delete(key);
      count++;
    }

    this.tagIndex.delete(tag);
    return count;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, node] of this.store) {
        try {
          this.onEvict(key, node.entry.value);
        } catch (error) {
          logger.warn("onEvict callback threw during clear", {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    this.store.clear();
    this.tagIndex.clear();
    this.listManager.clear();
    this.currentSize = 0;
  }

  getStats(): LRUCacheStats {
    return {
      entries: this.store.size,
      sizeBytes: this.currentSize,
      maxEntries: this.maxEntries,
      maxSizeBytes: this.maxSizeBytes,
      tags: this.tagIndex.size,
    };
  }

  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, node] of this.store) {
      if (!this.isExpired(node.entry, now)) continue;
      this.delete(key);
      cleaned++;
    }

    return cleaned;
  }

  *keys(): IterableIterator<string> {
    for (const [key, node] of this.store) {
      if (!this.isExpired(node.entry)) yield key;
    }
  }

  *entries<T>(): IterableIterator<[string, T]> {
    for (const [key, node] of this.store) {
      if (this.isExpired(node.entry)) continue;
      yield [key, node.entry.value as T];
    }
  }

  has(key: string): boolean {
    const node = this.store.get(key);
    if (!node) return false;

    if (this.isExpired(node.entry)) {
      this.delete(key);
      return false;
    }

    this.listManager.moveToFront(node);
    return true;
  }
}
