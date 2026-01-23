import type { CacheAdapter, LRUCacheOptions, LRUCacheStats, LRUEntry } from "./types.ts";
import { LRUNode } from "./lru-node.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { EvictionManager } from "../../eviction/eviction-manager.ts";
import { EntryManager } from "./entry-manager.ts";

// Depth limit for recursive size estimation to prevent stack overflow
const MAX_ESTIMATION_DEPTH = 10;

// Rough overhead per object/array for memory bookkeeping
const OBJECT_OVERHEAD_BYTES = 32;
const ARRAY_OVERHEAD_BYTES = 24;
const STRING_OVERHEAD_BYTES = 16;

/**
 * Estimate size of a value without JSON.stringify serialization.
 * Uses recursive traversal with depth limit for performance.
 * Accuracy is traded for speed - estimates are approximate.
 */
function estimateSizeRecursive(value: unknown, depth: number, seen: WeakSet<object>): number {
  if (value == null) return 0;

  // Primitive types - fast path
  const type = typeof value;
  if (type === "string") return (value as string).length * 2 + STRING_OVERHEAD_BYTES;
  if (type === "number" || type === "bigint") return 8;
  if (type === "boolean") return 4;

  // Binary data - exact size
  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
    return (value as Uint8Array).byteLength;
  }
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;

  // Depth limit reached - return rough estimate
  if (depth >= MAX_ESTIMATION_DEPTH) {
    return OBJECT_OVERHEAD_BYTES * 2;
  }

  // Objects/Arrays - recursive estimation with cycle detection
  if (type === "object") {
    // Cycle detection to prevent infinite loops
    if (seen.has(value as object)) return 0;
    seen.add(value as object);

    if (Array.isArray(value)) {
      let size = ARRAY_OVERHEAD_BYTES + value.length * 8; // 8 bytes per element pointer
      for (const item of value) {
        size += estimateSizeRecursive(item, depth + 1, seen);
      }
      return size;
    }

    // Plain object
    let size = OBJECT_OVERHEAD_BYTES;
    const obj = value as Record<string, unknown>;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        size += key.length * 2 + 8; // Key string + pointer overhead
        size += estimateSizeRecursive(obj[key], depth + 1, seen);
      }
    }
    return size;
  }

  // Functions and symbols - rough estimate
  return 64;
}

function defaultSizeEstimator(value: unknown): number {
  return estimateSizeRecursive(value, 0, new WeakSet());
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
    this.maxEntries = options.maxEntries || 1000;
    this.maxSizeBytes = options.maxSizeBytes || 50 * 1024 * 1024; // 50MB default
    this.defaultTtlMs = options.ttlMs;
    this.onEvict = options.onEvict;

    const estimateSizeOf = options.estimateSizeOf || defaultSizeEstimator;

    this.evictionManager = new EvictionManager({
      onEvict: this.onEvict,
      loggerContext: "MemoryCache",
    });
    this.entryManager = new EntryManager(estimateSizeOf);
  }

  get<T>(key: string): T | undefined {
    const node = this.store.get(key);
    if (!node) return undefined;

    if (this.evictionManager.isExpired(node.entry)) {
      this.delete(key);
      return undefined;
    }

    this.listManager.moveToFront(node);
    return node.entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void {
    const existingNode = this.store.get(key);

    if (existingNode) {
      const sizeDelta = this.entryManager.updateExistingEntry(
        existingNode,
        value,
        ttlMs,
        tags,
        this.defaultTtlMs,
        this.listManager,
        this.tagIndex,
        key,
      );
      this.currentSize += sizeDelta;
    } else {
      const [_node, size] = this.entryManager.createNewEntry(
        key,
        value,
        ttlMs,
        tags,
        this.defaultTtlMs,
        this.listManager,
        this.store,
      );
      this.currentSize += size;
    }

    if (tags?.length) {
      this.entryManager.updateTagIndex(tags, key, this.tagIndex);
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

    if (node.entry.tags) {
      this.entryManager.cleanupTags(node.entry.tags, key, this.tagIndex);
    }

    if (this.onEvict) {
      this.onEvict(key, node.entry.value);
    }
  }

  invalidateTag(tag: string): number {
    const set = this.tagIndex.get(tag);
    if (!set) return 0;

    let count = 0;
    for (const key of set) {
      this.delete(key);
      count++;
    }
    this.tagIndex.delete(tag);
    return count;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, node] of this.store) {
        this.onEvict(key, node.entry.value);
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
      if (typeof node.entry.expiry === "number" && now > node.entry.expiry) {
        this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}
