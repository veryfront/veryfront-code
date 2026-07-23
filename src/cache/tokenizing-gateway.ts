/**
 * TokenizingCacheGateway - Single gateway for all code stored in distributed cache.
 *
 * This wrapper enforces tokenization/detokenization for ANY distributed cache
 * storing code, eliminating the "forgot to tokenize" bug class.
 *
 * All code stored in distributed cache (Redis/API) must go through this gateway.
 * The gateway automatically:
 * - Tokenizes code on write (replaces absolute paths with __VF_CACHE_DIR__)
 * - Detokenizes code on read (replaces tokens with local paths)
 * - Validates portable code before storage
 *
 * @module cache/tokenizing-gateway
 */

import { logger } from "#veryfront/utils";
import type { CacheBackend } from "./types.ts";
import { buildBatchResults } from "./batch-results.ts";
import { assertPortableCode, detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "./paths.ts";

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
   * Check if the underlying backend is distributed (Redis/API) vs memory.
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

  constructor(
    private backend: CacheBackend,
    name: string,
  ) {
    this.type = backend.type;
    this.name = name;
  }

  /**
   * Check if the underlying backend is distributed (Redis/API) vs memory.
   */
  isDistributed(): boolean {
    return this.type === "redis" || this.type === "api";
  }

  /**
   * Get code from cache with automatic detokenization.
   * For memory backend, no detokenization is needed.
   */
  async getCode(key: string): Promise<string | null> {
    const raw = await this.backend.get(key);
    if (raw === null) return null;

    // Only detokenize for distributed backends
    if (!this.isDistributed()) return raw;

    const detokenized = detokenizeAllCachePaths(raw);
    logger.debug(`[${this.name}] Detokenized code from cache`, { keyLength: key.length });
    return detokenized;
  }

  /**
   * Get multiple codes from cache with automatic detokenization.
   */
  async getCodeBatch(keys: string[]): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map<string, string | null>();

    if (!this.backend.getBatch) {
      const values = new Map<string, string | null>();
      await Promise.all(
        keys.map(async (key) => values.set(key, await this.getCode(key))),
      );
      return buildBatchResults(keys, (key) => values.get(key) ?? null);
    }

    const rawResults = await this.backend.getBatch(keys);
    return buildBatchResults(keys, (key) => {
      const raw = rawResults.get(key) ?? null;
      if (raw === null) {
        return null;
      }

      // Only detokenize for distributed backends
      if (!this.isDistributed()) {
        return raw;
      }

      return detokenizeAllCachePaths(raw);
    });
  }

  /**
   * Store code in cache with automatic tokenization.
   * Validates that code is portable before storage.
   * @throws VeryfrontError (cache-invariant-violation) if code contains paths that can't be properly tokenized
   */
  async setCode(key: string, code: string, ttlSeconds?: number): Promise<void> {
    // For memory backend, no tokenization needed
    if (!this.isDistributed()) {
      await this.backend.set(key, code, ttlSeconds);
      return;
    }

    // Tokenize the code
    const portable = tokenizeAllVeryFrontPaths(code);

    // Validate the tokenized code is actually portable
    try {
      assertPortableCode(portable);
    } catch (error) {
      logger.error(`[${this.name}] Failed to create portable code`, {
        keyLength: key.length,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }

    await this.backend.set(key, portable, ttlSeconds);
    logger.debug(`[${this.name}] Stored tokenized code in cache`, { keyLength: key.length });
  }

  /**
   * Store multiple codes in cache with automatic tokenization.
   */
  async setCodeBatch(entries: Array<{ key: string; code: string; ttl?: number }>): Promise<void> {
    if (entries.length === 0) return;

    if (!this.backend.setBatch) {
      // Fallback to individual sets
      for (const { key, code, ttl } of entries) {
        await this.setCode(key, code, ttl);
      }
      return;
    }

    // For memory backend, no tokenization needed
    if (!this.isDistributed()) {
      await this.backend.setBatch(
        entries.map(({ key, code, ttl }) => ({ key, value: code, ttl })),
      );
      return;
    }

    // Tokenize all entries
    const tokenizedEntries = entries.map(({ key, code, ttl }) => {
      const portable = tokenizeAllVeryFrontPaths(code);
      assertPortableCode(portable);
      return { key, value: portable, ttl };
    });

    await this.backend.setBatch(tokenizedEntries);
  }

  /**
   * Delete code from cache.
   */
  async delCode(key: string): Promise<void> {
    await this.backend.del(key);
  }

  /**
   * Delete codes matching pattern from cache.
   */
  async delCodeByPattern(pattern: string): Promise<number> {
    if (!this.backend.delByPattern) {
      throw new TypeError("Code cache backend does not support pattern invalidation");
    }
    return this.backend.delByPattern(pattern);
  }

  // Pass-through methods for non-code data (metadata, manifests, etc.)

  /**
   * Get raw data from cache (no tokenization).
   */
  async get(key: string): Promise<string | null> {
    return this.backend.get(key);
  }

  /**
   * Store raw data in cache (no tokenization).
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.backend.set(key, value, ttlSeconds);
  }

  /**
   * Delete raw data from cache.
   */
  async del(key: string): Promise<void> {
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
