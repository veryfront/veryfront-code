import { rendererLogger } from "#veryfront/utils";
import {
  type BundleCode,
  type BundleMetadata,
  computeCodeHash,
  computeHash,
  getBundleManifestStore,
} from "#veryfront/utils";
import { getBundleManifestTTL } from "#veryfront/utils/bundle-manifest-init.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { MdxBundle } from "#veryfront/types";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { ensureHttpBundlesExist } from "../esm/http-cache.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { DEFAULT_REACT_VERSION } from "#veryfront/transforms/esm/package-registry.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { tryResolve as tryResolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";

const logger = rendererLogger.component("mdx-cache");
const MDX_CACHE_FORMAT_VERSION = 2;
const MAX_CACHED_VALUE_DEPTH = 64;
const MAX_CACHED_VALUE_NODES = 100_000;
const MAX_COMPILATION_INPUT_UTF8_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_VALUE_UTF8_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_ARTIFACT_UTF8_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_STRING_UTF8_BYTES = 1024 * 1024;
const MAX_CACHED_METADATA_STRING_UTF8_BYTES = 64 * 1024;
const MAX_CACHED_HEADINGS = 10_000;
const MAX_CACHED_NODE_MAP_ENTRIES = 100_000;
const MAX_PROCESSOR_IDENTITY_UTF8_BYTES = 4 * 1024;
const utf8Encoder = new TextEncoder();

function frameIdentityPart(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Serialize compilation inputs without depending on object insertion order.
 * Frontmatter is part of executable MDX input, so silently dropping an
 * unsupported value would allow distinct compilations to share a cache key.
 */
interface CompilationInputState {
  nodes: number;
  bytes: number;
  readonly ancestors: WeakSet<object>;
}

function getOwnDataValue(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) {
    throw new TypeError(`${label} cannot contain accessor properties`);
  }
  return descriptor.value;
}

function countCompilationString(
  value: string,
  state: CompilationInputState,
  label: string,
): string {
  if (value.length > MAX_COMPILATION_INPUT_UTF8_BYTES) {
    throw new TypeError(`${label} is too large for MDX cache identity`);
  }
  const bytes = utf8Encoder.encode(value).byteLength;
  state.bytes += bytes;
  if (state.bytes > MAX_COMPILATION_INPUT_UTF8_BYTES) {
    throw new TypeError("MDX compilation identity exceeds its byte limit");
  }
  return value;
}

function serializeCompilationInput(
  value: unknown,
  state: CompilationInputState = {
    nodes: 0,
    bytes: 0,
    ancestors: new WeakSet<object>(),
  },
  depth = 0,
): string {
  state.nodes++;
  if (state.nodes > MAX_CACHED_VALUE_NODES) {
    throw new TypeError("MDX compilation identity contains too many values");
  }
  if (depth > MAX_CACHED_VALUE_DEPTH) {
    throw new TypeError("MDX compilation identity is too deeply nested");
  }
  if (value === null) return "null";

  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "boolean":
      return value ? "boolean:true" : "boolean:false";
    case "string":
      return `string:${frameIdentityPart(countCompilationString(value, state, "MDX string"))}`;
    case "number":
      if (Number.isNaN(value)) return "number:NaN";
      if (value === Infinity) return "number:Infinity";
      if (value === -Infinity) return "number:-Infinity";
      if (Object.is(value, -0)) return "number:-0";
      return `number:${value}`;
    case "bigint":
      return `bigint:${countCompilationString(String(value), state, "MDX bigint")}`;
    case "function":
    case "symbol":
      throw new TypeError(`Unsupported MDX frontmatter value: ${typeof value}`);
  }

  if (state.ancestors.has(value)) {
    throw new TypeError("Cyclic MDX frontmatter cannot be used as a compilation identity");
  }
  state.ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("Sparse arrays cannot be used in MDX frontmatter");
        }
        entries.push(frameIdentityPart(
          serializeCompilationInput(
            getOwnDataValue(value, index, "MDX frontmatter array"),
            state,
            depth + 1,
          ),
        ));
      }
      return `array:${value.length}:${entries.join("")}`;
    }

    if (value instanceof Date) {
      const timestamp = Date.prototype.getTime.call(value);
      if (Number.isNaN(timestamp)) {
        throw new TypeError("Invalid Date in MDX frontmatter");
      }
      return `date:${new Date(timestamp).toISOString()}`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Unsupported MDX frontmatter object type",
      );
    }

    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => {
        countCompilationString(key, state, "MDX object key");
        const serialized = serializeCompilationInput(
          getOwnDataValue(value, key, "MDX frontmatter object"),
          state,
          depth + 1,
        );
        return `${frameIdentityPart(key)}${frameIdentityPart(serialized)}`;
      });
    return `object:${entries.join("")}`;
  } finally {
    state.ancestors.delete(value);
  }
}

