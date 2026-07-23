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

export interface InMemoryBundleManifestStoreOptions {
  maxEntries?: number;
  maxSizeBytes?: number;
}

interface StoredBundleValue<T> {
  value: T;
  expiry?: number;
  sizeBytes: number;
}

const DEFAULT_BUNDLE_MANIFEST_MAX_ENTRIES = 5_000;
const DEFAULT_BUNDLE_MANIFEST_MAX_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_BUNDLE_MANIFEST_ENTRIES = 1_000_000;
const MAX_BUNDLE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_BUNDLE_KEY_LENGTH = 4_096;
const MAX_BUNDLE_SOURCE_LENGTH = 16_384;
const MAX_BUNDLE_HEADINGS = 10_000;
const ENTRY_OVERHEAD_BYTES = 64;
const textEncoder = new TextEncoder();

function requirePositiveSafeInteger(
  value: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function requireString(
  value: unknown,
  name: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxLength
  ) {
    const emptiness = allowEmpty ? "" : " non-empty";
    throw new TypeError(`${name} must be a${emptiness} string no longer than ${maxLength}`);
  }
  return value;
}

function cloneMetadata(metadata: BundleMetadata): BundleMetadata {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object");
  }

  const mode = metadata.mode;
  if (mode !== "development" && mode !== "production") {
    throw new TypeError('metadata.mode must be "development" or "production"');
  }

  const result: BundleMetadata = {
    hash: requireString(metadata.hash, "metadata.hash", MAX_BUNDLE_KEY_LENGTH),
    codeHash: requireString(metadata.codeHash, "metadata.codeHash", MAX_BUNDLE_KEY_LENGTH),
    size: requireNonNegativeSafeInteger(metadata.size, "metadata.size"),
    compiledAt: requireNonNegativeSafeInteger(metadata.compiledAt, "metadata.compiledAt"),
    source: requireString(metadata.source, "metadata.source", MAX_BUNDLE_SOURCE_LENGTH),
    mode,
  };

  if (metadata.meta === undefined) return result;
  if (typeof metadata.meta !== "object" || metadata.meta === null || Array.isArray(metadata.meta)) {
    throw new TypeError("metadata.meta must be an object");
  }

  const meta: NonNullable<BundleMetadata["meta"]> = {};
  if (metadata.meta.type !== undefined) {
    const allowedTypes = ["mdx", "component", "layout", "provider"] as const;
    if (!allowedTypes.includes(metadata.meta.type)) {
      throw new TypeError("metadata.meta.type is invalid");
    }
    meta.type = metadata.meta.type;
  }
  if (metadata.meta.depsHash !== undefined) {
    meta.depsHash = requireString(
      metadata.meta.depsHash,
      "metadata.meta.depsHash",
      MAX_BUNDLE_KEY_LENGTH,
    );
  }
  if (metadata.meta.reactVersion !== undefined) {
    meta.reactVersion = requireString(
      metadata.meta.reactVersion,
      "metadata.meta.reactVersion",
      MAX_BUNDLE_KEY_LENGTH,
    );
  }
  if (metadata.meta.headings !== undefined) {
    if (
      !Array.isArray(metadata.meta.headings) || metadata.meta.headings.length > MAX_BUNDLE_HEADINGS
    ) {
      throw new TypeError(
        `metadata.meta.headings must contain at most ${MAX_BUNDLE_HEADINGS} items`,
      );
    }
    meta.headings = metadata.meta.headings.map((heading, index) => {
      if (typeof heading !== "object" || heading === null || Array.isArray(heading)) {
        throw new TypeError(`metadata.meta.headings[${index}] must be an object`);
      }
      const level = heading.level;
      if (!Number.isInteger(level) || level < 1 || level > 6) {
        throw new TypeError(`metadata.meta.headings[${index}].level must be between 1 and 6`);
      }
      return {
        id: requireString(
          heading.id,
          `metadata.meta.headings[${index}].id`,
          MAX_BUNDLE_KEY_LENGTH,
        ),
        text: requireString(
          heading.text,
          `metadata.meta.headings[${index}].text`,
          MAX_BUNDLE_SOURCE_LENGTH,
          true,
        ),
        level,
      };
    });
  }
  result.meta = meta;
  return result;
}

