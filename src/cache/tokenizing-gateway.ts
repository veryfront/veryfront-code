/**
 * TokenizingCacheGateway - Single gateway for all code stored in distributed cache.
 *
 * This wrapper enforces tokenization/detokenization for ANY distributed cache
 * storing code, eliminating the "forgot to tokenize" bug class.
 *
 * All code stored in a non-memory cache must go through this gateway.
 * The gateway automatically:
 * - Tokenizes code on write (replaces absolute paths with __VF_CACHE_DIR__)
 * - Detokenizes code on read (replaces tokens with local paths)
 * - Validates portable code before storage
 *
 * @module cache/tokenizing-gateway
 */

import { CACHE_ERROR, CACHE_INVARIANT_VIOLATION, INVALID_ARGUMENT } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import type { CacheBackend } from "./types.ts";
import { buildBatchResults } from "./batch-results.ts";
import {
  assertPortableCode,
  CACHE_DIR_TOKEN,
  detokenizeAllCachePaths,
  tokenizeAllVeryFrontPaths,
} from "./paths.ts";
import { containsUnsafeCacheStringCharacter } from "./validation.ts";

type GatewayBackend =
  & Pick<CacheBackend, "type" | "get" | "set" | "del">
  & Partial<Pick<CacheBackend, "getBatch" | "setBatch" | "delByPattern">>;

const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BATCH_ENTRIES = 100;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const valueEncoder = new TextEncoder();

type CodeCacheEntry = { key: string; code: string; ttl?: number };

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function cacheResponseFailure(detail: string): never {
  throw CACHE_ERROR.create({ detail });
}

function assertCacheKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" || key.length === 0 || key.length > MAX_CACHE_KEY_LENGTH ||
    containsUnsafeCacheStringCharacter(key)
  ) {
    invalidArgument(
      "Cache key must be a bounded string without control characters or unpaired UTF-16 surrogates",
    );
  }
}

function assertCacheValue(value: unknown, label = "Cache value"): asserts value is string {
  if (
    typeof value !== "string" || value.length > MAX_CACHE_VALUE_BYTES ||
    valueEncoder.encode(value).byteLength > MAX_CACHE_VALUE_BYTES
  ) {
    invalidArgument(`${label} must be a string within the supported byte size`);
  }
}

function assertUnambiguousPortableInput(code: string): void {
  if (code.includes(`file://${CACHE_DIR_TOKEN}`)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Code already contains the reserved cache-directory token",
    });
  }
}

function normalizeTtl(ttl: unknown): number | undefined {
  if (ttl === undefined) return undefined;
  if (
    typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 ||
    ttl > MAX_CACHE_TTL_SECONDS
  ) {
    invalidArgument("Cache TTL must be a positive finite number within the supported range");
  }
  return ttl;
}

function readProperty(value: object, key: string, label: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    invalidArgument(`${label} must be readable`);
  }
}

