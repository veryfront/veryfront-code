import { rendererLogger } from "#veryfront/utils";
import {
  type BundleCode,
  type BundleMetadata,
  computeCodeHash,
  computeHash,
  getBundleManifestStore,
  VERSION,
} from "#veryfront/utils";
import type { BundleManifestStore } from "#veryfront/utils/bundle-manifest.ts";
import { getBundleManifestTTL } from "#veryfront/utils/bundle-manifest-init.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { MdxBundle } from "#veryfront/types";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { ensureHttpBundlesExist } from "../esm/http-cache.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { errorLogName } from "../shared/log-context.ts";

const logger = rendererLogger.component("mdx-cache");
const MDX_CACHE_KEY_VERSION = "v2";
const MAX_CACHE_IDENTITY_DEPTH = 100;
const MAX_CACHE_IDENTITY_NODES = 10_000;
const MAX_CACHE_IDENTITY_FIELDS = 10_000;
const MAX_CACHE_IDENTITY_SERIALIZED_BYTES = 512 * 1024;
const MAX_CACHE_IDENTITY_PATH_BYTES = 16 * 1024;
const MAX_CACHE_IDENTITY_HASH_BYTES = 256;
const textEncoder = new TextEncoder();

/** Inputs that can change the compiled MDX output for one source document. */
export interface MDXCacheIdentity {
  /** Project root used to resolve source-relative imports. */
  projectDir?: string;
  /** Enable Studio node-position output. */
  studioEmbed?: boolean;
  /** Caller-provided frontmatter used for a cache write. */
  frontmatter?: Record<string, unknown>;
}

/** Inputs used to build the versioned cache key shared with compile singleflight. */
export interface MDXCacheKeyInput extends MDXCacheIdentity {
  /** Runtime compilation mode. */
  mode: "development" | "production";
  /** SHA-256 hash of the source content. */
  contentHash: string;
  /** Exact source path passed to the content processor. */
  filePath?: string;
}

interface IdentitySerializationState {
  parts: string[];
  bytes: number;
  nodes: number;
  fields: number;
  seen: Set<object>;
}

function appendIdentityToken(state: IdentitySerializationState, token: string): boolean {
  const remainingBytes = MAX_CACHE_IDENTITY_SERIALIZED_BYTES - state.bytes;
  if (token.length > remainingBytes) return false;
  const byteLength = textEncoder.encode(token).byteLength;
  if (byteLength > remainingBytes) return false;
  state.parts.push(token);
  state.bytes += byteLength;
  return true;
}

function serializeIdentityValue(
  value: unknown,
  state: IdentitySerializationState,
  depth: number,
): boolean {
  state.nodes++;
  if (depth > MAX_CACHE_IDENTITY_DEPTH || state.nodes > MAX_CACHE_IDENTITY_NODES) return false;
  if (value === null) return appendIdentityToken(state, "null");

  switch (typeof value) {
    case "string": {
      if (value.length > MAX_CACHE_IDENTITY_SERIALIZED_BYTES - state.bytes) return false;
      return appendIdentityToken(state, `string:${JSON.stringify(value)}`);
    }
    case "boolean":
      return appendIdentityToken(state, value ? "boolean:true" : "boolean:false");
    case "number": {
      const encoded = Number.isNaN(value)
        ? "NaN"
        : value === Infinity
        ? "Infinity"
        : value === -Infinity
        ? "-Infinity"
        : Object.is(value, -0)
        ? "-0"
        : String(value);
      return appendIdentityToken(state, `number:${encoded}`);
    }
    case "undefined":
      return appendIdentityToken(state, "undefined");
    case "bigint":
    case "function":
    case "symbol":
      return false;
  }

  if (state.seen.has(value)) return false;
  state.seen.add(value);

  try {
    if (value instanceof Date) {
      if (Reflect.ownKeys(value).length !== 0) return false;
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) &&
        appendIdentityToken(state, `date:${value.toISOString()}`);
    }

    if (Array.isArray(value)) {
      if (
        value.length > MAX_CACHE_IDENTITY_FIELDS - state.fields ||
        !appendIdentityToken(state, "array:[")
      ) {
        return false;
      }

      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || ownKeys[ownKeys.length - 1] !== "length") {
        return false;
      }
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
        state.fields++;
        if (index > 0 && !appendIdentityToken(state, ",")) return false;
        if (!serializeIdentityValue(descriptor.value, state, depth + 1)) return false;
      }
      return appendIdentityToken(state, "]");
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (!appendIdentityToken(state, "object:{")) return false;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_CACHE_IDENTITY_FIELDS - state.fields) return false;
    const fields: Array<{ key: string; value: unknown }> = [];
    for (const key of ownKeys) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
      fields.push({ key, value: descriptor.value });
    }
    state.fields += fields.length;

    fields.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const { key, value: fieldValue } = fields[fieldIndex]!;
      if (fieldIndex > 0 && !appendIdentityToken(state, ",")) return false;
      if (key.length > MAX_CACHE_IDENTITY_SERIALIZED_BYTES - state.bytes) return false;
      if (!appendIdentityToken(state, `${JSON.stringify(key)}:`)) return false;
      if (!serializeIdentityValue(fieldValue, state, depth + 1)) return false;
    }
    return appendIdentityToken(state, "}");
  } catch {
    return false;
  }
}

