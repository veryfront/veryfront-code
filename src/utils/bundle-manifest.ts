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

/** Minimum interval between full expired-metadata sweeps (amortized on writes). */
export const BUNDLE_MANIFEST_SWEEP_INTERVAL_MS = 30_000;

export class InMemoryBundleManifestStore implements BundleManifestStore {
  private metadata = new Map<string, { value: BundleMetadata; expiry?: number }>();
  private code = new Map<string, { value: BundleCode; expiry?: number }>();
  private sourceIndex = new Map<string, Set<string>>();
  // codeHash → metadata keys holding a reference. Each key holds at most one
  // reference per hash, so set size is the reference count and the members
  // let reads prune only the metadata entries relevant to one hash.
  private codeReferences = new Map<string, Set<string>>();
  private lastExpiredSweepAt = Date.now();

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
    this.sweepExpiredMetadataIfDue();
    const expiry = ttlMs != null ? Date.now() + ttlMs : undefined;
    const snapshot = structuredClone(metadata);
    const previous = this.metadata.get(key)?.value;

    if (!previous) {
      this.addCodeReference(snapshot.codeHash, key);
    } else if (previous.codeHash !== snapshot.codeHash) {
      this.removeCodeReference(previous.codeHash, key);
      this.addCodeReference(snapshot.codeHash, key);
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
    // Only the metadata entries referencing this hash decide its liveness, so
    // prune those lazily instead of sweeping the entire metadata map on every
    // per-render read. Full sweeps are amortized onto writes.
    this.pruneExpiredReferencesTo(hash);
    const entry = this.code.get(hash);
    if (!entry) return undefined;

    // Metadata references own code liveness. A shorter code TTL must not turn
    // a still-valid manifest into a pointer to a missing content blob.
    if (
      entry.expiry != null &&
      Date.now() >= entry.expiry &&
      !this.codeReferences.has(hash)
    ) {
      this.code.delete(hash);
      return undefined;
    }

    return structuredClone(entry.value);
  }

  async setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    this.sweepExpiredMetadataIfDue();
    const expiry = ttlMs != null ? Date.now() + ttlMs : undefined;
    this.code.set(hash, { value: structuredClone(code), expiry });
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
    this.codeReferences.clear();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getStats(): Promise<BundleManifestStats> {
    // Non-mutating expiry view: expired entries are excluded from the
    // aggregate without paying a pruning sweep on this read path.
    const now = Date.now();
    let totalBundles = 0;
    let totalSize = 0;
    let oldestBundle: number | undefined;
    let newestBundle: number | undefined;

    for (const { value, expiry } of this.metadata.values()) {
      if (expiry != null && now >= expiry) continue;
      totalBundles++;
      totalSize += value.size;
      oldestBundle = oldestBundle == null
        ? value.compiledAt
        : Math.min(oldestBundle, value.compiledAt);
      newestBundle = newestBundle == null
        ? value.compiledAt
        : Math.max(newestBundle, value.compiledAt);
    }

    return {
      totalBundles,
      totalSize,
      oldestBundle,
      newestBundle,
    };
  }

  private addCodeReference(codeHash: string, key: string): void {
    const refs = this.codeReferences.get(codeHash) ?? new Set<string>();
    refs.add(key);
    this.codeReferences.set(codeHash, refs);
  }

  /**
   * Drop expired metadata entries referencing one code hash so the reference
   * check in getBundleCode stays trustworthy without a full-map sweep.
   */
  private pruneExpiredReferencesTo(hash: string, now = Date.now()): void {
    const refs = this.codeReferences.get(hash);
    if (!refs) return;

    for (const key of [...refs]) {
      const entry = this.metadata.get(key);
      if (!entry) {
        // Defensive: a reference without metadata is stale bookkeeping.
        this.removeCodeReference(hash, key);
        continue;
      }
      if (entry.expiry != null && now >= entry.expiry) this.removeMetadata(key);
    }
  }

  /**
   * Full expired-metadata sweep, amortized: runs on writes at most once per
   * BUNDLE_MANIFEST_SWEEP_INTERVAL_MS so unread expired entries cannot pin
   * memory forever while per-render reads stay off the O(all-metadata) path.
   */
  private sweepExpiredMetadataIfDue(now = Date.now()): void {
    if (now - this.lastExpiredSweepAt < BUNDLE_MANIFEST_SWEEP_INTERVAL_MS) return;
    this.lastExpiredSweepAt = now;

    for (const [key, entry] of this.metadata) {
      if (entry.expiry != null && now >= entry.expiry) this.removeMetadata(key);
    }
  }

  private removeCodeReference(codeHash: string, key: string): void {
    const refs = this.codeReferences.get(codeHash);
    if (refs) {
      refs.delete(key);
      if (refs.size > 0) return;
      this.codeReferences.delete(codeHash);
    }

    this.code.delete(codeHash);
  }

  private removeMetadata(key: string): BundleMetadata | undefined {
    const metadata = this.metadata.get(key)?.value;
    if (!metadata) return undefined;

    this.metadata.delete(key);
    this.removeSourceReference(key, metadata.source);
    this.removeCodeReference(metadata.codeHash, key);
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
