import { serverLogger } from "./logger/index.ts";
import { BUNDLE_MANIFEST_LRU_MAX_ENTRIES } from "./constants/cache.ts";

const logger = serverLogger.component("bundle-manifest");

/** Public API contract for bundle metadata. */
export interface BundleMetadata {
  hash: string;
  codeHash: string;
  size: number;
  compiledAt: number;
  source: string;
  /** Optional tenant/content-source scope for source-index isolation. */
  scope?: string;
  mode: "development" | "production";
  meta?: {
    type?: "mdx" | "component" | "layout" | "provider";
    depsHash?: string;
    reactVersion?: string;
    /** Cache format/compiler identity. Entries with a different identity are misses. */
    compilerIdentity?: string;
    /** Stable identity declared by the resolved ContentProcessor implementation. */
    processorCacheIdentity?: string;
    /** Headings extracted from MDX for sidebar/TOC navigation */
    headings?: Array<{ id: string; text: string; level: number }>;
    /** JSON-compatible MDX result fields needed for cold/cache-hit parity. */
    frontmatter?: Record<string, unknown>;
    globals?: Record<string, unknown>;
    nodeMapEntries?: Array<[number, unknown]>;
    rawHtml?: string;
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

/**
 * Explicit opt-in for stores that implement tenant-safe scoped operations.
 * Legacy stores omit these flags; callers must not infer support from optional
 * parameters because JavaScript implementations can silently ignore them.
 */
export interface BundleManifestStoreCapabilities {
  scopedSourceInvalidation?: true;
  prefixInvalidation?: true;
  prefixStats?: true;
}

export interface BundleManifestStore {
  readonly capabilities?: Readonly<BundleManifestStoreCapabilities>;
  getBundleMetadata(key: string): Promise<BundleMetadata | undefined>;
  setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void>;
  getBundleCode(hash: string): Promise<BundleCode | undefined>;
  setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void>;
  deleteBundle(key: string): Promise<void>;
  invalidatePrefix?(prefix: string): Promise<number>;
  invalidateSource(source: string, scope?: string): Promise<number>;
  clear(): Promise<void>;
  isAvailable(): Promise<boolean>;
  getStats(prefix?: string): Promise<BundleManifestStats>;
}

export interface InMemoryBundleManifestStoreOptions {
  maxMetadataEntries?: number;
  maxCodeEntries?: number;
  now?: () => number;
}

interface StoredValue<T> {
  value: T;
  expiry?: number;
}

function cloneBundleMetadata(metadata: BundleMetadata): BundleMetadata {
  return structuredClone(metadata);
}

function cloneBundleCode(bundleCode: BundleCode): BundleCode {
  return { ...bundleCode };
}

export class InMemoryBundleManifestStore implements BundleManifestStore {
  readonly capabilities = Object.freeze(
    {
      scopedSourceInvalidation: true,
      prefixInvalidation: true,
      prefixStats: true,
    } as const,
  );
  private metadata = new Map<string, StoredValue<BundleMetadata>>();
  private code = new Map<string, StoredValue<BundleCode>>();
  private sourceIndex = new Map<string, Set<string>>();
  private codeIndex = new Map<string, Set<string>>();
  private nextExpiry: number | undefined;
  private readonly maxMetadataEntries: number;
  private readonly maxCodeEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryBundleManifestStoreOptions = {}) {
    this.maxMetadataEntries = this.validateCapacity(
      options.maxMetadataEntries ?? BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
      "maxMetadataEntries",
    );
    this.maxCodeEntries = this.validateCapacity(
      options.maxCodeEntries ?? BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
      "maxCodeEntries",
    );
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new TypeError("now must be a function");
    }
    this.now = options.now ?? Date.now;
  }

  private validateCapacity(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    return value;
  }