function serializeCacheIdentity(value: unknown): string | undefined {
  const state: IdentitySerializationState = {
    parts: [],
    bytes: 0,
    nodes: 0,
    fields: 0,
    seen: new Set(),
  };
  return serializeIdentityValue(value, state, 0) ? state.parts.join("") : undefined;
}

function isBoundedIdentityString(
  value: string,
  maxBytes: number,
  allowEmpty = true,
): boolean {
  if ((!allowEmpty && value.length === 0) || value.length > maxBytes) return false;
  return textEncoder.encode(value).byteLength <= maxBytes;
}

/** Build the opaque, versioned key for one complete MDX compilation identity. */
export async function createMDXCacheKey(input: MDXCacheKeyInput): Promise<string | undefined> {
  if (
    typeof input.projectDir !== "string" ||
    !isBoundedIdentityString(input.projectDir, MAX_CACHE_IDENTITY_PATH_BYTES, false) ||
    (input.filePath !== undefined &&
      !isBoundedIdentityString(input.filePath, MAX_CACHE_IDENTITY_PATH_BYTES)) ||
    !isBoundedIdentityString(input.contentHash, MAX_CACHE_IDENTITY_HASH_BYTES, false)
  ) {
    return undefined;
  }

  const frontmatter = serializeCacheIdentity(input.frontmatter ?? {});
  if (frontmatter === undefined) return undefined;

  const identityHash = await computeHash(JSON.stringify({
    cacheKeyVersion: MDX_CACHE_KEY_VERSION,
    runtimeVersion: VERSION,
    mode: input.mode,
    contentHash: input.contentHash,
    projectDir: input.projectDir,
    filePath: input.filePath ?? null,
    studioEmbed: input.studioEmbed === true,
    target: "server",
    baseUrl: null,
    frontmatter,
  }));

  return `mdx:${MDX_CACHE_KEY_VERSION}:${input.mode}:${identityHash}`;
}

/** Cached MDX compilation output and optional editor metadata. */
export interface MDXCompilationResult extends MdxBundle {
  /** Extracted heading metadata. */
  headings?: Array<{ id: string; text: string; level: number }>;
  /** Optional mapping from generated nodes to source positions. */
  nodeMap?: Map<number, unknown>;
  /** Rendered HTML returned by Markdown compilation. */
  rawHtml?: string;
}

const RECONSTRUCTABLE_BUNDLE_FIELDS = new Set([
  "compiledCode",
  "frontmatter",
  "globals",
  "headings",
  "nodeMap",
]);

function hasOnlyReconstructableBundleFields(bundle: MDXCompilationResult): boolean {
  const prototype = Object.getPrototypeOf(bundle);
  if (prototype !== Object.prototype && prototype !== null) return false;

  const ownKeys = Reflect.ownKeys(bundle);
  if (ownKeys.length > RECONSTRUCTABLE_BUNDLE_FIELDS.size) return false;
  for (const key of ownKeys) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(bundle, key);
    if (
      !descriptor || !descriptor.enumerable || !("value" in descriptor) ||
      !RECONSTRUCTABLE_BUNDLE_FIELDS.has(key)
    ) {
      return false;
    }
  }
  return true;
}

