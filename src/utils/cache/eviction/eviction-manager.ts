import { serverLogger } from "../../logger/logger.ts";

const logger = serverLogger.component("cache");

export interface EvictableEntry {
  size: number;
  timestamp?: number;
  expiry?: number;
  value?: unknown;
  tags?: string[];
}

export interface LRUTrackerInterface {
  getLRU(): string | undefined;
  remove(key: string): void;
}

export interface LRUNodeInterface<T> {
  key: string;
  entry: T;
  prev: LUNodeInterface<T> | null;
  next: LUNodeInterface<T> | null;
}

type LUNodeInterface<T> = LRUNodeInterface<T>;

export interface LRUListManagerInterface<T> {
  getTail(): LRUNodeInterface<T> | null;
  removeNode(node: LRUNodeInterface<T>): void;
}

export interface EvictionManagerOptions {
  onEvict?: (key: string, value: unknown) => void;
  loggerContext?: string;
}

export class EvictionManager<TEntry extends EvictableEntry> {
  private readonly onEvict?: (key: string, value: unknown) => void;

  constructor(options: EvictionManagerOptions = {}) {
    this.onEvict = options.onEvict;
  }

  private notifyEviction(key: string, value: unknown): void {
    try {
      this.onEvict?.(key, value);
    } catch (error) {
      logger.warn("onEvict callback threw during eviction", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  evictIfNeeded(
    cache: Map<string, TEntry>,
    lruTracker: LRUTrackerInterface,
    newEntrySize: number,
    maxSize: number,
    maxMemory: number,
  ): void {
    if (!Number.isSafeInteger(newEntrySize) || newEntrySize < 0) {
      throw new RangeError("newEntrySize must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(maxSize) || maxSize <= 0) {
      throw new RangeError("maxSize must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxMemory) || maxMemory < 0) {
      throw new RangeError("maxMemory must be a non-negative safe integer");
    }
    if (newEntrySize > maxMemory) {
      throw new RangeError("newEntrySize cannot exceed maxMemory");
    }

    while (cache.size >= maxSize) {
      const previousSize = cache.size;
      this.evictLRU(cache, lruTracker);
      if (cache.size >= previousSize) {
        throw new Error("Unable to evict an entry from the LRU tracker");
      }
    }

    let memoryUsed = 0;
    for (const entry of cache.values()) {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new RangeError("Cache entry sizes must be non-negative safe integers");
      }
      memoryUsed += entry.size;
      if (!Number.isSafeInteger(memoryUsed)) {
        throw new RangeError("Cache memory usage exceeds the safe integer range");
      }
    }

    while (memoryUsed + newEntrySize > maxMemory && cache.size > 0) {
      const previousSize = cache.size;
      const evictedSize = this.evictLRU(cache, lruTracker);
      if (cache.size >= previousSize) {
        throw new Error("Unable to evict an entry from the LRU tracker");
      }
      memoryUsed -= evictedSize;
    }
  }

  evictLRU(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface): number {
    const keyToEvict = lruTracker.getLRU();
    if (keyToEvict === undefined) return 0;

    const entry = cache.get(keyToEvict);
    const size = entry?.size ?? 0;

    cache.delete(keyToEvict);
    lruTracker.remove(keyToEvict);

    if (entry) this.notifyEviction(keyToEvict, entry.value);

    return size;
  }

  evictLRUFromList<T extends TEntry>(
    listManager: LRUListManagerInterface<T>,
    store: Map<string, LRUNodeInterface<T>>,
    tagIndex: Map<string, Set<string>>,
    currentSize: number,
  ): number {
    const node = listManager.getTail();
    if (!node) return currentSize;

    listManager.removeNode(node);
    store.delete(node.key);

    const tags = node.entry.tags;
    if (tags) {
      this.cleanupTags(tags, node.key, tagIndex);
    }

    this.notifyEviction(node.key, node.entry.value);

    return currentSize - node.entry.size;
  }

  enforceMemoryLimits<T extends TEntry>(
    listManager: LRUListManagerInterface<T>,
    store: Map<string, LRUNodeInterface<T>>,
    tagIndex: Map<string, Set<string>>,
    currentSize: number,
    maxEntries: number,
    maxSizeBytes: number,
  ): number {
    let size = currentSize;

    while ((store.size > maxEntries || size > maxSizeBytes) && listManager.getTail()) {
      size = this.evictLRUFromList(listManager, store, tagIndex, size);
    }

    return size;
  }

  private cleanupTags(tags: string[], key: string, tagIndex: Map<string, Set<string>>): void {
    for (const tag of tags) {
      const set = tagIndex.get(tag);
      if (!set) continue;

      set.delete(key);
      if (set.size === 0) {
        tagIndex.delete(tag);
      }
    }
  }

  evictExpired(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface, ttl: number): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of cache.entries()) {
      if (!this.isExpired(entry, ttl, now)) continue;

      cache.delete(key);
      lruTracker.remove(key);
      this.notifyEviction(key, entry.value);
      evicted++;
    }

    return evicted;
  }

  isExpired(entry: TEntry, ttl?: number, now: number = Date.now()): boolean {
    const expiry = entry.expiry;
    if (typeof expiry === "number") {
      return now >= expiry;
    }

    const timestamp = entry.timestamp;
    if (typeof timestamp === "number" && typeof ttl === "number") {
      return now - timestamp >= ttl;
    }

    return false;
  }
}
