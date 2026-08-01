/**
 * Static File Service
 *
 * Business logic for static file serving, extracted from StaticHandler.
 * Handles manifest resolution, file candidate determination, and cache strategy.
 *
 * Supports optional FileSystemRepository injection for testing and advanced use cases.
 *
 * @module server/services/static/static-file-service
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CacheStrategy } from "#veryfront/security";
import { createSecureFs, SECURITY_VIOLATION } from "#veryfront/security";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileSystemRepository } from "#veryfront/repositories/types.ts";
import {
  getExtension,
  hasHashedFilename,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "#veryfront/utils/path-utils.ts";
import { normalizeChunkPath } from "../../utils/chunk-utils.ts";
import { computeEtag } from "../../handlers/utils/etag.ts";
import { getContentType as getContentTypeFromExt } from "../../handlers/utils/content-types.ts";
import { STATIC_ASSET_MAX_BYTES } from "#veryfront/utils/constants/static-assets.ts";
import { captureFileSystemCapabilities } from "#veryfront/platform/adapters/file-system-capabilities.ts";
import {
  captureBoundedTextReader,
  copyFixedUint8ArrayWithinLimit,
} from "#veryfront/platform/adapters/bounded-text-reader.ts";

export type StaticAssetUnavailableReason =
  | "read-capability-unavailable"
  | "byte-limit"
  | "invalid-metadata"
  | "invalid-reader-result";

/** A static representation cannot be served within the runtime safety contract. */
export class StaticAssetUnavailableError extends Error {
  override readonly name = "StaticAssetUnavailableError";

  constructor(
    readonly reason: StaticAssetUnavailableReason,
    message: string,
  ) {
    super(message);
  }
}

/** Metadata resolved without reading the static response body. */
export interface StaticFileMetadataResult {
  /** Absolute path to the file. */
  path: string;
  /** Declared byte size, or null when the backing store omits it. */
  size: number | null;
  /** Content type based on extension. */
  contentType: string;
  /** Cache strategy to use. */
  cacheStrategy: CacheStrategy;
  /** Source directory (manifest, dist, public). */
  source: "manifest" | "dist" | "public";
}

/**
 * Result of resolving a static file
 */
export interface StaticFileResult extends Omit<StaticFileMetadataResult, "size"> {
  /** File content as bytes */
  data: Uint8Array;
  /** Actual admitted response-body size. */
  size: number;
  /** ETag for caching */
  etag: string;
}

/**
 * Options for resolving static files
 */
export interface StaticFileOptions {
  /** Project directory root */
  projectDir: string;
  /** Runtime adapter for file system access */
  adapter: RuntimeAdapter;
  /** Whether in preview mode (affects caching) */
  isPreviewMode: boolean;
  /** Whether this is a local filesystem project */
  isLocalProject: boolean;
  /**
   * Stable project/content-generation identity within the active adapter.
   * Remote multi-project callers should include both project and release/branch
   * identity so manifests from different hosted sources never share a slot.
   */
  manifestCacheIdentity?: string;
}

/** Default per-file admission bound shared by production build and runtime. */
export const DEFAULT_STATIC_ASSET_MAX_BYTES = STATIC_ASSET_MAX_BYTES;

export interface StaticFileServiceOptions {
  /**
   * Maximum bytes admitted for one static response body. Exact readers reject
   * any source that contains even one byte beyond this ceiling.
   */
  maxAssetBytes?: number;
}

/**
 * Manifest index for fast asset lookup
 */
interface ManifestIndex {
  assets: Map<string, string>;
  mtime: number | null;
  size: number | null;
}

interface ManifestAdmissionLimits {
  maxAssetEntries: number;
  maxBytes: number;
  maxChunks: number;
  maxListEntries: number;
  maxPathLength: number;
  maxRoutes: number;
}

interface ManifestLoad {
  mtime: number | null;
  promise: Promise<ManifestIndex | null>;
  size: number | null;
  token: object;
}

interface ManifestOwnerCache {
  accessOrder: Map<string, true>;
  manifestCache: Map<string, ManifestIndex>;
  manifestLoading: Map<string, ManifestLoad>;
  maxEntries: number;
}

const DEFAULT_MANIFEST_CACHE_MAX_ENTRIES = 128;
const MAX_MANIFEST_STABILITY_ATTEMPTS = 2;