function isEmptyMap(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map && value.size === 0 && Reflect.ownKeys(value).length === 0;
}

function isReconstructableBundle(
  bundle: MDXCompilationResult,
  providedFrontmatter?: Record<string, unknown>,
): boolean {
  if (!hasOnlyReconstructableBundleFields(bundle)) return false;
  if (!Array.isArray(bundle.headings) || !isEmptyMap(bundle.nodeMap)) return false;
  if (serializeCacheIdentity(bundle.globals) !== "object:{}") return false;

  const compiledFrontmatter = serializeCacheIdentity(bundle.frontmatter);
  const inputFrontmatter = serializeCacheIdentity(providedFrontmatter ?? {});
  return compiledFrontmatter !== undefined && compiledFrontmatter === inputFrontmatter;
}

/** Construction options for the MDX compilation cache adapter. */
export interface MDXCacheAdapterOptions {
  /** Veryfront cache configuration. */
  config: VeryfrontConfig;
  /** Runtime mode used to partition cache keys and TTLs. */
  mode: "development" | "production";
  /** Project root used to isolate identical source across projects. */
  projectDir?: string;
}

/** Adapter for storing compiled MDX code in the bundle manifest store. */
export class MDXCacheAdapter {
  private config: VeryfrontConfig;
  private mode: "development" | "production";
  private projectIdentity: string;

  // Use getter to always get current store (important for tests that swap stores)
  /** Return the current store so tests and runtime initialization can replace it. */
  private get manifestStore(): BundleManifestStore {
    return getBundleManifestStore();
  }

  /** Create an MDX cache adapter. */
  constructor(options: MDXCacheAdapterOptions) {
    this.config = options.config;
    this.mode = options.mode;
    this.projectIdentity = options.projectDir ?? `unscoped:${crypto.randomUUID()}`;
  }

  /** Build a complete, mode-scoped compilation cache key. */
  private getCacheKey(
    contentHash: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    identity?: MDXCacheIdentity,
  ): Promise<string | undefined> {
    return createMDXCacheKey({
      mode: this.mode,
      contentHash,
      projectDir: identity?.projectDir ?? this.projectIdentity,
      filePath,
      studioEmbed: identity?.studioEmbed,
      frontmatter: frontmatter ?? identity?.frontmatter,
    });
  }

  /** Resolve the configured cache TTL. */
  private getTTL(): number | undefined {
    return getBundleManifestTTL(this.config, this.mode);
  }

  /** Compute the stable content hash used by cache records. */
  computeHash(content: string): Promise<string> {
    return computeHash(content);
  }

