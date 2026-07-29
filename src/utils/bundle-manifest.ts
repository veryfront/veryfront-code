import { serverLogger } from "./logger/index.ts";
import {
  BUNDLE_MANIFEST_LRU_MAX_ENTRIES,
  BUNDLE_MANIFEST_MEMORY_MAX_CODE_SIZE_BYTES,
  BUNDLE_MANIFEST_MEMORY_MAX_METADATA_SIZE_BYTES,
} from "./constants/cache.ts";

const logger = serverLogger.component("bundle-manifest");
const MAX_BUNDLE_IDENTIFIER_CHARACTERS = 16 * 1024;
const MAX_BUNDLE_SOURCE_CHARACTERS = 64 * 1024;
const MAX_BUNDLE_METADATA_DEPTH = 64;
const MAX_BUNDLE_METADATA_NODES = 100_000;
const BUNDLE_METADATA_NODE_OVERHEAD_BYTES = 16;

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
  /** Aggregate retained metadata content budget, measured as bounded UTF-8 data. */
  maxMetadataSizeBytes?: number;
  /** Aggregate retained code, source-map, and CSS UTF-8 byte budget. */
  maxCodeSizeBytes?: number;
  now?: () => number;
}

interface StoredValue<T> {
  value: T;
  expiry?: number;
  sizeBytes: number;
}

interface MetadataSnapshotState {
  bytes: number;
  nodes: number;
  readonly maxBytes: number;
  readonly ancestors: WeakSet<object>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Count UTF-8 bytes without allocating an encoded copy of a potentially large
 * string. Lone surrogates match TextEncoder's U+FFFD replacement behavior.
 */
function getUtf8ByteLength(value: string, limit = Number.MAX_SAFE_INTEGER): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    let width: number;
    if (codeUnit <= 0x7f) {
      width = 1;
    } else if (codeUnit <= 0x7ff) {
      width = 2;
    } else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        width = 4;
        index++;
      } else {
        width = 3;
      }
    } else {
      width = 3;
    }

    if (width > limit - bytes) return Number.POSITIVE_INFINITY;
    bytes += width;
  }
  return bytes;
}

function validateBoundedString(
  value: unknown,
  label: string,
  maxCharacters: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxCharacters
  ) {
    throw new TypeError(
      `${label} must be ${allowEmpty ? "a" : "a non-empty"} bounded string`,
    );
  }
}

function getOwnDataValue(
  value: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) {
    throw new TypeError(`${label} cannot be an accessor property`);
  }
  if (!descriptor.enumerable) {
    throw new TypeError(`${label} must be enumerable`);
  }
  return descriptor.value;
}

function addMetadataBytes(state: MetadataSnapshotState, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > state.maxBytes - state.bytes) {
    throw new RangeError("Bundle metadata exceeds maxMetadataSizeBytes");
  }
  state.bytes += bytes;
}

function cloneMetadataValue(
  value: unknown,
  state: MetadataSnapshotState,
  depth = 0,
): unknown {
  state.nodes++;
  if (state.nodes > MAX_BUNDLE_METADATA_NODES) {
    throw new RangeError("Bundle metadata contains too many values");
  }
  if (depth > MAX_BUNDLE_METADATA_DEPTH) {
    throw new RangeError("Bundle metadata is too deeply nested");
  }
  addMetadataBytes(state, BUNDLE_METADATA_NODE_OVERHEAD_BYTES);

  if (value === null) {
    addMetadataBytes(state, 1);
    return null;
  }

  switch (typeof value) {
    case "undefined":
      return undefined;
    case "boolean":
      addMetadataBytes(state, 1);
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Bundle metadata contains a non-finite number");
      }
      addMetadataBytes(state, 8);
      return value;
    case "string": {
      const bytes = getUtf8ByteLength(value, state.maxBytes - state.bytes);
      addMetadataBytes(state, bytes);
      return value;
    }
    case "bigint":
    case "function":
    case "symbol":
      throw new TypeError(`Bundle metadata contains unsupported ${typeof value} data`);
  }

  if (state.ancestors.has(value)) {
    throw new TypeError("Bundle metadata cannot contain cycles");
  }
  state.ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_BUNDLE_METADATA_NODES) {
        throw new RangeError("Bundle metadata array contains too many values");
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || descriptor.get || descriptor.set) {
          throw new TypeError("Bundle metadata arrays must be dense data arrays");
        }
        result.push(cloneMetadataValue(descriptor.value, state, depth + 1));
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9]\d*)$/.test(key) ||
          Number(key) >= value.length
        ) {
          throw new TypeError("Bundle metadata arrays cannot have custom properties");
        }
      }
      return result;
    }

    if (!isPlainRecord(value)) {
      throw new TypeError("Bundle metadata contains an unsupported object type");
    }

    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      if (typeof key !== "string") {
        throw new TypeError("Bundle metadata cannot contain symbol properties");
      }
      if (descriptor.get || descriptor.set) {
        throw new TypeError("Bundle metadata cannot contain accessor properties");
      }
      const keyBytes = getUtf8ByteLength(key, state.maxBytes - state.bytes);
      addMetadataBytes(state, keyBytes);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloneMetadataValue(descriptor.value, state, depth + 1),
        writable: true,
      });
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

