import * as dntShim from "../../_dnt.shims.js";
import { LRUCacheAdapter } from "./cache/stores/memory/lru-cache-adapter.js";
import { DEFAULT_LRU_MAX_ENTRIES } from "./index.js";
import { unrefTimer } from "../platform/compat/process.js";
import { getDisableLruIntervalEnv } from "../config/env.js";
export class LRUCache {
    adapter;
    cleanupTimer;
    cleanupIntervalMs;
    ttlMs;
    constructor(options = {}) {
        const adapterOptions = {
            maxEntries: options.maxEntries ?? DEFAULT_LRU_MAX_ENTRIES,
            ttlMs: options.ttlMs,
        };
        this.adapter = new LRUCacheAdapter(adapterOptions);
        this.ttlMs = options.ttlMs;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
        if (this.ttlMs && this.ttlMs > 0) {
            this.startPeriodicCleanup();
        }
    }
    startPeriodicCleanup() {
        if (shouldDisableInterval()) {
            return;
        }
        this.stopCleanupTimer();
        const timer = dntShim.setInterval(() => {
            this.adapter.cleanupExpired();
        }, this.cleanupIntervalMs);
        this.cleanupTimer = timer;
        // Unref the timer so it doesn't prevent process exit or cause test leaks
        unrefTimer(timer);
    }
    stopCleanupTimer() {
        if (!this.cleanupTimer) {
            return;
        }
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
    }
    toStringKey(key) {
        return typeof key === "string" ? key : String(key);
    }
    get size() {
        return this.adapter.getStats().entries;
    }
    has(key) {
        return this.adapter.get(this.toStringKey(key)) !== undefined;
    }
    get(key) {
        return this.adapter.get(this.toStringKey(key));
    }
    set(key, value) {
        this.adapter.set(this.toStringKey(key), value);
    }
    delete(key) {
        const stringKey = this.toStringKey(key);
        const had = this.adapter.get(stringKey) !== undefined;
        this.adapter.delete(stringKey);
        return had;
    }
    clear() {
        this.adapter.clear();
    }
    cleanup() {
        this.adapter.cleanupExpired();
    }
    destroy() {
        this.stopCleanupTimer();
        this.adapter.clear();
    }
    keys() {
        return this.adapter.keys();
    }
}
function shouldDisableInterval() {
    if (dntShim.dntGlobalThis.__vfDisableLruInterval === true) {
        return true;
    }
    try {
        return getDisableLruIntervalEnv();
    }
    catch {
        return false;
    }
}
