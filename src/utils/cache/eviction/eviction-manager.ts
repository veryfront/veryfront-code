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
  prev: LRUNodeInterface<T> | null;
  next: LRUNodeInterface<T> | null;
}

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

  evictIfNeeded(
    cache: Map<string, TEntry>,
    lruTracker: LRUTrackerInterface,
    newEntrySize: number,
    maxSize: number,
    maxMemory: number,
  ): void {
    while (cache.size >= maxSize) {
      this.evictLRU(cache, lruTracker);
    }

    let memoryUsed = 0;
    for (const entry of cache.values()) {
      memoryUsed += entry.size;
    }

    while (memoryUsed + newEntrySize > maxMemory && cache.size > 0) {
      memoryUsed -= this.evictLRU(cache, lruTracker);
    }
  }

  evictLRU(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface): number {
    const keyToEvict = lruTracker.getLRU();
    if (!keyToEvict) return 0;

    const entry = cache.get(keyToEvict);
    const size = entry?.size ?? 0;

    cache.delete(keyToEvict);
    lruTracker.remove(keyToEvict);

    if (entry) {
      this.onEvict?.(keyToEvict, entry.value);
    }

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

    if (node.entry.tags) {
      this.cleanupTags(node.entry.tags, node.key, tagIndex);
    }

    this.onEvict?.(node.key, node.entry.value);

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

    while (store.size > maxEntries || size > maxSizeBytes) {
      if (!listManager.getTail()) break;
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
      evicted++;
    }

    return evicted;
  }

  isExpired(entry: TEntry, ttl?: number, now: number = Date.now()): boolean {
    if (typeof entry.expiry === "number") {
      return now > entry.expiry;
    }

    if (typeof entry.timestamp === "number" && typeof ttl === "number") {
      return now - entry.timestamp > ttl;
    }

    return false;
  }
}