  /** Read and validate a cached MDX bundle. */
  async getCachedBundle(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    identity?: MDXCacheIdentity,
  ): Promise<MDXCompilationResult | undefined> {
    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = await this.getCacheKey(contentHash, frontmatter, filePath, identity);
      if (!cacheKey) return undefined;

      const metadata = await this.manifestStore.getBundleMetadata(cacheKey);
      if (!metadata) return undefined;

      const bundleCode = await this.manifestStore.getBundleCode(metadata.codeHash);
      if (!bundleCode) {
        logger.debug("Metadata found but code missing");
        return undefined;
      }

      // Validate HTTP bundle dependencies before returning cached bundle.
      // If any bundles can't be recovered from Redis, invalidate this cache entry
      // and return undefined to trigger recompilation with fresh bundles.
      const httpBundles = extractHttpBundlePaths(bundleCode.code);
      if (httpBundles.length > 0) {
        const cacheDir = getHttpBundleCacheDir();
        const failedHashes = await ensureHttpBundlesExist(httpBundles, cacheDir);

        if (failedHashes.length > 0) {
          logger.warn("HTTP bundle deps missing, invalidating cached MDX", {
            failedCount: failedHashes.length,
            totalBundles: httpBundles.length,
          });

          // Invalidate the cached bundle so future requests also recompile
          await this.manifestStore.deleteBundle(cacheKey);
          return undefined;
        }
      }

      logger.debug("Cache hit for MDX compilation", {
        size: metadata.size,
      });

      return {
        compiledCode: bundleCode.code,
        frontmatter:
          (frontmatter ?? identity?.frontmatter ?? {}) as MDXCompilationResult["frontmatter"],
        globals: {},
        headings: (metadata.meta?.headings as Array<{ id: string; text: string; level: number }>) ??
          [],
        nodeMap: new Map(),
      };
    } catch (error) {
      logger.warn("Failed to retrieve cached bundle", {
        errorName: errorLogName(error),
      });
      return undefined;
    }
  }

  /** Store a compiled MDX bundle and its metadata. */
  async setCachedBundle(
    content: string,
    bundle: MDXCompilationResult,
    filePath?: string,
    identity?: MDXCacheIdentity,
  ): Promise<void> {
    if (!bundle.compiledCode) {
      logger.debug("No compiled code to cache");
      return;
    }
    if (!isReconstructableBundle(bundle, identity?.frontmatter)) {
      logger.debug("Skipping MDX cache because compilation metadata cannot be reconstructed");
      return;
    }

    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = await this.getCacheKey(
        contentHash,
        identity?.frontmatter,
        filePath,
        identity,
      );
      if (!cacheKey) return;

      const bundleCode: BundleCode = { code: bundle.compiledCode };
      const codeHash = await computeCodeHash(bundleCode);
      const size = new TextEncoder().encode(bundle.compiledCode).length;

      const { version: reactVersion } = await import("react");

      const metadata: BundleMetadata = {
        hash: contentHash,
        codeHash,
        size,
        compiledAt: Date.now(),
        source: filePath ?? "unknown",
        mode: this.mode,
        meta: {
          type: "mdx",
          reactVersion,
          headings: bundle.headings ?? [],
        },
      };

      const ttl = this.getTTL();

      await this.manifestStore.setBundleCode(codeHash, bundleCode, ttl);
      await this.manifestStore.setBundleMetadata(cacheKey, metadata, ttl);

      logger.debug("Cached compiled MDX", {
        size,
        ttl,
      });
    } catch (error) {
      logger.warn("Failed to cache bundle", {
        errorName: errorLogName(error),
      });
    }
  }

  /**
   * Invalidate one exact compilation identity.
   *
   * Pass the same frontmatter, file path, and identity used for the cache
   * write. Omitting them targets the inline, standard compilation only.
   */
  async invalidateBundle(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    identity?: MDXCacheIdentity,
  ): Promise<void> {
    try {
      const contentHash = await this.computeHash(content);
      const cacheKey = await this.getCacheKey(contentHash, frontmatter, filePath, identity);
      if (!cacheKey) return;

      await this.manifestStore.deleteBundle(cacheKey);
      logger.debug("Invalidated cached bundle");
    } catch (error) {
      logger.debug("Failed to invalidate bundle", {
        errorName: errorLogName(error),
      });
    }
  }

  /** Invalidate all cached bundles associated with a source identifier. */
  async invalidateSource(source: string): Promise<number> {
    try {
      const count = await this.manifestStore.invalidateSource(source);
      logger.debug("Invalidated bundles for source", { count });
      return count;
    } catch (error) {
      logger.debug("Failed to invalidate source", {
        errorName: errorLogName(error),
      });
      return 0;
    }
  }

  /** Clear all bundle-manifest cache entries. */
  async clearAll(): Promise<void> {
    try {
      await this.manifestStore.clear();
      logger.debug("Cleared all cached bundles");
    } catch (error) {
      logger.debug("Failed to clear cache", {
        errorName: errorLogName(error),
      });
    }
  }

  /** Return aggregate bundle-manifest statistics. */
  async getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }> {
    try {
      return await this.manifestStore.getStats();
    } catch (error) {
      logger.debug("Failed to get stats", {
        errorName: errorLogName(error),
      });
      return { totalBundles: 0, totalSize: 0 };
    }
  }
}