function cloneCode(code: BundleCode): BundleCode {
  if (typeof code !== "object" || code === null || Array.isArray(code)) {
    throw new TypeError("code must be an object");
  }

  const result: BundleCode = {
    code: requireString(code.code, "code.code", Number.MAX_SAFE_INTEGER, true),
  };
  if (code.sourceMap !== undefined) {
    result.sourceMap = requireString(
      code.sourceMap,
      "code.sourceMap",
      Number.MAX_SAFE_INTEGER,
      true,
    );
  }
  if (code.css !== undefined) {
    result.css = requireString(code.css, "code.css", Number.MAX_SAFE_INTEGER, true);
  }
  return result;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export class InMemoryBundleManifestStore implements BundleManifestStore {
  private readonly metadata = new Map<string, StoredBundleValue<BundleMetadata>>();
  private readonly code = new Map<string, StoredBundleValue<BundleCode>>();
  private readonly sourceIndex = new Map<string, Set<string>>();
  private readonly codeReferences = new Map<string, Set<string>>();
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private metadataSizeBytes = 0;
  private codeSizeBytes = 0;

  constructor(options: InMemoryBundleManifestStoreOptions = {}) {
    this.maxEntries = requirePositiveSafeInteger(
      options.maxEntries ?? DEFAULT_BUNDLE_MANIFEST_MAX_ENTRIES,
      "maxEntries",
      MAX_BUNDLE_MANIFEST_ENTRIES,
    );
    this.maxSizeBytes = requirePositiveSafeInteger(
      options.maxSizeBytes ?? DEFAULT_BUNDLE_MANIFEST_MAX_SIZE_BYTES,
      "maxSizeBytes",
    );
  }

  private normalizeTtl(ttlMs: number | undefined): number | undefined {
    if (ttlMs === undefined) return undefined;
    return requirePositiveSafeInteger(ttlMs, "ttlMs", MAX_BUNDLE_TTL_MS);
  }

  private expiryFromTtl(ttlMs: number | undefined): number | undefined {
    return ttlMs === undefined ? undefined : Date.now() + ttlMs;
  }

  private isExpired(entry: StoredBundleValue<unknown>, now = Date.now()): boolean {
    return entry.expiry !== undefined && now >= entry.expiry;
  }

  private touch<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
  }

  private removeCode(hash: string, removeReferencingMetadata: boolean): boolean {
    const entry = this.code.get(hash);
    if (!entry) return false;

    this.code.delete(hash);
    this.codeSizeBytes -= entry.sizeBytes;

    if (removeReferencingMetadata) {
      const references = [...(this.codeReferences.get(hash) ?? [])];
      for (const key of references) this.removeMetadata(key, false);
      this.codeReferences.delete(hash);
    } else if (this.codeReferences.get(hash)?.size === 0) {
      this.codeReferences.delete(hash);
    }
    return true;
  }

  private removeMetadata(key: string, removeOrphanedCode: boolean): boolean {
    const entry = this.metadata.get(key);
    if (!entry) return false;

    this.metadata.delete(key);
    this.metadataSizeBytes -= entry.sizeBytes;

    const sourceKeys = this.sourceIndex.get(entry.value.source);
    sourceKeys?.delete(key);
    if (sourceKeys?.size === 0) this.sourceIndex.delete(entry.value.source);

    const references = this.codeReferences.get(entry.value.codeHash);
    references?.delete(key);
    if (references?.size === 0) {
      this.codeReferences.delete(entry.value.codeHash);
      if (removeOrphanedCode) this.removeCode(entry.value.codeHash, false);
    }
    return true;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of [...this.metadata]) {
      if (this.isExpired(entry, now)) this.removeMetadata(key, true);
    }
    for (const [hash, entry] of [...this.code]) {
      if (this.isExpired(entry, now)) this.removeCode(hash, true);
    }
  }

  private enforceLimits(): void {
    this.cleanupExpired();

    while (this.metadata.size > this.maxEntries) {
      const oldestKey = this.metadata.keys().next().value;
      if (oldestKey === undefined) break;
      this.removeMetadata(oldestKey, true);
    }
    while (this.code.size > this.maxEntries) {
      const oldestHash = this.code.keys().next().value;
      if (oldestHash === undefined) break;
      this.removeCode(oldestHash, true);
    }
    while (this.metadataSizeBytes + this.codeSizeBytes > this.maxSizeBytes) {
      const oldestMetadataKey = this.metadata.keys().next().value;
      if (oldestMetadataKey !== undefined) {
        this.removeMetadata(oldestMetadataKey, true);
        continue;
      }

      const oldestCodeHash = this.code.keys().next().value;
      if (oldestCodeHash === undefined) break;
      this.removeCode(oldestCodeHash, true);
    }
  }

  async getBundleMetadata(key: string): Promise<BundleMetadata | undefined> {
    requireString(key, "key", MAX_BUNDLE_KEY_LENGTH);
    const entry = this.metadata.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.removeMetadata(key, true);
      return undefined;
    }
    this.touch(this.metadata, key, entry);
    return cloneMetadata(entry.value);
  }

  async setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void> {
    requireString(key, "key", MAX_BUNDLE_KEY_LENGTH);
    const normalizedTtl = this.normalizeTtl(ttlMs);
    const storedMetadata = cloneMetadata(metadata);
    const sizeBytes = byteLength(key) + byteLength(JSON.stringify(storedMetadata)) +
      ENTRY_OVERHEAD_BYTES;
    if (sizeBytes > this.maxSizeBytes) {
      throw new RangeError("Bundle metadata exceeds maxSizeBytes");
    }

    const previousCodeHash = this.metadata.get(key)?.value.codeHash;
    this.removeMetadata(key, false);
    this.metadata.set(key, {
      value: storedMetadata,
      expiry: this.expiryFromTtl(normalizedTtl),
      sizeBytes,
    });
    this.metadataSizeBytes += sizeBytes;

    const keys = this.sourceIndex.get(storedMetadata.source) ?? new Set<string>();
    keys.add(key);
    this.sourceIndex.set(storedMetadata.source, keys);

    const references = this.codeReferences.get(storedMetadata.codeHash) ?? new Set<string>();
    references.add(key);
    this.codeReferences.set(storedMetadata.codeHash, references);

    if (
      previousCodeHash !== undefined &&
      previousCodeHash !== storedMetadata.codeHash &&
      !this.codeReferences.has(previousCodeHash)
    ) {
      this.removeCode(previousCodeHash, false);
    }
    this.enforceLimits();
  }

  async getBundleCode(hash: string): Promise<BundleCode | undefined> {
    requireString(hash, "hash", MAX_BUNDLE_KEY_LENGTH);
    const entry = this.code.get(hash);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.removeCode(hash, true);
      return undefined;
    }
    this.touch(this.code, hash, entry);
    return cloneCode(entry.value);
  }

  async setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    requireString(hash, "hash", MAX_BUNDLE_KEY_LENGTH);
    const normalizedTtl = this.normalizeTtl(ttlMs);
    const storedCode = cloneCode(code);
    const sizeBytes = byteLength(hash) + byteLength(storedCode.code) +
      byteLength(storedCode.sourceMap ?? "") + byteLength(storedCode.css ?? "") +
      ENTRY_OVERHEAD_BYTES;
    if (sizeBytes > this.maxSizeBytes) {
      throw new RangeError("Bundle code exceeds maxSizeBytes");
    }

    this.removeCode(hash, false);
    this.code.set(hash, {
      value: storedCode,
      expiry: this.expiryFromTtl(normalizedTtl),
      sizeBytes,
    });
    this.codeSizeBytes += sizeBytes;
    this.enforceLimits();
  }

  async deleteBundle(key: string): Promise<void> {
    requireString(key, "key", MAX_BUNDLE_KEY_LENGTH);
    this.removeMetadata(key, true);
  }

  async invalidateSource(source: string): Promise<number> {
    requireString(source, "source", MAX_BUNDLE_SOURCE_LENGTH);
    this.cleanupExpired();
    const keys = this.sourceIndex.get(source);
    if (!keys) return 0;

    const keysArray = [...keys];
    let invalidated = 0;
    for (const key of keysArray) {
      if (this.removeMetadata(key, true)) invalidated++;
    }
    return invalidated;
  }

  async clear(): Promise<void> {
    this.metadata.clear();
    this.code.clear();
    this.sourceIndex.clear();
    this.codeReferences.clear();
    this.metadataSizeBytes = 0;
    this.codeSizeBytes = 0;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getStats(): Promise<BundleManifestStats> {
    this.cleanupExpired();
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

    const stats: BundleManifestStats = {
      totalBundles: this.metadata.size,
      totalSize,
    };
    if (oldestBundle !== undefined) stats.oldestBundle = oldestBundle;
    if (newestBundle !== undefined) stats.newestBundle = newestBundle;
    return stats;
  }
}