interface CacheCloneState {
  nodes: number;
  bytes: number;
  readonly ancestors: WeakSet<object>;
}

function createCacheCloneState(): CacheCloneState {
  return { nodes: 0, bytes: 0, ancestors: new WeakSet<object>() };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneBoundedCachedString(
  value: string,
  state: CacheCloneState,
  label: string,
  maxBytes = MAX_CACHED_STRING_UTF8_BYTES,
): string {
  if (value.length > maxBytes) throw new TypeError(`Cached MDX ${label} is too large`);
  const bytes = utf8Encoder.encode(value).byteLength;
  if (bytes > maxBytes) throw new TypeError(`Cached MDX ${label} is too large`);
  state.bytes += bytes;
  if (state.bytes > MAX_CACHED_VALUE_UTF8_BYTES) {
    throw new TypeError("MDX cache metadata exceeds its byte limit");
  }
  return value;
}

/** Clone only values that will survive JSON-backed manifest stores unchanged. */
function cloneCachedValue(
  value: unknown,
  state: CacheCloneState,
  depth = 0,
): unknown {
  state.nodes++;
  if (state.nodes > MAX_CACHED_VALUE_NODES) {
    throw new TypeError("MDX cache metadata is too large");
  }
  if (depth > MAX_CACHED_VALUE_DEPTH) {
    throw new TypeError("MDX cache metadata is too deeply nested");
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return cloneBoundedCachedString(value, state, "metadata string");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("MDX cache metadata contains a non-finite number");
    }
    return value;
  }
  if (value === undefined) throw new TypeError("MDX cache metadata contains undefined");
  if (typeof value !== "object") {
    throw new TypeError(`MDX cache metadata contains unsupported ${typeof value} data`);
  }
  if (state.ancestors.has(value)) throw new TypeError("MDX cache metadata contains a cycle");

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("MDX cache metadata contains a sparse array");
        }
        result.push(cloneCachedValue(
          getOwnDataValue(value, index, "MDX cache metadata array"),
          state,
          depth + 1,
        ));
      }
      return result;
    }

    if (!isPlainRecord(value)) {
      throw new TypeError(
        "MDX cache metadata contains an unsupported object type",
      );
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      cloneBoundedCachedString(
        key,
        state,
        "metadata key",
        MAX_CACHED_METADATA_STRING_UTF8_BYTES,
      );
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new TypeError("MDX cache metadata contains accessor properties");
      }
      result[key] = cloneCachedValue(descriptor.value, state, depth + 1);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

function cloneCachedRecord(
  value: unknown,
  field: string,
  state = createCacheCloneState(),
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`Cached MDX ${field} must be an object`);
  const cloned = cloneCachedValue(value, state);
  if (!isPlainRecord(cloned)) throw new TypeError(`Cached MDX ${field} must be an object`);
  return cloned;
}

