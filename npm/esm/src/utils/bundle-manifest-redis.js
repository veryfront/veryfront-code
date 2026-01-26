/**
 * Redis-backed bundle manifest store
 *
 * This is a placeholder implementation. To enable Redis support:
 * 1. Install a Redis client (e.g., npm:redis or npm:ioredis)
 * 2. Implement the actual Redis operations
 *
 * For now, isAvailable() returns false, which triggers fallback to in-memory store.
 */
export class RedisBundleManifestStore {
    constructor(_options, _adapter) {
        // Redis client initialization would go here
    }
    isAvailable() {
        // Return false to trigger fallback to in-memory store
        // When Redis support is implemented, this should test the connection
        return Promise.resolve(false);
    }
    getBundleMetadata(_key) {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    setBundleMetadata(_key, _metadata, _ttlMs) {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    getBundleCode(_hash) {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    setBundleCode(_hash, _code, _ttlMs) {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    deleteBundle(_key) {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    invalidateSource(_source) {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    clear() {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
    getStats() {
        return Promise.reject(new Error("Redis bundle manifest store not implemented"));
    }
}
