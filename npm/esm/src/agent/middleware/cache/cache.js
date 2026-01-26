import * as dntShim from "../../../../_dnt.shims.js";
import { setActiveSpanAttributes, withSpan } from "../../../observability/tracing/otlp-setup.js";
function createCacheEntry(response, expiresAt) {
    const now = Date.now();
    return {
        response,
        cachedAt: now,
        expiresAt,
        accessCount: 0,
        lastAccessedAt: now,
    };
}
function markAccessed(entry) {
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
}
class MemoryCache {
    cache = new Map();
    set(key, response) {
        this.cache.set(key, createCacheEntry(response));
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        markAccessed(entry);
        return entry.response;
    }
    has(key) {
        return this.cache.has(key);
    }
    delete(key) {
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
}
class LRUCache {
    maxSize;
    cache = new Map();
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
    }
    set(key, response) {
        if (this.cache.has(key))
            this.cache.delete(key);
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined)
                this.cache.delete(firstKey);
        }
        this.cache.set(key, createCacheEntry(response));
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        this.cache.delete(key);
        markAccessed(entry);
        this.cache.set(key, entry);
        return entry.response;
    }
    has(key) {
        return this.cache.has(key);
    }
    delete(key) {
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
}
class TTLCache {
    cache = new Map();
    cleanupInterval = null;
    ttl;
    constructor(ttl = 300000) {
        this.ttl = ttl > 0 ? ttl : undefined;
        if (this.ttl !== undefined) {
            this.startCleanup();
        }
    }
    set(key, response) {
        const expiresAt = this.ttl !== undefined ? Date.now() + this.ttl : undefined;
        this.cache.set(key, createCacheEntry(response, expiresAt));
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        markAccessed(entry);
        return entry.response;
    }
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    delete(key) {
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.cache.clear();
    }
    startCleanup() {
        if (this.ttl === undefined)
            return;
        this.cleanupInterval = dntShim.setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.cache.entries()) {
                if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
                    this.cache.delete(key);
                }
            }
        }, 60000);
    }
}
function createCacheByStrategy(config) {
    if (config.strategy === "lru")
        return new LRUCache(config.maxSize ?? 100);
    if (config.strategy === "ttl")
        return new TTLCache(config.ttl ?? 300000);
    return new MemoryCache();
}
export function createCache(config) {
    const cache = createCacheByStrategy(config);
    const keyGenerator = config.keyGenerator ?? ((input) => `cache_${hashString(input)}`);
    function keyFor(input, context) {
        return keyGenerator(input, context);
    }
    return {
        get(input, context) {
            return cache.get(keyFor(input, context));
        },
        set(input, response, context) {
            cache.set(keyFor(input, context), response);
        },
        has(input, context) {
            return cache.has(keyFor(input, context));
        },
        delete(input, context) {
            cache.delete(keyFor(input, context));
        },
        clear() {
            cache.clear();
        },
        size() {
            return cache.size();
        },
    };
}
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash &= hash;
    }
    return Math.abs(hash).toString(36);
}
export function cacheMiddleware(config) {
    const cache = createCache(config);
    return (context, next) => withSpan("agent.middleware.cache", async () => {
        const inputString = typeof context.input === "string"
            ? context.input
            : JSON.stringify(context.input);
        const cached = cache.get(inputString, context);
        if (cached) {
            setActiveSpanAttributes({
                "cache.hit": true,
                "cache.strategy": config.strategy,
            });
            return {
                ...cached,
                metadata: {
                    ...cached.metadata,
                    fromCache: true,
                    cachedAt: Date.now(),
                },
            };
        }
        setActiveSpanAttributes({
            "cache.hit": false,
            "cache.strategy": config.strategy,
        });
        const result = await next();
        cache.set(inputString, result, context);
        return result;
    }, { "cache.strategy": config.strategy });
}
