export interface LRUOptions {
    maxEntries?: number;
    ttlMs?: number;
    cleanupIntervalMs?: number;
}
export declare class LRUCache<K, V> {
    private adapter;
    private cleanupTimer?;
    private cleanupIntervalMs;
    private ttlMs?;
    constructor(options?: LRUOptions);
    private startPeriodicCleanup;
    private stopCleanupTimer;
    private toStringKey;
    get size(): number;
    has(key: K): boolean;
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    clear(): void;
    cleanup(): void;
    destroy(): void;
    keys(): IterableIterator<K>;
}
//# sourceMappingURL=lru-wrapper.d.ts.map