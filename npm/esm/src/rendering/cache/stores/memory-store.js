import * as dntShim from "../../../../_dnt.shims.js";
import { getDisableLruIntervalEnv } from "../../../config/env.js";
import { LRUCache } from "../../../utils/lru-wrapper.js";
/**
 * Default max entries for render cache.
 * Kept small (100) to conserve memory in ephemeral pods.
 * Most traffic should hit Redis; memory cache is for hot pages only.
 */
const DEFAULT_MAX_ENTRIES = 100;
export class MemoryCacheStore {
    cache;
    constructor(options = {}) {
        const disableIntervals = isLruIntervalDisabled();
        this.cache = new LRUCache({
            maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
            ttlMs: disableIntervals ? undefined : options.ttlMs,
        });
    }
    get(key) {
        return Promise.resolve(this.cache.get(key));
    }
    set(key, value) {
        this.cache.set(key, value);
        return Promise.resolve();
    }
    delete(key) {
        this.cache.delete(key);
        return Promise.resolve();
    }
    /**
     * Delete all entries with keys starting with the given prefix.
     * Used for per-project cache invalidation in multi-tenant deployments.
     */
    deleteByPrefix(prefix) {
        let deleted = 0;
        for (const key of this.cache.keys()) {
            if (!key.startsWith(prefix))
                continue;
            this.cache.delete(key);
            deleted++;
        }
        return Promise.resolve(deleted);
    }
    clear() {
        this.cache.clear();
        return Promise.resolve();
    }
    destroy() {
        this.cache.destroy();
        return Promise.resolve();
    }
}
function isLruIntervalDisabled() {
    const globalFlag = dntShim.dntGlobalThis.__vfDisableLruInterval === true;
    return globalFlag || getDisableLruIntervalEnv();
}
