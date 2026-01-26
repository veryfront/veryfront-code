/**
 * In-Memory Token Cache - single-instance deployments.
 */
import * as dntShim from "../../_dnt.shims.js";
import { withSpan } from "../tracing.js";
const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_CLEANUP_INTERVAL = 60_000;
export class MemoryCache {
    cache = new Map();
    hits = 0;
    misses = 0;
    maxSize;
    cleanupTimer = null;
    constructor(options = {}) {
        this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
        const interval = options.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
        this.cleanupTimer = dntShim.setInterval(() => this.cleanup(), interval);
    }
    get(key) {
        return withSpan("cache.memory.get", async () => {
            const entry = this.cache.get(key);
            if (!entry) {
                this.misses++;
                return null;
            }
            if (Date.now() >= entry.expiresAt) {
                this.cache.delete(key);
                this.misses++;
                return null;
            }
            this.hits++;
            return entry;
        }, { "cache.key": key });
    }
    set(key, entry) {
        return withSpan("cache.memory.set", async () => {
            if (this.cache.size >= this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) {
                    this.cache.delete(firstKey);
                }
            }
            this.cache.set(key, entry);
        }, { "cache.key": key });
    }
    delete(key) {
        return withSpan("cache.memory.delete", async () => {
            this.cache.delete(key);
        }, { "cache.key": key });
    }
    clear() {
        return withSpan("cache.memory.clear", async () => {
            this.cache.clear();
            this.hits = 0;
            this.misses = 0;
        });
    }
    has(key) {
        return withSpan("cache.memory.has", async () => {
            const entry = this.cache.get(key);
            if (!entry)
                return false;
            if (Date.now() >= entry.expiresAt) {
                this.cache.delete(key);
                return false;
            }
            return true;
        }, { "cache.key": key });
    }
    stats() {
        return withSpan("cache.memory.stats", async () => ({
            hits: this.hits,
            misses: this.misses,
            size: this.cache.size,
            type: "memory",
        }));
    }
    close() {
        return withSpan("cache.memory.close", async () => {
            if (this.cleanupTimer) {
                clearInterval(this.cleanupTimer);
                this.cleanupTimer = null;
            }
            this.cache.clear();
        });
    }
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (now >= entry.expiresAt) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[MemoryCache] Cleaned ${cleaned} expired entries`);
        }
    }
}
