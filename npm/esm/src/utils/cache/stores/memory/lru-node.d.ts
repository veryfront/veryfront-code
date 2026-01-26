import type { LRUEntry } from "./types.js";
export declare class LRUNode<T> {
    key: string;
    entry: LRUEntry<T>;
    prev: LRUNode<T> | null;
    next: LRUNode<T> | null;
    constructor(key: string, entry: LRUEntry<T>, prev?: LRUNode<T> | null, next?: LRUNode<T> | null);
}
//# sourceMappingURL=lru-node.d.ts.map