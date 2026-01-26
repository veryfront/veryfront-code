/**
 * Deno KV-backed bundle manifest store
 *
 * This is a placeholder implementation. To enable KV support:
 * 1. Ensure Deno KV is available in your runtime
 * 2. Implement the actual KV operations
 *
 * For now, isAvailable() returns false, which triggers fallback to in-memory store.
 */
export class KVBundleManifestStore {
    constructor(_options) {
        // Deno KV initialization would go here
    }
    isAvailable() {
        // Return false to trigger fallback to in-memory store
        // When KV support is implemented, this should test if Deno.openKv() works
        return Promise.resolve(false);
    }
    getBundleMetadata(_key) {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    setBundleMetadata(_key, _metadata, _ttlMs) {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    getBundleCode(_hash) {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    setBundleCode(_hash, _code, _ttlMs) {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    deleteBundle(_key) {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    invalidateSource(_source) {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    clear() {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
    getStats() {
        return Promise.reject(new Error("KV bundle manifest store not implemented"));
    }
}
