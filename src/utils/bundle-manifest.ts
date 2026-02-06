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
    /** Headings extracted from MDX for sidebar/TOC navigation */
    headings?: Array<{ id: string; text: string; level: number }>;
  };
}

export interface BundleCode {
  code: string;
  sourceMap?: string;
  css?: string;
}

export interface BundleManifestStats {
  totalBundles: number;
  totalSize: number;
  oldestBundle?: number;
  newestBundle?: number;
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
  getStats(): Promise<BundleManifestStats>;
}

export class InMemoryBundleManifestStore implements BundleManifestStore {
  private metadata = new Map<string, { value: BundleMetadata; expiry?: number }>();
  private code = new Map<string, { value: BundleCode; expiry?: number }>();
  private sourceIndex = new Map<string, Set<string>>();

  private getIfNotExpired<T>(
    map: Map<string, { value: T; expiry?: number }>,
    key: string,
  ): T | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;

    if (entry.expiry != null && Date.now() > entry.expiry) {
      map.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async getBundleMetadata(key: string): Promise<BundleMetadata | undefined> {
    return this.getIfNotExpired(this.metadata, key);
  }

  async setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void> {
    const expiry = ttlMs != null ? Date.now() + ttlMs : undefined;
    this.metadata.set(key, { value: metadata, expiry });

    const keys = this.sourceIndex.get(metadata.source) ?? new Set<string>();
    keys.add(key);
    this.sourceIndex.set(metadata.source, keys);
  }

  async getBundleCode(hash: string): Promise<BundleCode | undefined> {
    return this.getIfNotExpired(this.code, hash);
  }

  async setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    const expiry = ttlMs != null ? Date.now() + ttlMs : undefined;
    this.code.set(hash, { value: code, expiry });
  }

  async deleteBundle(key: string): Promise<void> {
    const metadata = await this.getBundleMetadata(key);

    this.metadata.delete(key);
    if (!metadata) return;

    this.code.delete(metadata.codeHash);

    const sourceKeys = this.sourceIndex.get(metadata.source);
    if (!sourceKeys) return;

    sourceKeys.delete(key);
    if (sourceKeys.size === 0) this.sourceIndex.delete(metadata.source);
  }

  async invalidateSource(source: string): Promise<number> {
    const keys = this.sourceIndex.get(source);
    if (!keys) return 0;

    const keysArray = [...keys];
    await Promise.all(keysArray.map((key) => this.deleteBundle(key)));
    this.sourceIndex.delete(source);

    return keysArray.length;
  }

  async clear(): Promise<void> {
    this.metadata.clear();
    this.code.clear();
    this.sourceIndex.clear();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getStats(): Promise<BundleManifestStats> {
    let totalSize = 0;
    let oldestBundle: number | undefined;
    let newestBundle: number | undefined;

    for (const { value } of this.metadata.values()) {
      totalSize += value.size;
      oldestBundle = oldestBundle == null
        ? value.compiledAt
        : Math.min(oldestBundle, value.compiledAt);
      newestBundle = newestBundle == null
        ? value.compiledAt
        : Math.max(newestBundle, value.compiledAt);
    }

    return {
      totalBundles: this.metadata.size,
      totalSize,
      oldestBundle,
      newestBundle,
    };
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
