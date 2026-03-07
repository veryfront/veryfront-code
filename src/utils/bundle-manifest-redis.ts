import type {
  BundleCode,
  BundleManifestStats,
  BundleManifestStore,
  BundleMetadata,
} from "./bundle-manifest.ts";

interface RedisBundleManifestStoreOptions {
  url?: string;
  keyPrefix?: string;
}

function notImplemented(): Promise<never> {
  return Promise.reject(new Error("Redis bundle manifest store not implemented"));
}

export class RedisBundleManifestStore implements BundleManifestStore {
  constructor(_options: RedisBundleManifestStoreOptions, _adapter?: unknown) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  getBundleMetadata(_key: string): Promise<BundleMetadata | undefined> {
    return notImplemented();
  }

  setBundleMetadata(_key: string, _metadata: BundleMetadata, _ttlMs?: number): Promise<void> {
    return notImplemented();
  }

  getBundleCode(_hash: string): Promise<BundleCode | undefined> {
    return notImplemented();
  }

  setBundleCode(_hash: string, _code: BundleCode, _ttlMs?: number): Promise<void> {
    return notImplemented();
  }

  deleteBundle(_key: string): Promise<void> {
    return notImplemented();
  }

  invalidateSource(_source: string): Promise<number> {
    return notImplemented();
  }

  clear(): Promise<void> {
    return notImplemented();
  }

  getStats(): Promise<BundleManifestStats> {
    return notImplemented();
  }
}
