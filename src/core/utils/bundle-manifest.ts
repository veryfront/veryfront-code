import { serverLogger as logger } from "./logger/index.ts";

export interface BundleMetadata {
  hash: string;
  codeHash: string;
  size: number;
  compiledAt: number;
  source: string;
  mode: "development" | "production";
  meta?: {
    type?: "mdx" | "component" | "layout" | "provider";
    depsHash?: string;
    reactVersion?: string;
  };
}

export interface BundleCode {
  code: string;
  sourceMap?: string;
  css?: string;
}

export interface BundleManifestStore {
  getBundleMetadata(key: string): Promise<BundleMetadata | undefined>;

  setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void>;

  getBundleCode(hash: string): Promise<BundleCode | undefined>;

  setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void>;

  deleteBundle(key: string): Promise<void>;

  invalidateSource(source: string): Promise<number>;

  clear(): Promise<void>;

  isAvailable(): Promise<boolean>;

  getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }>;
}

export class InMemoryBundleManifestStore implements BundleManifestStore {
  private metadata = new Map<string, { value: BundleMetadata; expiry?: number }>();
  private code = new Map<string, { value: BundleCode; expiry?: number }>();
  private sourceIndex = new Map<string, Set<string>>();

  getBundleMetadata(key: string): Promise<BundleMetadata | undefined> {
    const entry = this.metadata.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiry && Date.now() > entry.expiry) {
      this.metadata.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value);
  }

  setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void> {
    const expiry = ttlMs ? Date.now() + ttlMs : undefined;
    this.metadata.set(key, { value: metadata, expiry });

    if (!this.sourceIndex.has(metadata.source)) {
      this.sourceIndex.set(metadata.source, new Set());
    }
    this.sourceIndex.get(metadata.source)!.add(key);
    return Promise.resolve();
  }

  getBundleCode(hash: string): Promise<BundleCode | undefined> {
    const entry = this.code.get(hash);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiry && Date.now() > entry.expiry) {
      this.code.delete(hash);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value);
  }

  setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    const expiry = ttlMs ? Date.now() + ttlMs : undefined;
    this.code.set(hash, { value: code, expiry });
    return Promise.resolve();
  }

  async deleteBundle(key: string): Promise<void> {
    const metadata = await this.getBundleMetadata(key);
    this.metadata.delete(key);
    if (metadata) {
      this.code.delete(metadata.codeHash);
      const sourceKeys = this.sourceIndex.get(metadata.source);
      if (sourceKeys) {
        sourceKeys.delete(key);
        if (sourceKeys.size === 0) {
          this.sourceIndex.delete(metadata.source);
        }
      }
    }
  }

  async invalidateSource(source: string): Promise<number> {
    const keys = this.sourceIndex.get(source);
    if (!keys) return 0;

    let count = 0;
    for (const key of Array.from(keys)) {
      await this.deleteBundle(key);
      count++;
    }
    this.sourceIndex.delete(source);
    return count;
  }

  clear(): Promise<void> {
    this.metadata.clear();
    this.code.clear();
    this.sourceIndex.clear();
    return Promise.resolve();
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }> {
    let totalSize = 0;
    let oldest: number | undefined;
    let newest: number | undefined;

    for (const { value } of this.metadata.values()) {
      totalSize += value.size;
      if (!oldest || value.compiledAt < oldest) oldest = value.compiledAt;
      if (!newest || value.compiledAt > newest) newest = value.compiledAt;
    }

    return Promise.resolve({
      totalBundles: this.metadata.size,
      totalSize,
      oldestBundle: oldest,
      newestBundle: newest,
    });
  }
}

let manifestStore: BundleManifestStore = new InMemoryBundleManifestStore();

export function setBundleManifestStore(store: BundleManifestStore): void {
  manifestStore = store;
  logger.info("[bundle-manifest] Bundle manifest store configured", {
    type: store.constructor.name,
  });
}

export function getBundleManifestStore(): BundleManifestStore {
  return manifestStore;
}

export { computeCodeHash, computeContentHash } from "./hash-utils.ts";