/**
 * Static build-manifest admission limits.
 *
 * These mirror the production build ceilings: route/chunk collections are
 * capped at 10,000, asset paths at 2,048 characters, and the total referenced
 * asset work at the 100,000-entry route-scan ceiling. The 32 MiB wire limit is
 * above the 5 MiB chunk-manifest limit while matching the build pipeline's
 * bounded total-source budget.
 */
const DEFAULT_MANIFEST_ADMISSION_LIMITS: Readonly<ManifestAdmissionLimits> = Object.freeze({
  maxAssetEntries: 100_000,
  maxBytes: 32 * 1024 * 1024,
  maxChunks: 10_000,
  maxListEntries: 10_000,
  maxPathLength: 2_048,
  maxRoutes: 10_000,
});

interface StaticFileCandidate {
  /** Absolute path exposed in StaticFileResult. */
  path: string;
  /** Project-relative path passed to the rooted filesystem. */
  fsPath: string;
  source: "manifest" | "dist" | "public";
}

/**
 * Filesystem interface for StaticFileService
 * Abstraction over SecureFs and FileSystemRepository
 */
interface FileSystemLike {
  readFileBytes?(path: string): Promise<Uint8Array>;
  readFileBytesBounded?(path: string, byteLimit: number): Promise<Uint8Array>;
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  readonly maxWholeFileReadBytes?: number;
  stat(
    path: string,
  ): Promise<{ isFile: boolean; mtime: Date | null; size?: number | null }>;
}

type StaticFilesystemMethodKey = "stat";

function snapshotStaticFilesystemMethod(
  fileSystem: object,
  key: StaticFilesystemMethodKey,
  required: boolean,
): ((...args: unknown[]) => unknown) | undefined {
  let owner: object | null = fileSystem;
  const seen = new Set<object>();
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === Object.prototype) break;
    if (isProxyWithoutHooks(owner) || seen.has(owner)) {
      throw new TypeError("Static filesystem capabilities must not use proxies");
    }
    seen.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`Static filesystem ${key} must be a data-property method`);
      }
      if (descriptor.value === undefined && !required) return undefined;
      if (
        typeof descriptor.value !== "function" ||
        isProxyWithoutHooks(descriptor.value)
      ) {
        throw new TypeError(`Static filesystem ${key} must be a non-proxy function`);
      }
      return descriptor.value as (...args: unknown[]) => unknown;
    }
    owner = Object.getPrototypeOf(owner);
  }
  if (owner !== null) throw new TypeError("Static filesystem prototype chain is too deep");
  if (required) throw new TypeError(`Static filesystem must provide ${key}`);
  return undefined;
}

