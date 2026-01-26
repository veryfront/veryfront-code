import type { LRUNode } from "./lru-node.js";
export declare class LRUListManager<T> {
    private head;
    private tail;
    getHead(): LRUNode<T> | null;
    getTail(): LRUNode<T> | null;
    moveToFront(node: LRUNode<T>): void;
    addToFront(node: LRUNode<T>): void;
    removeNode(node: LRUNode<T>): void;
    clear(): void;
}
//# sourceMappingURL=lru-list-manager.d.ts.map