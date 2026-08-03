import { serverLogger } from "./logger/index.ts";

const logger = serverLogger.component("bundle-manifest");

/** Public API contract for bundle metadata. */
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

/** Public API contract for bundle code. */
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
  private codeReferenceCounts = new Map<string, number>();

  async getBundleMetadata(key: string): Promise<BundleMetadata | undefined> {
    const entry = this.metadata.get(key);
    if (!entry) return undefined;

    if (entry.expiry != null && Date.now() >= entry.expiry) {
      this.removeMetadata(key);
      return undefined;
    }

    return structuredClone(entry.value);
  }

  async setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void> {
    const expiry = ttlMs != null ? Date.now() + ttlMs : undefined;
    const snapshot = structuredClone(metadata);
    const previous = this.metadata.get(key)?.value;

    if (!previous) {
      this.incrementCodeReference(snapshot.codeHash);
    } else if (previous.codeHash !== snapshot.codeHash) {
      this.decrementCodeReference(previous.codeHash);
      this.incrementCodeReference(snapshot.codeHash);
    }

    if (previous && previous.source !== snapshot.source) {
      this.removeSourceReference(key, previous.source);
    }

    this.metadata.set(key, { value: snapshot, expiry });

    const keys = this.sourceIndex.get(snapshot.source) ?? new Set<string>();
    keys.add(key);
    this.sourceIndex.set(snapshot.source, keys);
  }

  async getBundleCode(hash: string): Promise<BundleCode | undefined> {
    this.pruneExpiredMetadata();
    const entry = this.code.get(hash);
    if (!entry) return undefined;

    // Metadata references own code liveness. A shorter code TTL must not turn
    // a still-valid manifest into a pointer to a missing content blob.
    if (
      entry.expiry != null &&
      Date.now() >= entry.expiry &&
      !this.codeReferenceCounts.has(hash)
    ) {
      this.code.delete(hash);
      return undefined;
    }

    return entry.value;
  }

  async setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    const expiry = ttlMs != null ? Date.now() + ttlMs : undefined;
    this.code.set(hash, { value: code, expiry });
  }

  async deleteBundle(key: string): Promise<void> {
    this.removeMetadata(key);
  }

  async invalidateSource(source: string): Promise<number> {
    const keys = this.sourceIndex.get(source);
    if (!keys) return 0;

    const keysArray = [...keys];
    for (const key of keysArray) this.removeMetadata(key);
    this.sourceIndex.delete(source);

    return keysArray.length;
  }

  async clear(): Promise<void> {
    this.metadata.clear();
    this.code.clear();
    this.sourceIndex.clear();
    this.codeReferenceCounts.clear();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getStats(): Promise<BundleManifestStats> {
    this.pruneExpiredMetadata();
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

  private incrementCodeReference(codeHash: string): void {
    const count = this.codeReferenceCounts.get(codeHash) ?? 0;
    this.codeReferenceCounts.set(codeHash, count + 1);
  }

  private pruneExpiredMetadata(now = Date.now()): void {
    for (const [key, entry] of this.metadata) {
      if (entry.expiry != null && now >= entry.expiry) this.removeMetadata(key);
    }
  }

  private decrementCodeReference(codeHash: string): void {
    const count = this.codeReferenceCounts.get(codeHash);
    if (count != null && count > 1) {
      this.codeReferenceCounts.set(codeHash, count - 1);
      return;
    }

    this.codeReferenceCounts.delete(codeHash);
    this.code.delete(codeHash);
  }

  private removeMetadata(key: string): BundleMetadata | undefined {
    const metadata = this.metadata.get(key)?.value;
    if (!metadata) return undefined;

    this.metadata.delete(key);
    this.removeSourceReference(key, metadata.source);
    this.decrementCodeReference(metadata.codeHash);
    return metadata;
  }

  private removeSourceReference(key: string, source: string): void {
    const sourceKeys = this.sourceIndex.get(source);
    if (!sourceKeys) return;

    sourceKeys.delete(key);
    if (sourceKeys.size === 0) this.sourceIndex.delete(source);
  }
}

let manifestStore: BundleManifestStore = new InMemoryBundleManifestStore();

export function setBundleManifestStore(store: BundleManifestStore): void {
  manifestStore = store;
  logger.debug("Bundle manifest store configured", {
    type: store.constructor.name,
  });
}

/** Return bundle manifest store. */
export function getBundleManifestStore(): BundleManifestStore {
  return manifestStore;
}

export { computeCodeHash, computeHash } from "./hash-utils.ts";