function normalizeKeys(keys: unknown): string[] {
  let isArray: boolean;
  let length: unknown;
  try {
    isArray = Array.isArray(keys);
    length = isArray ? Reflect.get(keys as object, "length") : undefined;
  } catch {
    invalidArgument("Cache keys must be a readable array");
  }
  if (!isArray || typeof length !== "number" || !Number.isSafeInteger(length)) {
    invalidArgument("Cache keys must be an array");
  }
  if (length > MAX_CACHE_BATCH_ENTRIES) {
    invalidArgument(`Cache batches cannot exceed ${MAX_CACHE_BATCH_ENTRIES} entries`);
  }

  const normalized: string[] = [];
  for (let index = 0; index < length; index++) {
    const key = readProperty(keys as object, String(index), "Cache keys");
    assertCacheKey(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeCodeEntries(entries: unknown): CodeCacheEntry[] {
  let isArray: boolean;
  let length: unknown;
  try {
    isArray = Array.isArray(entries);
    length = isArray ? Reflect.get(entries as object, "length") : undefined;
  } catch {
    invalidArgument("Cache entries must be a readable array");
  }
  if (!isArray || typeof length !== "number" || !Number.isSafeInteger(length)) {
    invalidArgument("Cache entries must be an array");
  }
  if (length > MAX_CACHE_BATCH_ENTRIES) {
    invalidArgument(`Cache batches cannot exceed ${MAX_CACHE_BATCH_ENTRIES} entries`);
  }

  const normalized: CodeCacheEntry[] = [];
  let totalValueBytes = 0;
  for (let index = 0; index < length; index++) {
    const entry = readProperty(entries as object, String(index), "Cache entries");
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      invalidArgument("Each code cache entry must be an object");
    }
    const key = readProperty(entry, "key", "Code cache entry");
    const code = readProperty(entry, "code", "Code cache entry");
    const ttl = readProperty(entry, "ttl", "Code cache entry");
    assertCacheKey(key);
    assertCacheValue(code, "Cached code");
    const codeBytes = valueEncoder.encode(code).byteLength;
    totalValueBytes += codeBytes;
    if (!Number.isSafeInteger(totalValueBytes) || totalValueBytes > MAX_CACHE_VALUE_BYTES) {
      invalidArgument("Code cache batch exceeds the supported byte size");
    }
    normalized.push(Object.freeze({ key, code, ttl: normalizeTtl(ttl) }));
  }
  return normalized;
}

function normalizeReadValue(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" || value.length > MAX_CACHE_VALUE_BYTES ||
    valueEncoder.encode(value).byteLength > MAX_CACHE_VALUE_BYTES
  ) {
    cacheResponseFailure("Cache backend returned an invalid value");
  }
  return value;
}

function accountBatchReadValue(
  value: string | null,
  budget: { bytes: number },
): string | null {
  if (value === null) return null;
  budget.bytes += valueEncoder.encode(value).byteLength;
  if (budget.bytes > MAX_CACHE_VALUE_BYTES) {
    cacheResponseFailure("Cache backend returned an oversized batch response");
  }
  return value;
}

function invalidGatewayConfiguration(): never {
  throw INVALID_ARGUMENT.create({ message: "Cache gateway backend is invalid or unreadable" });
}

function snapshotBackend(backend: CacheBackend): GatewayBackend {
  if (typeof backend !== "object" || backend === null) invalidGatewayConfiguration();

  let type: unknown;
  const methods = new Map<string, unknown>();
  try {
    type = Reflect.get(backend, "type");
    for (const name of ["get", "set", "del", "getBatch", "setBatch", "delByPattern"]) {
      methods.set(name, Reflect.get(backend, name));
    }
  } catch {
    invalidGatewayConfiguration();
  }

  if (!(["memory", "redis", "api", "disk"] as unknown[]).includes(type)) {
    invalidGatewayConfiguration();
  }
  for (const name of ["get", "set", "del"]) {
    if (typeof methods.get(name) !== "function") invalidGatewayConfiguration();
  }
  for (const name of ["getBatch", "setBatch", "delByPattern"]) {
    const method = methods.get(name);
    if (method !== undefined && typeof method !== "function") invalidGatewayConfiguration();
  }

  const bind = <T extends (...args: never[]) => unknown>(name: string): T | undefined => {
    const method = methods.get(name);
    return typeof method === "function" ? method.bind(backend) as T : undefined;
  };
  return Object.freeze({
    type: type as CacheBackend["type"],
    get: bind<CacheBackend["get"]>("get")!,
    set: bind<CacheBackend["set"]>("set")!,
    del: bind<CacheBackend["del"]>("del")!,
    getBatch: bind<NonNullable<CacheBackend["getBatch"]>>("getBatch"),
    setBatch: bind<NonNullable<CacheBackend["setBatch"]>>("setBatch"),
    delByPattern: bind<NonNullable<CacheBackend["delByPattern"]>>("delByPattern"),
  });
}

/**
 * Gateway interface for code storage in distributed cache.
 * Extends CacheBackend with code-specific methods that enforce tokenization.
 */
export interface CodeCacheGateway {
  /** Backend type identifier */
  readonly type: CacheBackend["type"];

  /** Gateway name for logging */
  readonly name: string;

  /**
   * Get code from cache with automatic detokenization.
   * ALWAYS returns local paths (detokenized).
   */
  getCode(key: string): Promise<string | null>;

  /**
   * Get multiple codes from cache with automatic detokenization.
   * ALWAYS returns local paths (detokenized).
   */
  getCodeBatch?(keys: string[]): Promise<Map<string, string | null>>;

  /**
   * Store code in cache with automatic tokenization.
   * ALWAYS tokenizes before storage.
   * @throws VeryfrontError (cache-invariant-violation) if code contains paths that can't be tokenized
   */
  setCode(key: string, code: string, ttlSeconds?: number): Promise<void>;

  /**
   * Store multiple codes in cache with automatic tokenization.
   * ALWAYS tokenizes before storage.
   */
  setCodeBatch?(entries: Array<{ key: string; code: string; ttl?: number }>): Promise<void>;

  /**
   * Delete code from cache.
   */
  delCode(key: string): Promise<void>;

  /**
   * Delete codes matching pattern from cache.
   */
  delCodeByPattern?(pattern: string): Promise<number>;

  /**
   * Get raw data from cache (no tokenization).
   * Use for metadata, manifests, etc.
   */
  get(key: string): Promise<string | null>;

  /**
   * Store raw data in cache (no tokenization).
   * Use for metadata, manifests, etc.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Delete raw data from cache.
   */
  del(key: string): Promise<void>;

  /**
   * Check if the underlying backend is non-memory (Redis, API, or disk).
   */
  isDistributed(): boolean;
}

/**
 * TokenizingCacheGateway wraps a CacheBackend and enforces tokenization
 * for all code storage operations.
 *
 * This is the ONLY authorized way to store transformed code in distributed cache.
 */
export class TokenizingCacheGateway implements CodeCacheGateway {
  readonly type: CacheBackend["type"];
  readonly name: string;
  private readonly backend: GatewayBackend;

  constructor(
    backend: CacheBackend,
    name: string,
  ) {
    if (
      typeof name !== "string" || name.length === 0 || name.length > 128 ||
      containsUnsafeCacheStringCharacter(name)
    ) {
      throw INVALID_ARGUMENT.create({
        message:
          "Cache gateway name must be a bounded string without control characters or unpaired UTF-16 surrogates",
      });
    }
    this.backend = snapshotBackend(backend);
    this.type = this.backend.type;
    this.name = name;
  }

  /**
   * Check if the underlying backend is non-memory (Redis, API, or disk).
   */
  isDistributed(): boolean {
    return this.type !== "memory";
  }

  /**
   * Get code from cache with automatic detokenization.
   * For memory backend, no detokenization is needed.
   */
  async getCode(key: string): Promise<string | null> {
    assertCacheKey(key);
    const raw = normalizeReadValue(await this.backend.get(key));
    if (raw === null) return null;

    // Only detokenize for distributed backends
    if (!this.isDistributed()) return raw;

    const detokenized = detokenizeAllCachePaths(raw);
    logger.debug("Detokenized code from cache");
    return normalizeReadValue(detokenized);
  }

  /**
   * Get multiple codes from cache with automatic detokenization.
   */
  async getCodeBatch(keys: string[]): Promise<Map<string, string | null>> {
    const normalizedKeys = normalizeKeys(keys);
    if (normalizedKeys.length === 0) return new Map<string, string | null>();

    if (!this.backend.getBatch) {
      const values = new Map<string, string | null>();
      const budget = { bytes: 0 };
      for (const key of normalizedKeys) {
        values.set(key, accountBatchReadValue(await this.getCode(key), budget));
      }
      return buildBatchResults(normalizedKeys, (key) => values.get(key) ?? null);
    }

    const rawResults: unknown = await this.backend.getBatch(normalizedKeys);
    if (!(rawResults instanceof Map)) {
      cacheResponseFailure("Cache backend returned an invalid batch response");
    }
    const budget = { bytes: 0 };
    return buildBatchResults(normalizedKeys, (key) => {
      let rawValue: unknown;
      try {
        const hasValue = Map.prototype.has.call(rawResults, key);
        rawValue = hasValue ? Map.prototype.get.call(rawResults, key) : null;
      } catch {
        cacheResponseFailure("Cache backend returned an unreadable batch response");
      }
      const raw = normalizeReadValue(rawValue);
      if (raw === null) {
        return null;
      }

      // Only detokenize for distributed backends
      if (!this.isDistributed()) {
        return accountBatchReadValue(raw, budget);
      }

      const detokenized = normalizeReadValue(detokenizeAllCachePaths(raw));
      return accountBatchReadValue(detokenized, budget);
    });
  }

  /**
   * Store code in cache with automatic tokenization.
   * Validates that code is portable before storage.
   * @throws VeryfrontError (cache-invariant-violation) if code contains paths that can't be properly tokenized
   */
  async setCode(key: string, code: string, ttlSeconds?: number): Promise<void> {
    assertCacheKey(key);
    assertCacheValue(code, "Cached code");
    const ttl = normalizeTtl(ttlSeconds);

    // For memory backend, no tokenization needed
    if (!this.isDistributed()) {
      await this.backend.set(key, code, ttl);
      return;
    }

    assertUnambiguousPortableInput(code);
    // Tokenize the code
    const portable = tokenizeAllVeryFrontPaths(code);

    // Validate the tokenized code is actually portable
    try {
      assertPortableCode(portable);
    } catch (error) {
      logger.error("Portable code validation failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }

    await this.backend.set(key, portable, ttl);
    logger.debug("Stored tokenized code in cache");
  }

  /**
   * Store multiple codes in cache with automatic tokenization.
   */
  async setCodeBatch(entries: Array<{ key: string; code: string; ttl?: number }>): Promise<void> {
    const normalizedEntries = normalizeCodeEntries(entries);
    if (normalizedEntries.length === 0) return;

    const preparedEntries = this.isDistributed()
      ? normalizedEntries.map(({ key, code, ttl }) => {
        assertUnambiguousPortableInput(code);
        const portable = tokenizeAllVeryFrontPaths(code);
        assertPortableCode(portable);
        return Object.freeze({ key, code: portable, ttl });
      })
      : normalizedEntries;

    if (!this.backend.setBatch) {
      // Fallback to individual sets
      for (const { key, code, ttl } of preparedEntries) {
        await this.backend.set(key, code, ttl);
      }
      return;
    }

    await this.backend.setBatch(
      preparedEntries.map(({ key, code, ttl }) => ({ key, value: code, ttl })),
    );
  }

  /**
   * Delete code from cache.
   */
  async delCode(key: string): Promise<void> {
    assertCacheKey(key);
    await this.backend.del(key);
  }

  /**
   * Delete codes matching pattern from cache.
   */
  async delCodeByPattern(pattern: string): Promise<number> {
    assertCacheKey(pattern);
    if (!this.backend.delByPattern) {
      throw CACHE_ERROR.create({
        detail: "The cache backend does not support pattern deletion",
      });
    }
    const deleted: unknown = await this.backend.delByPattern(pattern);
    if (typeof deleted !== "number" || !Number.isSafeInteger(deleted) || deleted < 0) {
      cacheResponseFailure("Cache backend returned an invalid deletion count");
    }
    return deleted;
  }

  // Pass-through methods for non-code data (metadata, manifests, etc.)

  /**
   * Get raw data from cache (no tokenization).
   */
  async get(key: string): Promise<string | null> {
    assertCacheKey(key);
    return normalizeReadValue(await this.backend.get(key));
  }

  /**
   * Store raw data in cache (no tokenization).
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    assertCacheKey(key);
    assertCacheValue(value);
    await this.backend.set(key, value, normalizeTtl(ttlSeconds));
  }

  /**
   * Delete raw data from cache.
   */
  async del(key: string): Promise<void> {
    assertCacheKey(key);
    await this.backend.del(key);
  }
}

/**
 * Create a TokenizingCacheGateway wrapping a CacheBackend.
 *
 * @param backend - The underlying cache backend
 * @param name - Name for logging (e.g., "TRANSFORM-CACHE", "SSR-MODULE")
 * @returns A gateway that enforces tokenization for code storage
 */
export function createTokenizingGateway(
  backend: CacheBackend,
  name: string,
): TokenizingCacheGateway {
  return new TokenizingCacheGateway(backend, name);
}
