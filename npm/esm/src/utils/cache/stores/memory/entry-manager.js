import { LRUNode } from "./lru-node.js";
export class EntryManager {
    estimateSizeOf;
    constructor(estimateSizeOf) {
        this.estimateSizeOf = estimateSizeOf;
    }
    updateExistingEntry(node, value, ttlMs, tags, defaultTtlMs, listManager, tagIndex, key) {
        const oldSize = node.entry.size;
        const newSize = this.estimateSizeOf(value);
        const expiry = this.calculateExpiry(ttlMs, defaultTtlMs);
        if (node.entry.tags?.length) {
            this.cleanupTags(node.entry.tags, key, tagIndex);
        }
        node.entry = {
            value,
            size: newSize,
            expiry,
            tags,
            lastAccessed: Date.now(),
        };
        listManager.moveToFront(node);
        return newSize - oldSize;
    }
    createNewEntry(key, value, ttlMs, tags, defaultTtlMs, listManager, store) {
        const size = this.estimateSizeOf(value);
        const expiry = this.calculateExpiry(ttlMs, defaultTtlMs);
        const entry = {
            value,
            size,
            expiry,
            tags,
            lastAccessed: Date.now(),
        };
        const node = new LRUNode(key, entry);
        store.set(key, node);
        listManager.addToFront(node);
        return [node, size];
    }
    updateTagIndex(tags, key, tagIndex) {
        for (const tag of tags) {
            let set = tagIndex.get(tag);
            if (!set) {
                set = new Set();
                tagIndex.set(tag, set);
            }
            set.add(key);
        }
    }
    cleanupTags(tags, key, tagIndex) {
        for (const tag of tags) {
            const set = tagIndex.get(tag);
            if (!set)
                continue;
            set.delete(key);
            if (set.size === 0) {
                tagIndex.delete(tag);
            }
        }
    }
    calculateExpiry(ttlMs, defaultTtlMs) {
        if (typeof ttlMs === "number")
            return Date.now() + ttlMs;
        if (defaultTtlMs)
            return Date.now() + defaultTtlMs;
        return undefined;
    }
}
