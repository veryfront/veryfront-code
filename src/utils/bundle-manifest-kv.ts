/**
 * Deno KV-backed bundle manifest store
 *
 * This is a placeholder implementation. To enable KV support:
 * 1. Ensure Deno KV is available in your runtime
 * 2. Implement the actual KV operations
 *
 * For now, isAvailable() returns false, which triggers fallback to in-memory store.
 */

import type { BundleCode, BundleManifestStore, BundleMetadata } from "./bundle-manifest.ts";

export interface KVBundleManifestStoreOptions {
  keyPrefix?: string;
}

export class KVBundleManifestStore implements BundleManifestStore {
  constructor(_options: KVBundleManifestStoreOptions) {
    // Deno KV initialization would go here
  }

  isAvailable(): Promise<boolean> {
    // Return false to trigger fallback to in-memory store
    // When KV support is implemented, this should test if Deno.openKv() works
    return Promise.resolve(false);
  }

  getBundleMetadata(_key: string): Promise<BundleMetadata | undefined> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  setBundleMetadata(
    _key: string,
    _metadata: BundleMetadata,
    _ttlMs?: number,
  ): Promise<void> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  getBundleCode(_hash: string): Promise<BundleCode | undefined> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  setBundleCode(
    _hash: string,
    _code: BundleCode,
    _ttlMs?: number,
  ): Promise<void> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  deleteBundle(_key: string): Promise<void> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  invalidateSource(_source: string): Promise<number> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  clear(): Promise<void> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }

  getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }> {
    return Promise.reject(new Error("KV bundle manifest store not implemented"));
  }
}