function cloneHeadings(
  value: unknown,
  state = createCacheCloneState(),
): Array<{ id: string; text: string; level: number }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("Cached MDX headings must be an array");
  if (value.length > MAX_CACHED_HEADINGS) {
    throw new TypeError("Cached MDX headings contain too many entries");
  }

  const result: Array<{ id: string; text: string; level: number }> = [];
  for (let index = 0; index < value.length; index++) {
    const heading = getOwnDataValue(value, index, "MDX headings array");
    if (!Object.hasOwn(value, index) || !isPlainRecord(heading)) {
      throw new TypeError("Cached MDX headings contain an invalid entry");
    }
    const id = getOwnDataValue(heading, "id", "MDX heading");
    const text = getOwnDataValue(heading, "text", "MDX heading");
    const level = getOwnDataValue(heading, "level", "MDX heading");
    if (
      typeof id !== "string" || typeof text !== "string" ||
      typeof level !== "number" || !Number.isSafeInteger(level) || level < 1 || level > 6
    ) {
      throw new TypeError("Cached MDX headings contain an invalid entry");
    }
    result.push({
      id: cloneBoundedCachedString(
        id,
        state,
        "heading id",
        MAX_CACHED_METADATA_STRING_UTF8_BYTES,
      ),
      text: cloneBoundedCachedString(
        text,
        state,
        "heading text",
        MAX_CACHED_METADATA_STRING_UTF8_BYTES,
      ),
      level,
    });
  }
  return result;
}

function cloneNodeMapEntries(
  value: unknown,
  state = createCacheCloneState(),
): Array<[number, unknown]> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("Cached MDX nodeMapEntries must be an array");
  if (value.length > MAX_CACHED_NODE_MAP_ENTRIES) {
    throw new TypeError("Cached MDX nodeMapEntries contain too many entries");
  }

  const seen = new Set<number>();
  const result: Array<[number, unknown]> = [];
  for (let index = 0; index < value.length; index++) {
    const entry = getOwnDataValue(value, index, "MDX nodeMapEntries array");
    const key = Array.isArray(entry) ? getOwnDataValue(entry, 0, "MDX nodeMap entry") : undefined;
    const mapValue = Array.isArray(entry)
      ? getOwnDataValue(entry, 1, "MDX nodeMap entry")
      : undefined;
    if (
      !Object.hasOwn(value, index) || !Array.isArray(entry) || entry.length !== 2 ||
      !Object.hasOwn(entry, 0) || !Object.hasOwn(entry, 1) ||
      typeof key !== "number" || !Number.isSafeInteger(key)
    ) {
      throw new TypeError("Cached MDX nodeMapEntries contain an invalid entry");
    }
    if (seen.has(key)) throw new TypeError("Cached MDX nodeMapEntries contain duplicates");
    seen.add(key);
    result.push([key, cloneCachedValue(mapValue, state, 1)]);
  }
  return result;
}

function snapshotNodeMap(
  nodeMap: Map<number, unknown> | undefined,
  state = createCacheCloneState(),
): Array<[number, unknown]> | undefined {
  if (nodeMap === undefined) return undefined;
  if (!(nodeMap instanceof Map)) throw new TypeError("MDX nodeMap must be a Map");
  if (nodeMap.size > MAX_CACHED_NODE_MAP_ENTRIES) {
    throw new TypeError("MDX nodeMap contains too many entries");
  }
  return cloneNodeMapEntries([...Map.prototype.entries.call(nodeMap)], state);
}

/** Detach mutable compilation output before returning it to independent callers. */
export function cloneMDXCompilationResult(result: MDXCompilationResult): MDXCompilationResult {
  try {
    return structuredClone(result);
  } catch (error) {
    throw new TypeError("MDX compilation result is not safely cloneable", { cause: error });
  }
}

class UnsupportedScopedBundleManifestOperationError extends Error {
  constructor(operation: string) {
    super(
      `Configured bundle manifest store does not support ${operation}; ` +
        "use a store that explicitly declares tenant-safe scoped capabilities",
    );
    this.name = "UnsupportedScopedBundleManifestOperationError";
  }
}

export interface MDXCompilationResult extends MdxBundle {
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
  rawHtml?: string;
}

export interface MDXCacheAdapterOptions {
  config: VeryfrontConfig;
  mode: "development" | "production";
  /** Stable project/content-source identity used to isolate shared process caches. */
  scope?: string;
}

export class MDXCacheAdapter {
  private readonly config: VeryfrontConfig;
  private readonly mode: "development" | "production";
  private readonly scope?: string;
  private readonly enabled: boolean;
  private readonly reactVersion: string;
  private readonly compilerIdentity?: string;

  // Use getter to always get current store (important for tests that swap stores)
  private get manifestStore() {
    return getBundleManifestStore();
  }

