import type { CacheAdapter, LRUCacheOptions, LRUCacheStats, LRUEntry } from "./types.ts";
import { LRUNode } from "./lru-node.ts";
import { LRUListManager } from "./lru-list-manager.ts";
import { EvictionManager } from "../../eviction/eviction-manager.ts";
import { EntryManager } from "./entry-manager.ts";

const MAX_ESTIMATION_DEPTH = 10;

const OBJECT_OVERHEAD_BYTES = 32;
const ARRAY_OVERHEAD_BYTES = 24;
const STRING_OVERHEAD_BYTES = 16;

function estimateSizeRecursive(value: unknown, depth: number, seen: WeakSet<object>): number {
  if (value == null) return 0;

  const type = typeof value;

  if (type === "string") return (value as string).length * 2 + STRING_OVERHEAD_BYTES;
  if (type === "number" || type === "bigint") return 8;
  if (type === "boolean") return 4;

  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;

  if (depth >= MAX_ESTIMATION_DEPTH) return OBJECT_OVERHEAD_BYTES * 2;
  if (type !== "object") return 64;

  if (seen.has(value)) return 0;
  seen.add(value);

  if (Array.isArray(value)) {
    let size = ARRAY_OVERHEAD_BYTES + value.length * 8;
    for (const item of value) {
      size += estimateSizeRecursive(item, depth + 1, seen);
    }
    return size;
  }

  let size = OBJECT_OVERHEAD_BYTES;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    size += key.length * 2 + 8;
    size += estimateSizeRecursive((value as Record<string, unknown>)[key], depth + 1, seen);
  }
  return size;
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
    this.maxSizeBytes = options.maxSizeBytes || 50 * 1024 * 1024;
    this.defaultTtlMs = options.ttlMs;
    this.onEvict = options.onEvict;

    const estimateSizeOf = options.estimateSizeOf ?? defaultSizeEstimator;

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
      this.currentSize += this.entryManager.updateExistingEntry(
        existingNode,
        value,
        ttlMs,
        tags,
        this.defaultTtlMs,
        this.listManager,
        this.tagIndex,
        key,
      );
    } else {
      const [, size] = this.entryManager.createNewEntry(
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

    if (tags?.length) this.entryManager.updateTagIndex(tags, key, this.tagIndex);

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

    this.onEvict?.(key, node.entry.value);
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
      if (typeof node.entry.expiry !== "number" || now <= node.entry.expiry) continue;
      this.delete(key);
      cleaned++;
    }

    return cleaned;
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  *entries<T>(): IterableIterator<[string, T]> {
    for (const [key, node] of this.store) {
      if (!this.evictionManager.isExpired(node.entry)) {
        yield [key, node.entry.value as T];
      }
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}
