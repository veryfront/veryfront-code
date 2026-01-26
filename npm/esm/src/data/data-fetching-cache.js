import * as dntShim from "../../_dnt.shims.js";
import { LRUCache } from "../utils/lru-wrapper.js";
import { DATA_FETCHING_MAX_ENTRIES, DATA_FETCHING_TTL_MS, } from "../utils/constants/cache.js";
import { getDisableLruIntervalEnv } from "../config/env.js";
import { getProjectScopedKey } from "../cache/cache-key-builder.js";
function isLruIntervalDisabled() {
    return dntShim.dntGlobalThis.__vfDisableLruInterval === true ||
        getDisableLruIntervalEnv();
}
export class CacheManager {
    cache = new LRUCache({
        maxEntries: DATA_FETCHING_MAX_ENTRIES,
        ttlMs: isLruIntervalDisabled() ? undefined : DATA_FETCHING_TTL_MS,
    });
    get(key) {
        return this.cache.get(key) ?? null;
    }
    set(key, entry) {
        this.cache.set(key, entry);
    }
    delete(key) {
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    clearPattern(pattern) {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }
    shouldRevalidate(entry) {
        if (entry.revalidate === false)
            return false;
        if (typeof entry.revalidate !== "number")
            return false;
        const age = Date.now() - entry.timestamp;
        return age > entry.revalidate * 1000;
    }
    createCacheKey(context) {
        const params = JSON.stringify(context.params);
        const resourceKey = `${context.url.pathname}::${params}`;
        return getProjectScopedKey("veryfront:data", resourceKey);
    }
}