  private getExpiry(ttlMs: number | undefined, now: number): number | undefined {
    if (ttlMs === undefined) return undefined;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError("ttlMs must be a non-negative finite number");
    }
    const expiry = now + ttlMs;
    if (!Number.isFinite(expiry)) {
      throw new RangeError("ttlMs produces an invalid expiry timestamp");
    }
    return expiry;
  }

  private scheduleExpiry(expiry: number | undefined): void {
    if (expiry === undefined) return;
    this.nextExpiry = this.nextExpiry === undefined ? expiry : Math.min(this.nextExpiry, expiry);
  }

  private touch<T>(map: Map<string, StoredValue<T>>, key: string): StoredValue<T> | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;
    map.delete(key);
    map.set(key, entry);
    return entry;
  }

  private getSourceIndexKey(source: string, scope: string | undefined): string {
    if (scope === undefined) return `source:unscoped:${source}`;
    return `source:scope:${scope.length}:${scope}:${source}`;
  }

  private removeSourceReference(key: string, metadata: BundleMetadata): void {
    const sourceIndexKey = this.getSourceIndexKey(metadata.source, metadata.scope);
    const sourceKeys = this.sourceIndex.get(sourceIndexKey);
    if (!sourceKeys) return;

    sourceKeys.delete(key);
    if (sourceKeys.size === 0) this.sourceIndex.delete(sourceIndexKey);
  }

  private removeCodeReference(key: string, codeHash: string): void {
    const metadataKeys = this.codeIndex.get(codeHash);
    if (!metadataKeys) return;
    metadataKeys.delete(key);
    if (metadataKeys.size === 0) this.codeIndex.delete(codeHash);
  }

  private removeMetadata(key: string, removeOrphanCode = true): BundleMetadata | undefined {
    const entry = this.metadata.get(key);
    if (!entry) return undefined;

    this.metadata.delete(key);
    this.removeSourceReference(key, entry.value);
    this.removeCodeReference(key, entry.value.codeHash);
    if (removeOrphanCode && !this.codeIndex.has(entry.value.codeHash)) {
      this.code.delete(entry.value.codeHash);
    }
    return entry.value;
  }

  private removeCode(hash: string): BundleCode | undefined {
    const entry = this.code.get(hash);
    if (!entry) return undefined;

    this.code.delete(hash);
    const metadataKeys = [...(this.codeIndex.get(hash) ?? [])];
    for (const key of metadataKeys) {
      this.removeMetadata(key, false);
    }
    this.codeIndex.delete(hash);
    return entry.value;
  }

  private sweepExpired(now = this.now()): void {
    if (this.nextExpiry === undefined || now < this.nextExpiry) return;

    this.nextExpiry = undefined;
    for (const [key, entry] of this.metadata) {
      if (entry.expiry !== undefined && now >= entry.expiry) {
        this.removeMetadata(key);
      } else {
        this.scheduleExpiry(entry.expiry);
      }
    }
    for (const [hash, entry] of this.code) {
      if (entry.expiry !== undefined && now >= entry.expiry) {
        this.removeCode(hash);
      } else {
        this.scheduleExpiry(entry.expiry);
      }
    }
  }

  private enforceMetadataCapacity(): void {
    while (this.metadata.size > this.maxMetadataEntries) {
      const oldestKey = this.metadata.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.removeMetadata(oldestKey);
    }
  }

  private enforceCodeCapacity(): void {
    while (this.code.size > this.maxCodeEntries) {
      const oldestHash = this.code.keys().next().value as string | undefined;
      if (oldestHash === undefined) return;
      this.removeCode(oldestHash);
    }
  }

  async getBundleMetadata(key: string): Promise<BundleMetadata | undefined> {
    this.sweepExpired();
    const metadata = this.touch(this.metadata, key)?.value;
    return metadata === undefined ? undefined : cloneBundleMetadata(metadata);
  }

  async setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void> {
    const snapshot = cloneBundleMetadata(metadata);
    const now = this.now();
    const expiry = this.getExpiry(ttlMs, now);
    this.sweepExpired(now);
    const previous = this.removeMetadata(key, false);
    if (expiry !== undefined && now >= expiry) {
      if (previous && !this.codeIndex.has(previous.codeHash)) this.code.delete(previous.codeHash);
      if (!this.codeIndex.has(snapshot.codeHash)) this.code.delete(snapshot.codeHash);
      return;
    }

    this.metadata.set(key, { value: snapshot, expiry });

    const sourceIndexKey = this.getSourceIndexKey(snapshot.source, snapshot.scope);
    const keys = this.sourceIndex.get(sourceIndexKey) ?? new Set<string>();
    keys.add(key);
    this.sourceIndex.set(sourceIndexKey, keys);

    const codeKeys = this.codeIndex.get(snapshot.codeHash) ?? new Set<string>();
    codeKeys.add(key);
    this.codeIndex.set(snapshot.codeHash, codeKeys);

    if (
      previous && previous.codeHash !== snapshot.codeHash && !this.codeIndex.has(previous.codeHash)
    ) {
      this.code.delete(previous.codeHash);
    }
    this.scheduleExpiry(expiry);
    this.enforceMetadataCapacity();
  }

  async getBundleCode(hash: string): Promise<BundleCode | undefined> {
    this.sweepExpired();
    const bundleCode = this.touch(this.code, hash)?.value;
    return bundleCode === undefined ? undefined : cloneBundleCode(bundleCode);
  }

  async setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    const now = this.now();
    const requestedExpiry = this.getExpiry(ttlMs, now);
    this.sweepExpired(now);
    const existing = this.code.get(hash);
    let expiry = requestedExpiry;
    if (existing !== undefined) {
      expiry = existing.expiry === undefined || requestedExpiry === undefined
        ? undefined
        : Math.max(existing.expiry, requestedExpiry);
    }
    if (expiry !== undefined && now >= expiry) {
      this.removeCode(hash);
      return;
    }
    this.code.delete(hash);
    this.code.set(hash, { value: cloneBundleCode(code), expiry });
    this.scheduleExpiry(expiry);
    this.enforceCodeCapacity();
  }

  async deleteBundle(key: string): Promise<void> {
    this.sweepExpired();
    this.removeMetadata(key);
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    this.sweepExpired();
    let invalidated = 0;
    for (const key of [...this.metadata.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.removeMetadata(key);
      invalidated++;
    }
    return invalidated;
  }

  async invalidateSource(source: string, scope?: string): Promise<number> {
    this.sweepExpired();
    const sourceIndexKey = this.getSourceIndexKey(source, scope);
    const keys = this.sourceIndex.get(sourceIndexKey);
    if (!keys) return 0;

    const keysArray = [...keys];
    let invalidated = 0;
    for (const key of keysArray) {
      if (this.metadata.has(key)) {
        this.removeMetadata(key);
        invalidated++;
      }
    }
    this.sourceIndex.delete(sourceIndexKey);

    return invalidated;
  }

  async clear(): Promise<void> {
    this.metadata.clear();
    this.code.clear();
    this.sourceIndex.clear();
    this.codeIndex.clear();
    this.nextExpiry = undefined;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getStats(prefix?: string): Promise<BundleManifestStats> {
    this.sweepExpired();
    let totalSize = 0;
    let oldestBundle: number | undefined;
    let newestBundle: number | undefined;
    let totalBundles = 0;

    for (const [key, { value }] of this.metadata) {
      if (prefix !== undefined && !key.startsWith(prefix)) continue;
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
}

let manifestStore: BundleManifestStore = new InMemoryBundleManifestStore();

export function setBundleManifestStore(store: BundleManifestStore): void {
  manifestStore = store;
  logger.info("Bundle manifest store configured", {
    type: store.constructor.name,
  });
}

/** Return bundle manifest store. */
export function getBundleManifestStore(): BundleManifestStore {
  return manifestStore;
}

export { computeCodeHash, computeHash } from "./hash-utils.ts";
