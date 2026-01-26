/**
 * Deno KV-backed bundle manifest store
 *
 * This is a placeholder implementation. To enable KV support:
 * 1. Ensure Deno KV is available in your runtime
 * 2. Implement the actual KV operations
 *
 * For now, isAvailable() returns false, which triggers fallback to in-memory store.
 */
import type { BundleCode, BundleManifestStore, BundleMetadata } from "./bundle-manifest.js";
export interface KVBundleManifestStoreOptions {
    keyPrefix?: string;
}
export declare class KVBundleManifestStore implements BundleManifestStore {
    constructor(_options: KVBundleManifestStoreOptions);
    isAvailable(): Promise<boolean>;
    getBundleMetadata(_key: string): Promise<BundleMetadata | undefined>;
    setBundleMetadata(_key: string, _metadata: BundleMetadata, _ttlMs?: number): Promise<void>;
    getBundleCode(_hash: string): Promise<BundleCode | undefined>;
    setBundleCode(_hash: string, _code: BundleCode, _ttlMs?: number): Promise<void>;
    deleteBundle(_key: string): Promise<void>;
    invalidateSource(_source: string): Promise<number>;
    clear(): Promise<void>;
    getStats(): Promise<{
        totalBundles: number;
        totalSize: number;
        oldestBundle?: number;
        newestBundle?: number;
    }>;
}
//# sourceMappingURL=bundle-manifest-kv.d.ts.map