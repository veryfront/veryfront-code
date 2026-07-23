import { serverLogger } from "../../logger/logger.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors/error-registry/server.ts";

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

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function invalidCacheState(detail: string): never {
  throw CACHE_INVARIANT_VIOLATION.create({ detail });
}

function resolveEvictionOptions(options: EvictionManagerOptions): EvictionManagerOptions {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    invalidArgument("Eviction manager options must be an object");
  }

  let onEvict: unknown;
  let loggerContext: unknown;
  try {
    onEvict = options.onEvict;
    loggerContext = options.loggerContext;
  } catch {
    invalidArgument("Eviction manager options must be readable");
  }

  if (onEvict !== undefined && typeof onEvict !== "function") {
    invalidArgument("Eviction manager onEvict must be a function");
  }
  if (loggerContext !== undefined && typeof loggerContext !== "string") {
    invalidArgument("Eviction manager loggerContext must be a string");
  }

  return {
    onEvict: onEvict as EvictionManagerOptions["onEvict"],
    loggerContext: loggerContext as string | undefined,
  };
}

function requireNonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalidArgument(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    invalidArgument(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateEvictionInputs<TEntry extends EvictableEntry>(
  cache: Map<string, TEntry>,
  lruTracker: LRUTrackerInterface,
  newEntrySize: number,
  maxSize: number,
  maxMemory: number,
): void {
  if (!(cache instanceof Map)) invalidArgument("Eviction cache must be a Map");
  if (lruTracker === null || typeof lruTracker !== "object") {
    invalidArgument("Eviction LRU tracker must be an object");
  }

  let getLRU: unknown;
  let remove: unknown;
  try {
    getLRU = lruTracker.getLRU;
    remove = lruTracker.remove;
  } catch {
    invalidArgument("Eviction LRU tracker must be readable");
  }
  if (typeof getLRU !== "function" || typeof remove !== "function") {
    invalidArgument("Eviction LRU tracker must implement getLRU and remove");
  }

  requireNonNegativeSafeInteger(newEntrySize, "Eviction newEntrySize");
  requirePositiveSafeInteger(maxSize, "Eviction maxSize");
  requirePositiveSafeInteger(maxMemory, "Eviction maxMemory");
}

export class EvictionManager<TEntry extends EvictableEntry> {
  private readonly onEvict?: (key: string, value: unknown) => void;

  constructor(options: EvictionManagerOptions = {}) {
    this.onEvict = resolveEvictionOptions(options).onEvict;
  }

  evictIfNeeded(
    cache: Map<string, TEntry>,
    lruTracker: LRUTrackerInterface,
    newEntrySize: number,
    maxSize: number,
    maxMemory: number,
  ): void {
    validateEvictionInputs(cache, lruTracker, newEntrySize, maxSize, maxMemory);

    while (cache.size >= maxSize) {
      const previousSize = cache.size;
      this.evictLRU(cache, lruTracker);
      if (cache.size >= previousSize) {
        invalidCacheState("LRU tracker could not evict an entry required by the count limit");
      }
    }

    let memoryUsed = 0;
    for (const entry of cache.values()) {
      const entrySize = requireNonNegativeSafeInteger(entry.size, "Eviction entry size");
      memoryUsed += entrySize;
      if (!Number.isSafeInteger(memoryUsed)) {
        invalidArgument("Eviction cache size total must be a non-negative safe integer");
      }
    }

    while (memoryUsed > maxMemory - newEntrySize && cache.size > 0) {
      const previousCacheSize = cache.size;
      const previousMemoryUsed = memoryUsed;
      memoryUsed -= this.evictLRU(cache, lruTracker);
      if (cache.size >= previousCacheSize && memoryUsed >= previousMemoryUsed) {
        invalidCacheState("LRU tracker could not evict an entry required by the memory limit");
      }
    }
  }

  evictLRU(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface): number {
    const keyToEvict = lruTracker.getLRU();
    if (keyToEvict === undefined) return 0;

    const entry = cache.get(keyToEvict);
    const size = entry?.size ?? 0;

    cache.delete(keyToEvict);
    lruTracker.remove(keyToEvict);

    if (entry) {
      try {
        this.onEvict?.(keyToEvict, entry.value);
      } catch (error) {
        logger.warn("onEvict callback threw during eviction", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
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

    const tags = node.entry.tags;
    if (tags) {
      this.cleanupTags(tags, node.key, tagIndex);
    }

    try {
      this.onEvict?.(node.key, node.entry.value);
    } catch (error) {
      logger.warn("onEvict callback threw during eviction", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }

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
      evicted++;
    }

    return evicted;
  }

  isExpired(entry: TEntry, ttl?: number, now: number = Date.now()): boolean {
    const expiry = entry.expiry;
    if (typeof expiry === "number") {
      return now > expiry;
    }

    const timestamp = entry.timestamp;
    if (typeof timestamp === "number" && typeof ttl === "number") {
      return now - timestamp > ttl;
    }

    return false;
  }
}
