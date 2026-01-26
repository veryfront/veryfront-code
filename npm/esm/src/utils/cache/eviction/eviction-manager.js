export class EvictionManager {
    onEvict;
    constructor(options = {}) {
        this.onEvict = options.onEvict;
    }
    evictIfNeeded(cache, lruTracker, newEntrySize, maxSize, maxMemory) {
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
    evictLRU(cache, lruTracker) {
        const keyToEvict = lruTracker.getLRU();
        if (!keyToEvict)
            return 0;
        const entry = cache.get(keyToEvict);
        const size = entry?.size ?? 0;
        cache.delete(keyToEvict);
        lruTracker.remove(keyToEvict);
        if (entry) {
            this.onEvict?.(keyToEvict, entry.value);
        }
        return size;
    }
    evictLRUFromList(listManager, store, tagIndex, currentSize) {
        const node = listManager.getTail();
        if (!node)
            return currentSize;
        listManager.removeNode(node);
        store.delete(node.key);
        if (node.entry.tags) {
            this.cleanupTags(node.entry.tags, node.key, tagIndex);
        }
        this.onEvict?.(node.key, node.entry.value);
        return currentSize - node.entry.size;
    }
    enforceMemoryLimits(listManager, store, tagIndex, currentSize, maxEntries, maxSizeBytes) {
        let size = currentSize;
        while (store.size > maxEntries || size > maxSizeBytes) {
            if (!listManager.getTail())
                break;
            size = this.evictLRUFromList(listManager, store, tagIndex, size);
        }
        return size;
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
    evictExpired(cache, lruTracker, ttl) {
        const now = Date.now();
        let evicted = 0;
        for (const [key, entry] of cache.entries()) {
            if (!this.isExpired(entry, ttl, now))
                continue;
            cache.delete(key);
            lruTracker.remove(key);
            evicted++;
        }
        return evicted;
    }
    isExpired(entry, ttl, now = Date.now()) {
        if (typeof entry.expiry === "number") {
            return now > entry.expiry;
        }
        if (typeof entry.timestamp === "number" && typeof ttl === "number") {
            return now - entry.timestamp > ttl;
        }
        return false;
    }
}