  constructor(options: MDXCacheAdapterOptions) {
    if (
      options.scope !== undefined &&
      (options.scope.length === 0 ||
        utf8Encoder.encode(options.scope).byteLength > MAX_CACHED_METADATA_STRING_UTF8_BYTES)
    ) {
      throw new TypeError("MDX cache scope must be a non-empty bounded string");
    }
    this.config = options.config;
    this.mode = options.mode;
    this.scope = options.scope;
    this.enabled = options.config.cache?.bundleManifest?.enabled ?? options.mode === "production";
    this.reactVersion = options.config.react?.version ?? DEFAULT_REACT_VERSION;
    try {
      this.compilerIdentity = serializeCompilationInput({
        cacheFormat: MDX_CACHE_FORMAT_VERSION,
        frameworkVersion: RUNTIME_VERSION,
        reactVersion: this.reactVersion,
        importMap: options.config.resolve?.importMap ?? null,
        moduleServerUrl: options.config.dev?.moduleServerUrl ?? null,
        tailwind: options.config.tailwind ?? null,
        experimental: options.config.experimental ?? null,
      });
    } catch (error) {
      logger.warn("MDX cache disabled for unsupported compiler configuration", { error });
    }
  }

  private getProcessorCacheIdentity(): string {
    const processor = tryResolveContract<ContentProcessor>("ContentProcessor");
    const identity = processor?.cacheIdentity;
    if (
      typeof identity !== "string" || identity.trim() !== identity || identity.length === 0 ||
      identity.length > MAX_PROCESSOR_IDENTITY_UTF8_BYTES ||
      utf8Encoder.encode(identity).byteLength > MAX_PROCESSOR_IDENTITY_UTF8_BYTES ||
      /\p{Cc}/u.test(identity)
    ) {
      throw new TypeError(
        "Resolved ContentProcessor must declare a bounded stable cacheIdentity",
      );
    }
    return identity;
  }

  private getCachePrefix(): string {
    if (this.scope === undefined) return `mdx:${this.mode}:`;
    return `mdx:scope:${this.scope.length}:${this.scope}:${this.mode}:`;
  }

  private async getCompilationIdentityParts(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    studioEmbed = false,
  ): Promise<{ cacheKey: string; contentHash: string; processorCacheIdentity: string }> {
    if (this.compilerIdentity === undefined) {
      throw new TypeError(
        "MDX compiler configuration cannot be represented safely in cache identity",
      );
    }
    const processorCacheIdentity = this.getProcessorCacheIdentity();
    const contentHash = await this.computeHash(content);
    const variant = serializeCompilationInput({
      compilerIdentity: this.compilerIdentity,
      processorCacheIdentity,
      filePath: filePath ?? null,
      frontmatter: frontmatter ?? {},
      studioEmbed,
    });
    const variantHash = await computeHash(variant);
    return {
      cacheKey: `${this.getCachePrefix()}${contentHash}:${variantHash}`,
      contentHash,
      processorCacheIdentity,
    };
  }

  private getTTL(): number | undefined {
    return getBundleManifestTTL(this.config, this.mode);
  }

  computeHash(content: string): Promise<string> {
    return computeHash(content);
  }

  /**
   * Return the complete identity for cache storage and in-flight compilation.
   * Every input here can change emitted code and therefore must remain aligned
   * with callers of getCachedBundle/setCachedBundle.
   */
  async computeCompilationIdentity(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    studioEmbed = false,
  ): Promise<string> {
    return (await this.getCompilationIdentityParts(
      content,
      frontmatter,
      filePath,
      studioEmbed,
    )).cacheKey;
  }

