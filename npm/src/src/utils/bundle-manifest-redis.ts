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

export class RedisBundleManifestStore implements BundleManifestStore {
  constructor(_options: RedisBundleManifestStoreOptions, _adapter?: unknown) {
    // Redis client initialization would go here
  }

  isAvailable(): Promise<boolean> {
    // Return false to trigger fallback to in-memory store
    // When Redis support is implemented, this should test the connection
    return Promise.resolve(false);
  }

  getBundleMetadata(_key: string): Promise<BundleMetadata | undefined> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  setBundleMetadata(
    _key: string,
    _metadata: BundleMetadata,
    _ttlMs?: number,
  ): Promise<void> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  getBundleCode(_hash: string): Promise<BundleCode | undefined> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  setBundleCode(
    _hash: string,
    _code: BundleCode,
    _ttlMs?: number,
  ): Promise<void> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  deleteBundle(_key: string): Promise<void> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  invalidateSource(_source: string): Promise<number> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  clear(): Promise<void> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }

  getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }> {
    return Promise.reject(new Error("Redis bundle manifest store not implemented"));
  }
}
