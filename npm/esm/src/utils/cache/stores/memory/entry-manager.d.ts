import { LRUNode } from "./lru-node.js";
import type { LRUListManager } from "./lru-list-manager.js";
export declare class EntryManager {
    private readonly estimateSizeOf;
    constructor(estimateSizeOf: (value: unknown) => number);
    updateExistingEntry<T>(node: LRUNode<unknown>, value: T, ttlMs: number | undefined, tags: string[] | undefined, defaultTtlMs: number | undefined, listManager: LRUListManager<unknown>, tagIndex: Map<string, Set<string>>, key: string): number;
    createNewEntry<T>(key: string, value: T, ttlMs: number | undefined, tags: string[] | undefined, defaultTtlMs: number | undefined, listManager: LRUListManager<unknown>, store: Map<string, LRUNode<unknown>>): [LRUNode<unknown>, number];
    updateTagIndex(tags: string[], key: string, tagIndex: Map<string, Set<string>>): void;
    cleanupTags(tags: string[], key: string, tagIndex: Map<string, Set<string>>): void;
    private calculateExpiry;
}
//# sourceMappingURL=entry-manager.d.ts.map