  async getCachedBundle(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    studioEmbed = false,
  ): Promise<MDXCompilationResult | undefined> {
    if (!this.enabled) return undefined;

    let invalidation:
      | { cacheKey: string; failedHashes: string[]; totalBundles: number }
      | undefined;
    let cachedResult: MDXCompilationResult | undefined;
    try {
      const { cacheKey, contentHash, processorCacheIdentity } = await this
        .getCompilationIdentityParts(
          content,
          frontmatter,
          filePath,
          studioEmbed,
        );

      const metadata = await this.manifestStore.getBundleMetadata(cacheKey);
      if (!metadata) return undefined;
      if (!isPlainRecord(metadata) || !isPlainRecord(metadata.meta)) return undefined;
      const metadataHash = getOwnDataValue(metadata, "hash", "MDX bundle metadata");
      const codeHash = getOwnDataValue(metadata, "codeHash", "MDX bundle metadata");
      const metadataSize = getOwnDataValue(metadata, "size", "MDX bundle metadata");
      const compiledAt = getOwnDataValue(metadata, "compiledAt", "MDX bundle metadata");
      const source = getOwnDataValue(metadata, "source", "MDX bundle metadata");
      const scope = getOwnDataValue(metadata, "scope", "MDX bundle metadata");
      const mode = getOwnDataValue(metadata, "mode", "MDX bundle metadata");
      const meta = metadata.meta;
      if (
        metadataHash !== contentHash ||
        typeof codeHash !== "string" || !/^[a-f0-9]{64}$/.test(codeHash) ||
        typeof metadataSize !== "number" || !Number.isSafeInteger(metadataSize) ||
        metadataSize < 0 ||
        typeof compiledAt !== "number" || !Number.isSafeInteger(compiledAt) || compiledAt < 0 ||
        source !== (filePath ?? "unknown") || scope !== this.scope || mode !== this.mode ||
        getOwnDataValue(meta, "type", "MDX bundle metadata") !== "mdx" ||
        getOwnDataValue(meta, "compilerIdentity", "MDX bundle metadata") !==
          this.compilerIdentity ||
        getOwnDataValue(meta, "processorCacheIdentity", "MDX bundle metadata") !==
          processorCacheIdentity ||
        getOwnDataValue(meta, "reactVersion", "MDX bundle metadata") !== this.reactVersion
      ) {
        logger.debug("Ignoring MDX cache entry with incompatible compiler identity", {
          filePath,
          cacheKey,
        });
        return undefined;
      }

      const bundleCode = await this.manifestStore.getBundleCode(codeHash);
      if (!isPlainRecord(bundleCode)) {
        logger.debug("Metadata found but code missing", {
          filePath,
          codeHash,
        });
        return undefined;
      }
      const rawCompiledCode = getOwnDataValue(bundleCode, "code", "MDX bundle code");
      if (typeof rawCompiledCode !== "string") return undefined;
      const cloneState = createCacheCloneState();
      const compiledCode = cloneBoundedCachedString(
        rawCompiledCode,
        cloneState,
        "compiled code",
        MAX_CACHED_ARTIFACT_UTF8_BYTES,
      );
      if (
        utf8Encoder.encode(compiledCode).byteLength !== metadataSize ||
        await computeCodeHash({ code: compiledCode }) !== codeHash
      ) {
        logger.warn("Ignoring MDX cache entry with invalid executable code integrity", {
          filePath,
          codeHash,
        });
        return undefined;
      }

      // Validate HTTP bundle dependencies before returning cached bundle.
      // If any bundles can't be recovered from Redis, invalidate this cache entry
      // and return undefined to trigger recompilation with fresh bundles.
      const httpBundles = extractHttpBundlePaths(compiledCode);
      if (httpBundles.length > 0) {
        const cacheDir = getHttpBundleCacheDir();
        const failedHashes = await ensureHttpBundlesExist(httpBundles, cacheDir);

        if (failedHashes.length > 0) {
          invalidation = { cacheKey, failedHashes, totalBundles: httpBundles.length };
        }
      }

      if (!invalidation) {
        const rawFrontmatter = getOwnDataValue(meta, "frontmatter", "MDX bundle metadata");
        const rawGlobals = getOwnDataValue(meta, "globals", "MDX bundle metadata");
        const rawHeadings = getOwnDataValue(meta, "headings", "MDX bundle metadata");
        const rawNodeMapEntries = getOwnDataValue(
          meta,
          "nodeMapEntries",
          "MDX bundle metadata",
        );
        const rawHtml = getOwnDataValue(meta, "rawHtml", "MDX bundle metadata");
        const cachedFrontmatter = rawFrontmatter === undefined
          ? undefined
          : cloneCachedRecord(rawFrontmatter, "frontmatter", cloneState);
        const cachedGlobals = rawGlobals === undefined
          ? undefined
          : cloneCachedRecord(rawGlobals, "globals", cloneState);
        const headings = cloneHeadings(rawHeadings, cloneState);
        const nodeMapEntries = cloneNodeMapEntries(rawNodeMapEntries, cloneState);
        if (rawHtml !== undefined && typeof rawHtml !== "string") {
          throw new TypeError("Cached MDX rawHtml must be a string");
        }
        const clonedRawHtml = rawHtml === undefined ? undefined : cloneBoundedCachedString(
          rawHtml,
          cloneState,
          "rawHtml",
          MAX_CACHED_ARTIFACT_UTF8_BYTES,
        );

        cachedResult = {
          compiledCode,
          ...(cachedFrontmatter === undefined ? {} : {
            frontmatter: cachedFrontmatter as NonNullable<
              MDXCompilationResult["frontmatter"]
            >,
          }),
          ...(cachedGlobals === undefined ? {} : { globals: cachedGlobals }),
          ...(headings === undefined ? {} : { headings }),
          ...(nodeMapEntries === undefined ? {} : { nodeMap: new Map(nodeMapEntries) }),
          ...(clonedRawHtml === undefined ? {} : { rawHtml: clonedRawHtml }),
        };

        logger.debug("Cache hit for MDX compilation", {
          filePath,
          codeHash,
          size: metadataSize,
        });
      }
    } catch (error) {
      logger.warn("Failed to retrieve cached bundle", { error, filePath });
      return undefined;
    }

    if (invalidation) {
      logger.warn("HTTP bundle deps missing, invalidating cached MDX", {
        filePath,
        cacheKey: invalidation.cacheKey,
        failedHashes: invalidation.failedHashes,
        totalBundles: invalidation.totalBundles,
        hint: "Will recompile MDX with fresh HTTP bundles",
      });

      // This is a destructive operation, so failure must be observable rather
      // than converted into a successful cache miss.
      await this.manifestStore.deleteBundle(invalidation.cacheKey);
      return undefined;
    }

    return cachedResult === undefined ? undefined : cloneMDXCompilationResult(cachedResult);
  }