function validateBundleMetadata(metadata: unknown): asserts metadata is BundleMetadata {
  if (!isPlainRecord(metadata)) throw new TypeError("Bundle metadata must be a plain object");

  const hash = getOwnDataValue(metadata, "hash", "Bundle metadata hash");
  const codeHash = getOwnDataValue(metadata, "codeHash", "Bundle metadata codeHash");
  const size = getOwnDataValue(metadata, "size", "Bundle metadata size");
  const compiledAt = getOwnDataValue(metadata, "compiledAt", "Bundle metadata compiledAt");
  const source = getOwnDataValue(metadata, "source", "Bundle metadata source");
  const scope = getOwnDataValue(metadata, "scope", "Bundle metadata scope");
  const mode = getOwnDataValue(metadata, "mode", "Bundle metadata mode");
  const meta = getOwnDataValue(metadata, "meta", "Bundle metadata meta");

  validateBoundedString(hash, "Bundle metadata hash", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
  validateBoundedString(codeHash, "Bundle metadata codeHash", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
  validateBoundedString(source, "Bundle metadata source", MAX_BUNDLE_SOURCE_CHARACTERS);
  if (scope !== undefined) {
    validateBoundedString(scope, "Bundle metadata scope", MAX_BUNDLE_SOURCE_CHARACTERS);
  }
  if (!Number.isSafeInteger(size) || (size as number) < 0) {
    throw new TypeError("Bundle metadata size must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(compiledAt) || (compiledAt as number) < 0) {
    throw new TypeError("Bundle metadata compiledAt must be a non-negative safe integer");
  }
  if (mode !== "development" && mode !== "production") {
    throw new TypeError("Bundle metadata mode must be development or production");
  }
  if (meta !== undefined && !isPlainRecord(meta)) {
    throw new TypeError("Bundle metadata meta must be a plain object");
  }
}

function snapshotBundleMetadata(
  metadata: BundleMetadata,
  maxBytes: number,
): { value: BundleMetadata; sizeBytes: number } {
  validateBundleMetadata(metadata);
  const state: MetadataSnapshotState = {
    bytes: 0,
    nodes: 0,
    maxBytes,
    ancestors: new WeakSet<object>(),
  };
  const value = cloneMetadataValue(metadata, state);
  return { value: value as BundleMetadata, sizeBytes: state.bytes };
}

function snapshotBundleCode(
  bundleCode: BundleCode,
  maxBytes: number,
): { value: BundleCode; sizeBytes: number } {
  if (!isPlainRecord(bundleCode)) throw new TypeError("Bundle code must be a plain object");

  const code = getOwnDataValue(bundleCode, "code", "Bundle code");
  const sourceMap = getOwnDataValue(bundleCode, "sourceMap", "Bundle code sourceMap");
  const css = getOwnDataValue(bundleCode, "css", "Bundle code css");
  if (typeof code !== "string") throw new TypeError("Bundle code must be a string");
  if (sourceMap !== undefined && typeof sourceMap !== "string") {
    throw new TypeError("Bundle code sourceMap must be a string");
  }
  if (css !== undefined && typeof css !== "string") {
    throw new TypeError("Bundle code css must be a string");
  }

  for (const key of Reflect.ownKeys(bundleCode)) {
    const descriptor = Object.getOwnPropertyDescriptor(bundleCode, key);
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string" || !["code", "sourceMap", "css"].includes(key)) {
      throw new TypeError("Bundle code contains an unsupported property");
    }
    if (descriptor.get || descriptor.set) {
      throw new TypeError(`Bundle code ${key} cannot be an accessor property`);
    }
  }

  let sizeBytes = 0;
  for (const value of [code, sourceMap, css]) {
    if (value === undefined) continue;
    const bytes = getUtf8ByteLength(value, maxBytes - sizeBytes);
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes - sizeBytes) {
      throw new RangeError("Bundle code exceeds maxCodeSizeBytes");
    }
    sizeBytes += bytes;
  }

  return {
    value: {
      code,
      ...(sourceMap === undefined ? {} : { sourceMap }),
      ...(css === undefined ? {} : { css }),
    },
    sizeBytes,
  };
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
  private currentMetadataSizeBytes = 0;
  private currentCodeSizeBytes = 0;
  private readonly maxMetadataEntries: number;
  private readonly maxCodeEntries: number;
  private readonly maxMetadataSizeBytes: number;
  private readonly maxCodeSizeBytes: number;
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
    this.maxMetadataSizeBytes = this.validateCapacity(
      options.maxMetadataSizeBytes ?? BUNDLE_MANIFEST_MEMORY_MAX_METADATA_SIZE_BYTES,
      "maxMetadataSizeBytes",
    );
    this.maxCodeSizeBytes = this.validateCapacity(
      options.maxCodeSizeBytes ?? BUNDLE_MANIFEST_MEMORY_MAX_CODE_SIZE_BYTES,
      "maxCodeSizeBytes",
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

  private getNow(): number {
    const now = this.now();
    if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("now must return a non-negative finite bounded timestamp");
    }
    return now;
  }

  private getExpiry(ttlMs: number | undefined, now: number): number | undefined {
    if (ttlMs === undefined) return undefined;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError("ttlMs must be a non-negative finite number");
    }
    const expiry = now + ttlMs;
    if (!Number.isFinite(expiry) || expiry > Number.MAX_SAFE_INTEGER) {
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

  private deleteCodeEntry(hash: string): StoredValue<BundleCode> | undefined {
    const entry = this.code.get(hash);
    if (!entry) return undefined;
    this.code.delete(hash);
    this.currentCodeSizeBytes -= entry.sizeBytes;
    return entry;
  }

  private removeMetadata(key: string, removeOrphanCode = true): BundleMetadata | undefined {
    const entry = this.metadata.get(key);
    if (!entry) return undefined;

    this.metadata.delete(key);
    this.currentMetadataSizeBytes -= entry.sizeBytes;
    this.removeSourceReference(key, entry.value);
    this.removeCodeReference(key, entry.value.codeHash);
    if (removeOrphanCode && !this.codeIndex.has(entry.value.codeHash)) {
      this.removeCode(entry.value.codeHash);
    }
    return entry.value;
  }

  private removeCode(hash: string): BundleCode | undefined {
    const entry = this.deleteCodeEntry(hash);
    const metadataKeys = [...(this.codeIndex.get(hash) ?? [])];
    for (const key of metadataKeys) {
      this.removeMetadata(key, false);
    }
    this.codeIndex.delete(hash);
    return entry?.value;
  }

  private sweepExpired(now = this.getNow()): void {
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
    while (
      this.metadata.size > this.maxMetadataEntries ||
      this.currentMetadataSizeBytes > this.maxMetadataSizeBytes
    ) {
      const oldestKey = this.metadata.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.removeMetadata(oldestKey);
    }
  }

  private enforceCodeCapacity(): void {
    while (
      this.code.size > this.maxCodeEntries ||
      this.currentCodeSizeBytes > this.maxCodeSizeBytes
    ) {
      const oldestHash = this.code.keys().next().value as string | undefined;
      if (oldestHash === undefined) return;
      this.removeCode(oldestHash);
    }
  }

  async getBundleMetadata(key: string): Promise<BundleMetadata | undefined> {
    validateBoundedString(key, "Bundle metadata key", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
    this.sweepExpired();
    const metadata = this.touch(this.metadata, key)?.value;
    return metadata === undefined ? undefined : cloneBundleMetadata(metadata);
  }

  async setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void> {
    validateBoundedString(key, "Bundle metadata key", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
    const snapshot = snapshotBundleMetadata(metadata, this.maxMetadataSizeBytes);
    const now = this.getNow();
    const expiry = this.getExpiry(ttlMs, now);
    this.sweepExpired(now);
    const previous = this.removeMetadata(key, false);
    if (expiry !== undefined && now >= expiry) {
      if (previous && !this.codeIndex.has(previous.codeHash)) this.removeCode(previous.codeHash);
      if (!this.codeIndex.has(snapshot.value.codeHash)) this.removeCode(snapshot.value.codeHash);
      return;
    }

    this.metadata.set(key, { value: snapshot.value, expiry, sizeBytes: snapshot.sizeBytes });
    this.currentMetadataSizeBytes += snapshot.sizeBytes;

    const sourceIndexKey = this.getSourceIndexKey(snapshot.value.source, snapshot.value.scope);
    const keys = this.sourceIndex.get(sourceIndexKey) ?? new Set<string>();
    keys.add(key);
    this.sourceIndex.set(sourceIndexKey, keys);

    const codeKeys = this.codeIndex.get(snapshot.value.codeHash) ?? new Set<string>();
    codeKeys.add(key);
    this.codeIndex.set(snapshot.value.codeHash, codeKeys);

    if (
      previous && previous.codeHash !== snapshot.value.codeHash &&
      !this.codeIndex.has(previous.codeHash)
    ) {
      this.removeCode(previous.codeHash);
    }
    this.scheduleExpiry(expiry);
    this.enforceMetadataCapacity();
  }

  async getBundleCode(hash: string): Promise<BundleCode | undefined> {
    validateBoundedString(hash, "Bundle code hash", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
    this.sweepExpired();
    const bundleCode = this.touch(this.code, hash)?.value;
    return bundleCode === undefined ? undefined : cloneBundleCode(bundleCode);
  }

  async setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void> {
    validateBoundedString(hash, "Bundle code hash", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
    const snapshot = snapshotBundleCode(code, this.maxCodeSizeBytes);
    const now = this.getNow();
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
    this.deleteCodeEntry(hash);
    this.code.set(hash, { value: snapshot.value, expiry, sizeBytes: snapshot.sizeBytes });
    this.currentCodeSizeBytes += snapshot.sizeBytes;
    this.scheduleExpiry(expiry);
    this.enforceCodeCapacity();
  }

  async deleteBundle(key: string): Promise<void> {
    validateBoundedString(key, "Bundle metadata key", MAX_BUNDLE_IDENTIFIER_CHARACTERS);
    this.sweepExpired();
    this.removeMetadata(key);
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    validateBoundedString(
      prefix,
      "Bundle metadata prefix",
      MAX_BUNDLE_IDENTIFIER_CHARACTERS,
      true,
    );
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
    validateBoundedString(source, "Bundle metadata source", MAX_BUNDLE_SOURCE_CHARACTERS);
    if (scope !== undefined) {
      validateBoundedString(scope, "Bundle metadata scope", MAX_BUNDLE_SOURCE_CHARACTERS);
    }
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
    this.currentMetadataSizeBytes = 0;
    this.currentCodeSizeBytes = 0;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getStats(prefix?: string): Promise<BundleManifestStats> {
    if (prefix !== undefined) {
      validateBoundedString(
        prefix,
        "Bundle metadata prefix",
        MAX_BUNDLE_IDENTIFIER_CHARACTERS,
        true,
      );
    }
    this.sweepExpired();
    let totalSize = 0;
    let oldestBundle: number | undefined;
    let newestBundle: number | undefined;
    let totalBundles = 0;

    for (const [key, { value }] of this.metadata) {
      if (prefix !== undefined && !key.startsWith(prefix)) continue;
      totalBundles++;
      totalSize = value.size > Number.MAX_SAFE_INTEGER - totalSize
        ? Number.MAX_SAFE_INTEGER
        : totalSize + value.size;
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
const REQUIRED_BUNDLE_MANIFEST_STORE_METHODS = [
  "getBundleMetadata",
  "setBundleMetadata",
  "getBundleCode",
  "setBundleCode",
  "deleteBundle",
  "invalidateSource",
  "clear",
  "isAvailable",
  "getStats",
] as const;

export function setBundleManifestStore(store: BundleManifestStore): void {
  if ((typeof store !== "object" && typeof store !== "function") || store === null) {
    throw new TypeError("Bundle manifest store must be an object");
  }
  for (const method of REQUIRED_BUNDLE_MANIFEST_STORE_METHODS) {
    if (typeof Reflect.get(store, method) !== "function") {
      throw new TypeError(`Bundle manifest store ${method} must be a function`);
    }
  }
  const invalidatePrefix = Reflect.get(store, "invalidatePrefix");
  if (invalidatePrefix !== undefined && typeof invalidatePrefix !== "function") {
    throw new TypeError("Bundle manifest store invalidatePrefix must be a function when provided");
  }
  manifestStore = store;
  logger.debug("Bundle manifest store configured");
}

/** Return bundle manifest store. */
export function getBundleManifestStore(): BundleManifestStore {
  return manifestStore;
}

export { computeCodeHash, computeHash } from "./hash-utils.ts";