class DisabledBundleManifestStore implements BundleManifestStore {
  getBundleMetadata(_key: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  setBundleMetadata(
    _key: string,
    _metadata: BundleMetadata,
    _ttlMs?: number,
  ): Promise<void> {
    return Promise.resolve();
  }

  getBundleCode(_hash: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  setBundleCode(_hash: string, _code: BundleCode, _ttlMs?: number): Promise<void> {
    return Promise.resolve();
  }

  deleteBundle(_key: string): Promise<void> {
    return Promise.resolve();
  }

  invalidateSource(_source: string): Promise<number> {
    return Promise.resolve(0);
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  getStats(): Promise<BundleManifestStats> {
    return Promise.resolve({ totalBundles: 0, totalSize: 0 });
  }
}

export function createDisabledBundleManifestStore(): BundleManifestStore {
  return new DisabledBundleManifestStore();
}

let manifestStore: BundleManifestStore = new InMemoryBundleManifestStore();

export function setBundleManifestStore(store: BundleManifestStore): void {
  manifestStore = store;
  logger.info("Bundle manifest store configured");
}

/** Return bundle manifest store. */
export function getBundleManifestStore(): BundleManifestStore {
  return manifestStore;
}

export { computeCodeHash, computeHash } from "./hash-utils.ts";