  async setCachedBundle(
    content: string,
    bundle: MDXCompilationResult,
    filePath?: string,
    frontmatter?: Record<string, unknown>,
    studioEmbed = false,
  ): Promise<void> {
    if (!this.enabled || !isPlainRecord(bundle)) {
      logger.debug("No compiled code to cache", { filePath });
      return;
    }
    const rawCompiledCode = getOwnDataValue(bundle, "compiledCode", "MDX compilation result");
    if (typeof rawCompiledCode !== "string" || rawCompiledCode.length === 0) {
      logger.debug("No compiled code to cache", { filePath });
      return;
    }

    try {
      const { cacheKey, contentHash, processorCacheIdentity } = await this
        .getCompilationIdentityParts(
          content,
          frontmatter,
          filePath,
          studioEmbed,
        );

      const cloneState = createCacheCloneState();
      const compiledCode = cloneBoundedCachedString(
        rawCompiledCode,
        cloneState,
        "compiled code",
        MAX_CACHED_ARTIFACT_UTF8_BYTES,
      );
      const bundleCode: BundleCode = { code: compiledCode };
      const codeHash = await computeCodeHash(bundleCode);
      const size = utf8Encoder.encode(compiledCode).length;
      const rawFrontmatter = getOwnDataValue(bundle, "frontmatter", "MDX compilation result");
      const rawGlobals = getOwnDataValue(bundle, "globals", "MDX compilation result");
      const rawHeadings = getOwnDataValue(bundle, "headings", "MDX compilation result");
      const rawNodeMap = getOwnDataValue(bundle, "nodeMap", "MDX compilation result");
      const rawHtml = getOwnDataValue(bundle, "rawHtml", "MDX compilation result");
      const frontmatterSnapshot = rawFrontmatter === undefined
        ? undefined
        : cloneCachedRecord(rawFrontmatter, "frontmatter", cloneState);
      const globalsSnapshot = rawGlobals === undefined
        ? undefined
        : cloneCachedRecord(rawGlobals, "globals", cloneState);
      const headingsSnapshot = cloneHeadings(rawHeadings, cloneState);
      const nodeMapEntries = snapshotNodeMap(
        rawNodeMap as Map<number, unknown> | undefined,
        cloneState,
      );
      if (rawHtml !== undefined && typeof rawHtml !== "string") {
        throw new TypeError("MDX rawHtml must be a string");
      }
      const rawHtmlSnapshot = rawHtml === undefined ? undefined : cloneBoundedCachedString(
        rawHtml,
        cloneState,
        "rawHtml",
        MAX_CACHED_ARTIFACT_UTF8_BYTES,
      );

      const metadata: BundleMetadata = {
        hash: contentHash,
        codeHash,
        size,
        compiledAt: Date.now(),
        source: filePath ?? "unknown",
        ...(this.scope === undefined ? {} : { scope: this.scope }),
        mode: this.mode,
        meta: {
          type: "mdx",
          reactVersion: this.reactVersion,
          compilerIdentity: this.compilerIdentity,
          processorCacheIdentity,
          ...(frontmatterSnapshot === undefined ? {} : { frontmatter: frontmatterSnapshot }),
          ...(globalsSnapshot === undefined ? {} : { globals: globalsSnapshot }),
          ...(headingsSnapshot === undefined ? {} : { headings: headingsSnapshot }),
          ...(nodeMapEntries === undefined ? {} : { nodeMapEntries }),
          ...(rawHtmlSnapshot === undefined ? {} : { rawHtml: rawHtmlSnapshot }),
        },
      };

      const ttl = this.getTTL();

      await this.manifestStore.setBundleCode(codeHash, bundleCode, ttl);
      await this.manifestStore.setBundleMetadata(cacheKey, metadata, ttl);

      logger.debug("Cached compiled MDX", {
        filePath,
        cacheKey,
        codeHash,
        size,
        ttl,
      });
    } catch (error) {
      logger.warn("Failed to cache bundle", { error, filePath });
    }
  }

