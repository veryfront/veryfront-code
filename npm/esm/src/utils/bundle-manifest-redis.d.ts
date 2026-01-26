/**
 * Redis-backed bundle manifest store
 *
 * This is a placeholder implementation. To enable Redis support:
 * 1. Install a Redis client (e.g., npm:redis or npm:ioredis)
 * 2. Implement the actual Redis operations
 *
 * For now, isAvailable() returns false, which triggers fallback to in-memory store.
 */
import type { BundleCode, BundleManifestStore, BundleMetadata } from "./bundle-manifest.js";
export interface RedisBundleManifestStoreOptions {
    url?: string;
    keyPrefix?: string;
}
export declare class RedisBundleManifestStore implements BundleManifestStore {
    constructor(_options: RedisBundleManifestStoreOptions, _adapter?: unknown);
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
//# sourceMappingURL=bundle-manifest-redis.d.ts.map