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
export declare class EvictionManager<TEntry extends EvictableEntry> {
    private readonly onEvict?;
    constructor(options?: EvictionManagerOptions);
    evictIfNeeded(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface, newEntrySize: number, maxSize: number, maxMemory: number): void;
    evictLRU(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface): number;
    evictLRUFromList<T extends TEntry>(listManager: LRUListManagerInterface<T>, store: Map<string, LRUNodeInterface<T>>, tagIndex: Map<string, Set<string>>, currentSize: number): number;
    enforceMemoryLimits<T extends TEntry>(listManager: LRUListManagerInterface<T>, store: Map<string, LRUNodeInterface<T>>, tagIndex: Map<string, Set<string>>, currentSize: number, maxEntries: number, maxSizeBytes: number): number;
    private cleanupTags;
    evictExpired(cache: Map<string, TEntry>, lruTracker: LRUTrackerInterface, ttl: number): number;
    isExpired(entry: TEntry, ttl?: number, now?: number): boolean;
}
//# sourceMappingURL=eviction-manager.d.ts.map