  async invalidateBundle(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
    studioEmbed = false,
  ): Promise<void> {
    if (!this.enabled) return;

    const cacheKey = await this.computeCompilationIdentity(
      content,
      frontmatter,
      filePath,
      studioEmbed,
    );
    await this.manifestStore.deleteBundle(cacheKey);
    logger.debug("Invalidated cached bundle", { cacheKey });
  }

  async invalidateSource(source: string): Promise<number> {
    if (!this.enabled) return 0;

    const store = this.manifestStore;
    if (this.scope !== undefined && store.capabilities?.scopedSourceInvalidation !== true) {
      throw new UnsupportedScopedBundleManifestOperationError(
        "scoped source invalidation",
      );
    }
    const count = await store.invalidateSource(source, this.scope);
    logger.debug("Invalidated bundles for source", { source, count });
    return count;
  }

  async clearAll(): Promise<void> {
    if (!this.enabled) return;

    const store = this.manifestStore;
    if (this.scope !== undefined) {
      if (store.capabilities?.prefixInvalidation !== true || !store.invalidatePrefix) {
        throw new UnsupportedScopedBundleManifestOperationError(
          "scoped prefix invalidation",
        );
      }
      await store.invalidatePrefix(this.getCachePrefix());
    } else {
      await store.clear();
    }
    logger.debug("Cleared all cached bundles");
  }

  async getStats(): Promise<{
    totalBundles: number;
    totalSize: number;
    oldestBundle?: number;
    newestBundle?: number;
  }> {
    if (!this.enabled) return { totalBundles: 0, totalSize: 0 };

    try {
      const store = this.manifestStore;
      if (this.scope !== undefined && store.capabilities?.prefixStats !== true) {
        throw new UnsupportedScopedBundleManifestOperationError("scoped statistics");
      }
      return await store.getStats(
        this.scope === undefined ? undefined : this.getCachePrefix(),
      );
    } catch (error) {
      if (error instanceof UnsupportedScopedBundleManifestOperationError) throw error;
      logger.debug("Failed to get stats", { error });
      return { totalBundles: 0, totalSize: 0 };
    }
  }
}