function snapshotStaticFilesystem(fileSystem: FileSystemRepository): FileSystemLike {
  if (isProxyWithoutHooks(fileSystem)) {
    throw new TypeError("Static filesystem repository proxies are not supported");
  }
  const stat = snapshotStaticFilesystemMethod(fileSystem, "stat", true)!;
  const capabilities = captureFileSystemCapabilities(
    fileSystem,
    "Static filesystem repository",
  );

  const snapshot = Object.create(null) as FileSystemLike;
  Object.defineProperty(snapshot, "stat", {
    value: (path: string) =>
      Reflect.apply(stat, fileSystem, [path]) as ReturnType<FileSystemLike["stat"]>,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  if (capabilities.readFileBytes !== undefined) {
    Object.defineProperty(snapshot, "readFileBytes", {
      value: capabilities.readFileBytes,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (capabilities.readFileBytesBounded !== undefined) {
    Object.defineProperty(snapshot, "readFileBytesBounded", {
      value: capabilities.readFileBytesBounded,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (capabilities.readFileBytesWithinLimit !== undefined) {
    Object.defineProperty(snapshot, "readFileBytesWithinLimit", {
      value: capabilities.readFileBytesWithinLimit,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (capabilities.wholeFileReader !== undefined) {
    Object.defineProperty(snapshot, "maxWholeFileReadBytes", {
      value: capabilities.wholeFileReader.maximumBytes,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

/**
 * Injection interface for testing StaticFileService dependencies
 */
interface StaticFileServiceDeps {
  manifestCache?: Map<string, ManifestIndex>;
  manifestLoading?: Map<string, ManifestLoad>;
  manifestCacheMaxEntries?: number;
  manifestAdmissionLimits?: Partial<ManifestAdmissionLimits>;
}

let injectedDeps: StaticFileServiceDeps | null = null;
let injectedOwnerCache: ManifestOwnerCache | null = null;

/**
 * Inject dependencies for testing. Pass null to reset to defaults.
 */
export function __injectDepsForTests(deps: StaticFileServiceDeps | null): void {
  injectedDeps = deps;
  injectedOwnerCache = deps
    ? {
      accessOrder: new Map(),
      manifestCache: deps.manifestCache ?? new Map(),
      manifestLoading: deps.manifestLoading ?? new Map(),
      maxEntries: Math.max(
        1,
        deps.manifestCacheMaxEntries ?? DEFAULT_MANIFEST_CACHE_MAX_ENTRIES,
      ),
    }
    : null;
}

function snapshotOwnDataRecord(
  value: unknown,
  label: string,
  maxProperties: number,
): Map<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError(`${label} proxies are not supported`);
  }

  let prototype: object | null;
  let keys: Array<string | symbol>;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} could not be inspected safely`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (keys.length > maxProperties) {
    throw new RangeError(`${label} exceeds its property limit of ${maxProperties}`);
  }

  const snapshot = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} must not contain symbol properties`);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label}.${key} could not be inspected safely`);
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own data property`);
    }
    snapshot.set(key, descriptor.value);
  }
  return snapshot;
}

function snapshotDenseOwnDataArray(
  value: unknown,
  label: string,
  maxEntries: number,
): unknown[] {
  if (isProxyWithoutHooks(value)) {
    throw new TypeError(`${label} proxies are not supported`);
  }
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw new TypeError(`${label} could not be inspected safely`);
  }
  if (!isArray) throw new TypeError(`${label} must be an array`);

  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    throw new TypeError(`${label}.length could not be inspected safely`);
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${label} must have a safe own data-property length`);
  }
  if (length > maxEntries) {
    throw new RangeError(`${label} exceeds its entry limit of ${maxEntries}`);
  }

  let keys: Array<string | symbol>;
  try {
    keys = Reflect.ownKeys(value as object);
  } catch {
    throw new TypeError(`${label} could not be inspected safely`);
  }
  if (
    keys.length !== length + 1 ||
    keys.some((key) =>
      typeof key !== "string" ||
      (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key))
    )
  ) {
    throw new TypeError(`${label} must be dense and contain no extra properties`);
  }

  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      throw new TypeError(`${label}[${index}] could not be inspected safely`);
    }
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label} must contain dense own data properties`);
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function assertManifestAssetPath(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    value !== value.normalize("NFC") || value.startsWith("/") || value.includes("\\") ||
    value.includes(":") || value.includes("?") || value.includes("#") || /["'<>]/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a bounded safe relative asset path`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      throw new TypeError(`${label} must not contain control characters`);
    }
  }
}

function normalizeAdmittedChunkPath(value: string, base: string): string {
  const normalized = normalizeChunkPath(value, base);
  if (normalized === null) {
    throw new TypeError("Static build manifest asset path could not be normalized");
  }
  return normalized;
}

function normalizeManifestAdmissionLimits(
  overrides?: Partial<ManifestAdmissionLimits>,
): ManifestAdmissionLimits {
  const limits = { ...DEFAULT_MANIFEST_ADMISSION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Static manifest ${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function snapshotManifestGeneration(
  stat: unknown,
  limits: ManifestAdmissionLimits,
): { mtime: number | null; size: number | null } {
  const statSnapshot = snapshotOwnDataRecord(stat, "Static build manifest stat", 16);
  if (statSnapshot.get("isFile") !== true) {
    throw new TypeError("Static build manifest path must be a file");
  }

  const mtime = statSnapshot.get("mtime");
  let normalizedMtime: number | null;
  if (mtime === null) {
    normalizedMtime = null;
  } else {
    let timestamp: number;
    try {
      timestamp = Date.prototype.getTime.call(mtime);
    } catch {
      throw new TypeError("Static build manifest mtime must be a Date or null");
    }
    if (!Number.isFinite(timestamp)) {
      throw new RangeError("Static build manifest mtime must be finite");
    }
    normalizedMtime = timestamp;
  }

  const size = statSnapshot.get("size");
  if (size === undefined || size === null) {
    return { mtime: normalizedMtime, size: null };
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("Static build manifest size must be a non-negative safe integer");
  }
  if (size > limits.maxBytes) {
    throw new RangeError(
      `Static build manifest byte limit of ${limits.maxBytes} was exceeded`,
    );
  }
  return { mtime: normalizedMtime, size };
}

function isSameManifestGeneration(
  left: { mtime: number | null; size: number | null },
  right: { mtime: number | null; size: number | null },
): boolean {
  return left.mtime === right.mtime && left.size === right.size;
}

function normalizeAssetByteLimit(options: StaticFileServiceOptions): number {
  const snapshot = snapshotOwnDataRecord(options, "StaticFileService options", 1);
  const value = snapshot.get("maxAssetBytes") ?? DEFAULT_STATIC_ASSET_MAX_BYTES;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(
      "StaticFileService maxAssetBytes must be a positive safe integer",
    );
  }
  if ((value as number) > STATIC_ASSET_MAX_BYTES) {
    throw new RangeError(
      `StaticFileService maxAssetBytes must not exceed ${STATIC_ASSET_MAX_BYTES}`,
    );
  }
  return value as number;
}

function admitStaticAssetStat(
  stat: unknown,
  maxAssetBytes: number,
): { isFile: boolean; size: number | null } {
  const snapshot = snapshotOwnDataRecord(stat, "Static asset stat", 16);
  if (snapshot.get("isFile") !== true) return { isFile: false, size: null };

  const size = snapshot.get("size");
  if (size === undefined || size === null) return { isFile: true, size: null };
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new StaticAssetUnavailableError(
      "invalid-metadata",
      "Static asset size must be a non-negative safe integer",
    );
  }
  if (size > maxAssetBytes) {
    throw new StaticAssetUnavailableError(
      "byte-limit",
      `Static asset byte limit of ${maxAssetBytes} was exceeded`,
    );
  }
  return { isFile: true, size };
}

type StaticReadPlan =
  | {
    readonly kind: "exact";
    readonly read: (path: string, byteLimit: number) => Promise<Uint8Array>;
  }
  | {
    readonly kind: "fixed-ceiling";
    readonly maximumBytes: number;
    readonly read: (path: string) => Promise<Uint8Array>;
  };

function resolveStaticReadPlan(
  fs: FileSystemLike,
  maxAssetBytes: number,
  declaredSize: number | null,
): StaticReadPlan {
  if (typeof fs.readFileBytesWithinLimit === "function") {
    return { kind: "exact", read: fs.readFileBytesWithinLimit };
  }

  const maximumBytes = fs.maxWholeFileReadBytes;
  if (
    typeof fs.readFileBytes === "function" &&
    Number.isSafeInteger(maximumBytes) &&
    (maximumBytes as number) > 0
  ) {
    if ((maximumBytes as number) > maxAssetBytes) {
      throw new StaticAssetUnavailableError(
        "read-capability-unavailable",
        `Static asset fixed-ceiling whole-file reader exceeds the configured byte limit of ${maxAssetBytes}`,
      );
    }
    if (declaredSize !== null && declaredSize > (maximumBytes as number)) {
      throw new StaticAssetUnavailableError(
        "invalid-metadata",
        `Static asset declared size exceeds the fixed whole-file read ceiling of ${maximumBytes}`,
      );
    }
    return {
      kind: "fixed-ceiling",
      maximumBytes: maximumBytes as number,
      read: fs.readFileBytes,
    };
  }

  throw new StaticAssetUnavailableError(
    "read-capability-unavailable",
    "Static asset serving requires an exact bounded reader or an admitted fixed-ceiling whole-file reader",
  );
}

async function readStaticAssetBytes(
  plan: StaticReadPlan,
  path: string,
  maxAssetBytes: number,
): Promise<Uint8Array> {
  let value: unknown;
  if (plan.kind === "exact") {
    try {
      value = await plan.read(path, maxAssetBytes);
    } catch (cause) {
      if (
        isNativeErrorWithoutHooks(cause) &&
        readNativeErrorNameWithoutHooks(cause) === "RangeError"
      ) {
        throw new StaticAssetUnavailableError(
          "byte-limit",
          `Static asset byte limit of ${maxAssetBytes} was exceeded`,
        );
      }
      throw cause;
    }
  } else {
    value = await plan.read(path);
  }

  try {
    return copyFixedUint8ArrayWithinLimit(
      value,
      plan.kind === "exact" ? maxAssetBytes : plan.maximumBytes,
      "Static asset",
    );
  } catch {
    throw new StaticAssetUnavailableError(
      "invalid-reader-result",
      plan.kind === "fixed-ceiling"
        ? "Static asset reader exceeded its advertised ceiling or returned an invalid buffer"
        : "Static asset reader returned bytes outside its admitted fixed-buffer contract",
    );
  }
}

export class StaticFileService {
  private static cacheEpoch = 0;

  private readonly fsRepo?: FileSystemRepository;
  private readonly fsRepoSnapshot?: FileSystemLike;
  private readonly maxAssetBytes: number;
  private manifestCacheEpoch = StaticFileService.cacheEpoch;
  private manifestCachesByOwner = new WeakMap<object, ManifestOwnerCache>();

  constructor(
    fsRepo?: FileSystemRepository,
    options: StaticFileServiceOptions = {},
  ) {
    this.fsRepo = fsRepo;
    this.fsRepoSnapshot = fsRepo === undefined ? undefined : snapshotStaticFilesystem(fsRepo);
    this.maxAssetBytes = normalizeAssetByteLimit(options);
  }

  private getManifestOwner(options: StaticFileOptions): object {
    return this.fsRepo ?? options.adapter;
  }

  private getManifestOwnerCache(options: StaticFileOptions): ManifestOwnerCache {
    if (injectedDeps && injectedOwnerCache) return injectedOwnerCache;

    if (this.manifestCacheEpoch !== StaticFileService.cacheEpoch) {
      this.manifestCachesByOwner = new WeakMap();
      this.manifestCacheEpoch = StaticFileService.cacheEpoch;
    }

    const owner = this.getManifestOwner(options);
    let ownerCache = this.manifestCachesByOwner.get(owner);
    if (!ownerCache) {
      ownerCache = {
        accessOrder: new Map(),
        manifestCache: new Map(),
        manifestLoading: new Map(),
        maxEntries: DEFAULT_MANIFEST_CACHE_MAX_ENTRIES,
      };
      this.manifestCachesByOwner.set(owner, ownerCache);
    }
    return ownerCache;
  }

  private touchManifestCacheEntry(ownerCache: ManifestOwnerCache, cacheKey: string): void {
    ownerCache.accessOrder.delete(cacheKey);
    ownerCache.accessOrder.set(cacheKey, true);
  }

  private claimManifestCacheSlot(ownerCache: ManifestOwnerCache, cacheKey: string): void {
    if (ownerCache.accessOrder.has(cacheKey)) {
      this.touchManifestCacheEntry(ownerCache, cacheKey);
      return;
    }

    while (ownerCache.accessOrder.size >= ownerCache.maxEntries) {
      const oldestKey = ownerCache.accessOrder.keys().next().value;
      if (oldestKey === undefined) break;
      ownerCache.accessOrder.delete(oldestKey);
      ownerCache.manifestCache.delete(oldestKey);
      // Removing the load record retires its token. Its eventual completion
      // cannot publish into this owner cache.
      ownerCache.manifestLoading.delete(oldestKey);
    }
    ownerCache.accessOrder.set(cacheKey, true);
  }

  private getFileSystem(options: StaticFileOptions): FileSystemLike {
    if (this.fsRepoSnapshot) return this.fsRepoSnapshot;

    return createSecureFs({
      baseDir: options.projectDir,
      adapter: options.adapter,
      context: "static-serving",
      validationOptions: { checkExists: false },
    });
  }

  async resolveFile(
    requestPath: string,
    options: StaticFileOptions,
  ): Promise<StaticFileResult | null> {
    const fs = this.getFileSystem(options);
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const candidates = await this.buildCandidates(normalizedPath, options, fs);

    for (const candidate of candidates) {
      const result = await this.tryResolveCandidate(
        candidate,
        requestPath,
        options,
        fs,
      );
      if (result) return result;
    }

    return null;
  }

  /** Resolve representation metadata without reading the response body. */
  async resolveFileMetadata(
    requestPath: string,
    options: StaticFileOptions,
  ): Promise<StaticFileMetadataResult | null> {
    const fs = this.getFileSystem(options);
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const candidates = await this.buildCandidates(normalizedPath, options, fs);

    for (const candidate of candidates) {
      const result = await this.tryResolveCandidateMetadata(
        candidate,
        requestPath,
        options,
        fs,
      );
      if (result) return result;
    }

    return null;
  }

  private async buildCandidates(
    normalizedPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<StaticFileCandidate[]> {
    const candidates: StaticFileCandidate[] = [];
    const seen = new Set<string>();

    const addCandidate = (
      fsPath: string,
      source: "manifest" | "dist" | "public",
    ): void => {
      const normalizedFsPath = normalizePath(fsPath);
      if (seen.has(normalizedFsPath)) return;
      const absolutePath = normalizePath(joinPath(options.projectDir, normalizedFsPath));
      const sourceDir = source === "manifest" ? "dist" : source;
      const sourceRoot = normalizePath(joinPath(options.projectDir, sourceDir));
      if (!isWithinDirectory(sourceRoot, absolutePath)) {
        throw SECURITY_VIOLATION.create({
          detail: "Static file candidate is outside its source directory",
        });
      }
      seen.add(normalizedFsPath);
      candidates.push({
        path: absolutePath,
        fsPath: normalizedFsPath,
        source,
      });
    };

    if (!options.isLocalProject) {
      const manifestPath = await this.resolveManifestAsset(normalizedPath, options, fs);
      if (manifestPath) addCandidate(manifestPath, "manifest");
    }

    const dirs = options.isLocalProject && !options.isPreviewMode
      ? ["public"] as const
      : ["dist", "public"] as const;

    for (const dir of dirs) {
      addCandidate(joinPath(dir, normalizedPath), dir);
    }

    return candidates;
  }

  private async tryResolveCandidate(
    candidate: StaticFileCandidate,
    requestPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<StaticFileResult | null> {
    try {
      const metadata = await this.tryResolveCandidateMetadata(
        candidate,
        requestPath,
        options,
        fs,
      );
      if (!metadata) return null;

      const readPlan = resolveStaticReadPlan(
        fs,
        this.maxAssetBytes,
        metadata.size,
      );
      const data = await readStaticAssetBytes(
        readPlan,
        candidate.fsPath,
        this.maxAssetBytes,
      );
      const etag = computeEtag(data);

      return {
        ...metadata,
        data,
        size: data.byteLength,
        etag,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  private async tryResolveCandidateMetadata(
    candidate: StaticFileCandidate,
    requestPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<StaticFileMetadataResult | null> {
    try {
      const admission = admitStaticAssetStat(
        await fs.stat(candidate.fsPath),
        this.maxAssetBytes,
      );
      if (!admission.isFile) return null;
      resolveStaticReadPlan(fs, this.maxAssetBytes, admission.size);

      return {
        path: candidate.path,
        size: admission.size,
        contentType: getContentTypeFromExt(getExtension(candidate.path)),
        cacheStrategy: this.determineCacheStrategy(candidate, requestPath, options),
        source: candidate.source,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  private determineCacheStrategy(
    candidate: StaticFileCandidate,
    requestPath: string,
    options: StaticFileOptions,
  ): CacheStrategy {
    if (options.isPreviewMode && !options.isLocalProject) return "no-cache";

    const isVeryfrontAsset = requestPath.includes("/_veryfront/") ||
      requestPath.includes("/_vf/assets/");
    if (
      hasHashedFilename(candidate.path) ||
      (isVeryfrontAsset && (candidate.source === "dist" || candidate.source === "manifest"))
    ) {
      return "immutable";
    }

    return "medium";
  }

  private async resolveManifestAsset(
    requestPath: string,
    options: StaticFileOptions,
    fs: FileSystemLike,
  ): Promise<string | null> {
    const index = await this.loadManifestIndex(options, fs);
    if (!index) return null;

    const normalized = normalizePath(requestPath.startsWith("/") ? requestPath : `/${requestPath}`);
    return index.assets.get(normalized) ?? null;
  }

  private async loadManifestIndex(
    options: StaticFileOptions,
    fs: FileSystemLike,
    stabilityAttempt = 1,
  ): Promise<ManifestIndex | null> {
    const cacheKey = JSON.stringify([
      "static-manifest-cache-v1",
      normalizePath(options.projectDir),
      options.manifestCacheIdentity ?? null,
    ]);
    const manifestPath = "dist/_veryfront/manifest.json";
    const admissionLimits = normalizeManifestAdmissionLimits(
      injectedDeps?.manifestAdmissionLimits,
    );
    const manifestReader = captureBoundedTextReader(
      fs,
      "Static build manifest filesystem",
    );

    let stat: { isFile: boolean; mtime: Date | null; size?: number | null };
    try {
      stat = await fs.stat(manifestPath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }

    const currentGeneration = snapshotManifestGeneration(stat, admissionLimits);
    const ownerCache = this.getManifestOwnerCache(options);

    const cached = ownerCache.manifestCache.get(cacheKey);
    if (
      currentGeneration.mtime !== null && cached !== undefined &&
      isSameManifestGeneration(cached, currentGeneration)
    ) {
      this.touchManifestCacheEntry(ownerCache, cacheKey);
      return cached;
    }
    ownerCache.manifestCache.delete(cacheKey);

    const existingLoader = ownerCache.manifestLoading.get(cacheKey);
    if (
      currentGeneration.mtime !== null && existingLoader !== undefined &&
      isSameManifestGeneration(existingLoader, currentGeneration)
    ) {
      this.touchManifestCacheEntry(ownerCache, cacheKey);
      return await existingLoader.promise;
    }
    if (existingLoader) {
      ownerCache.manifestLoading.delete(cacheKey);
      ownerCache.accessOrder.delete(cacheKey);
    }

    this.claimManifestCacheSlot(ownerCache, cacheKey);
    const token = {};

    const loader = (async (): Promise<ManifestIndex | null> => {
      try {
        const { content: manifestRaw } = await manifestReader.readUtf8(
          manifestPath,
          admissionLimits.maxBytes,
          "Static build manifest",
        );
        const postReadGeneration = snapshotManifestGeneration(
          await fs.stat(manifestPath),
          admissionLimits,
        );
        if (!isSameManifestGeneration(currentGeneration, postReadGeneration)) {
          if (stabilityAttempt >= MAX_MANIFEST_STABILITY_ATTEMPTS) {
            throw new Error(
              `Static build manifest changed while being read after ${MAX_MANIFEST_STABILITY_ATTEMPTS} attempts`,
            );
          }
          return await this.loadManifestIndex(
            options,
            fs,
            stabilityAttempt + 1,
          );
        }
        const assets = this.extractManifestAssets(
          JSON.parse(manifestRaw),
          admissionLimits,
        );
        const indexValue: ManifestIndex = {
          assets,
          mtime: currentGeneration.mtime,
          size: currentGeneration.size,
        };
        const ownsSlot = ownerCache.manifestLoading.get(cacheKey)?.token === token;
        // A null mtime or a pre/post-read stat mismatch cannot prove that the
        // bytes belong to one stable source generation. Coalesce concurrent
        // reads, but publish only an unchanged, identifiable generation.
        if (
          ownsSlot && currentGeneration.mtime !== null
        ) {
          ownerCache.manifestCache.set(cacheKey, indexValue);
          this.touchManifestCacheEntry(ownerCache, cacheKey);
        }
        return indexValue;
      } catch (error) {
        if (ownerCache.manifestLoading.get(cacheKey)?.token === token) {
          ownerCache.manifestCache.delete(cacheKey);
        }
        if (isNotFoundError(error)) return null;
        throw error;
      } finally {
        if (ownerCache.manifestLoading.get(cacheKey)?.token === token) {
          ownerCache.manifestLoading.delete(cacheKey);
          if (!ownerCache.manifestCache.has(cacheKey)) {
            ownerCache.accessOrder.delete(cacheKey);
          }
        }
      }
    })();

    ownerCache.manifestLoading.set(cacheKey, {
      mtime: currentGeneration.mtime,
      promise: loader,
      size: currentGeneration.size,
      token,
    });
    return await loader;
  }

  private extractManifestAssets(
    manifest: unknown,
    limits: ManifestAdmissionLimits = DEFAULT_MANIFEST_ADMISSION_LIMITS,
  ): Map<string, string> {
    const normalizedLimits = normalizeManifestAdmissionLimits(limits);
    const manifestRecord = snapshotOwnDataRecord(manifest, "Static build manifest", 32);
    const assets = new Map<string, string>();
    let assetReferences = 0;

    const addAsset = (requestPath: string): void => {
      if (assetReferences >= normalizedLimits.maxAssetEntries) {
        throw new RangeError(
          `Static build manifest asset-entry limit of ${normalizedLimits.maxAssetEntries} was exceeded`,
        );
      }
      assetReferences++;
      const normalized = normalizePath(
        requestPath.startsWith("/") ? requestPath : `/${requestPath}`,
      );
      if (!assets.has(normalized) && assets.size >= normalizedLimits.maxAssetEntries) {
        throw new RangeError(
          `Static build manifest asset-entry limit of ${normalizedLimits.maxAssetEntries} was exceeded`,
        );
      }
      assets.set(normalized, normalizePath(joinPath("dist", normalized)));
    };

    const chunkManifestValue = manifestRecord.get("chunks");
    if (chunkManifestValue !== undefined && chunkManifestValue !== null) {
      const chunkManifest = snapshotOwnDataRecord(
        chunkManifestValue,
        "Static build manifest chunks",
        16,
      );
      const chunkRecordsValue = chunkManifest.get("chunks");
      if (chunkRecordsValue !== undefined) {
        const chunkRecords = snapshotOwnDataRecord(
          chunkRecordsValue,
          "Static build manifest chunk records",
          normalizedLimits.maxChunks,
        );
        for (const [chunkKey, chunkInfo] of chunkRecords) {
          assertManifestAssetPath(
            chunkKey,
            "Static build manifest chunk key",
            normalizedLimits.maxPathLength,
          );
          const chunk = snapshotOwnDataRecord(
            chunkInfo,
            `Static build manifest chunk ${JSON.stringify(chunkKey)}`,
            16,
          );
          const file = chunk.get("file");
          if (file !== undefined) {
            assertManifestAssetPath(
              file,
              `Static build manifest chunk ${JSON.stringify(chunkKey)} file`,
              normalizedLimits.maxPathLength,
            );
            addAsset(
              normalizeAdmittedChunkPath(file, "/_veryfront"),
            );
          }
          const css = chunk.get("css");
          if (css !== undefined) {
            assertManifestAssetPath(
              css,
              `Static build manifest chunk ${JSON.stringify(chunkKey)} css`,
              normalizedLimits.maxPathLength,
            );
            addAsset(
              normalizeAdmittedChunkPath(css, "/_veryfront"),
            );
          }
          const imports = chunk.get("imports");
          if (imports !== undefined) {
            const dependencies = snapshotDenseOwnDataArray(
              imports,
              `Static build manifest chunk ${JSON.stringify(chunkKey)} imports`,
              normalizedLimits.maxListEntries,
            );
            for (let index = 0; index < dependencies.length; index++) {
              const dependency = dependencies[index];
              assertManifestAssetPath(
                dependency,
                `Static build manifest chunk ${JSON.stringify(chunkKey)} imports[${index}]`,
                normalizedLimits.maxPathLength,
              );
              addAsset(
                normalizeAdmittedChunkPath(dependency, "/_veryfront/chunks"),
              );
            }
          }
        }
      }

      const sharedValue = chunkManifest.get("shared");
      if (sharedValue !== undefined) {
        const shared = snapshotDenseOwnDataArray(
          sharedValue,
          "Static build manifest shared chunks",
          normalizedLimits.maxListEntries,
        );
        for (let index = 0; index < shared.length; index++) {
          const sharedAsset = shared[index];
          assertManifestAssetPath(
            sharedAsset,
            `Static build manifest shared chunks[${index}]`,
            normalizedLimits.maxPathLength,
          );
          addAsset(
            normalizeAdmittedChunkPath(sharedAsset, "/_veryfront/chunks"),
          );
        }
      }
    }

    const routesValue = manifestRecord.get("routes");
    if (routesValue !== undefined) {
      const routes = snapshotDenseOwnDataArray(
        routesValue,
        "Static build manifest routes",
        normalizedLimits.maxRoutes,
      );
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = snapshotOwnDataRecord(
          routes[routeIndex],
          `Static build manifest routes[${routeIndex}]`,
          16,
        );
        const routeChunksValue = route.get("chunks");
        if (routeChunksValue === undefined) continue;
        const routeChunks = snapshotDenseOwnDataArray(
          routeChunksValue,
          `Static build manifest routes[${routeIndex}].chunks`,
          normalizedLimits.maxListEntries,
        );
        for (let chunkIndex = 0; chunkIndex < routeChunks.length; chunkIndex++) {
          const chunk = routeChunks[chunkIndex];
          assertManifestAssetPath(
            chunk,
            `Static build manifest routes[${routeIndex}].chunks[${chunkIndex}]`,
            normalizedLimits.maxPathLength,
          );
          addAsset(
            normalizeAdmittedChunkPath(chunk, "/_veryfront/chunks"),
          );
        }
      }
    }

    return assets;
  }

  isAssetRequest(pathname: string): boolean {
    if (pathname.includes("/.veryfront/") || pathname.startsWith("/.veryfront")) return false;
    if (pathname.endsWith(".md")) return false;
    if (this.isDeniedDotfile(pathname)) return false;
    return pathname.includes(".") || pathname.startsWith("/_veryfront/") ||
      pathname.startsWith("/_vf/assets/");
  }

  private isDeniedDotfile(pathname: string): boolean {
    const segments = pathname.split("/");
    for (const segment of segments) {
      if (segment.startsWith(".") && segment !== ".well-known") {
        return true;
      }
    }
    return false;
  }

  static clearCache(): void {
    StaticFileService.cacheEpoch++;
    injectedOwnerCache?.manifestCache.clear();
    injectedOwnerCache?.manifestLoading.clear();
    injectedOwnerCache?.accessOrder.clear();
  }
}
