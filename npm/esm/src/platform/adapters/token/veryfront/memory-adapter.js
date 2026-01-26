/**
 * In-Memory Token Storage Adapter
 *
 * Development-only adapter that stores tokens in memory.
 * Tokens are lost when the process restarts.
 */
import * as dntShim from "../../../../../_dnt.shims.js";
import { logger } from "../../../../utils/index.js";
const STORAGE_KEY = "__veryfront_token_storage__";
const globalStore = dntShim.dntGlobalThis;
export class MemoryTokenAdapter {
    storage;
    constructor() {
        globalStore[STORAGE_KEY] ??= new Map();
        this.storage = globalStore[STORAGE_KEY];
        logger.warn("[MemoryTokenAdapter] Using in-memory storage. " +
            "Tokens will be lost on restart. " +
            "Configure Veryfront Cloud for production.");
    }
    initialize() {
        return Promise.resolve();
    }
    get(key) {
        return Promise.resolve(this.storage.get(key) ?? null);
    }
    set(key, value) {
        this.storage.set(key, value);
        return Promise.resolve();
    }
    delete(key) {
        this.storage.delete(key);
        return Promise.resolve();
    }
    list(prefix) {
        const keys = Array.from(this.storage.keys());
        return Promise.resolve(prefix ? keys.filter((k) => k.startsWith(prefix)) : keys);
    }
    dispose() {
        logger.debug("[MemoryTokenAdapter] Disposed");
    }
    get size() {
        return this.storage.size;
    }
    clear() {
        this.storage.clear();
    }
}
