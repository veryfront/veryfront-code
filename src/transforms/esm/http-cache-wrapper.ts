/**
 * HttpBundleCache wrapper for type-safe distributed cache operations.
 *
 * This wrapper enforces the transformation gateway pattern:
 * - All code stored in Redis is tokenized (PortableModuleCode)
 * - All code retrieved from Redis is detokenized (LocalModuleCode)
 *
 * By centralizing cache operations here, we eliminate the class of bugs
 * where code paths forget to tokenize/detokenize.
 *
 * @module transforms/esm/http-cache-wrapper
 */

import { gunzipSync } from "node:zlib";
import { rendererLogger } from "#veryfront/utils";
import { VERSION } from "#veryfront/utils/version.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import type {
  BundleHash,
  DecodeResult,
  LocalModuleCode,
  NormalizedUrl,
  PortableModuleCode,
} from "./http-cache-types.ts";
import {
  asBundleHash,
  assertLocal,
  assertPortable,
  CACHE_DIR_TOKEN,
  VeryfrontError,
} from "./http-cache-invariants.ts";
import { looksLikeHtmlContent as looksLikeHtml } from "./html-content.ts";

const logger = rendererLogger.component("http-cache-wrapper");

/** Maximum number of keys per batch request to distributed cache API */
const BATCH_FETCH_CHUNK_SIZE = 100;

/** Lazy-loaded distributed cache backend for cross-pod sharing */
const getDistributedCache = createDistributedCacheAccessor(
  () => CacheBackends.httpModule(),
  "HTTP-CACHE-WRAPPER",
);

/**
 * Generate versioned cache key for HTTP bundles.
 * Format: {VERSION}:{prefix}:{hash}
 */
function distributedKey(prefix: string, hash: string | BundleHash): string {
  const hashStr = typeof hash === "string" ? hash : (hash as unknown as string);
  return `${VERSION}:${prefix}:${hashStr}`;
}

/**
 * Tokenize local code paths to portable format.
 * Replaces absolute cache directory paths with __VF_CACHE_DIR__ tokens.
 *
 * Uses aggressive tokenization to handle paths from ANY environment,
 * not just the current machine. This is critical for cross-pod cache sharing.
 */
function tokenize(code: LocalModuleCode): PortableModuleCode {
  const cacheDir = getCacheBaseDir();
  const normalized = cacheDir.endsWith("/") ? cacheDir.slice(0, -1) : cacheDir;
  let codeStr = code as unknown as string;

  // First, tokenize current environment's paths (fast path)
  codeStr = codeStr.replaceAll(`file://${normalized}`, `file://${CACHE_DIR_TOKEN}`);

  // Then, aggressively tokenize ANY veryfront cache paths from other environments
  // This handles code that may contain paths from different machines (e.g., build server)
  codeStr = codeStr.replace(
    /file:\/\/([^"'\s]*?)\/veryfront-http-bundle\//g,
    `file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/`,
  );
  codeStr = codeStr.replace(
    /file:\/\/([^"'\s]*?)\/veryfront-mdx-esm\//g,
    `file://${CACHE_DIR_TOKEN}/veryfront-mdx-esm/`,
  );

  return codeStr as unknown as PortableModuleCode;
}

/**
 * Detokenize portable code to local format.
 * Replaces __VF_CACHE_DIR__ tokens with actual cache directory paths.
 */
function detokenize(code: PortableModuleCode | string): LocalModuleCode {
  const cacheDir = getCacheBaseDir();
  const normalized = cacheDir.endsWith("/") ? cacheDir.slice(0, -1) : cacheDir;
  const codeStr = typeof code === "string" ? code : (code as unknown as string);
  const result = codeStr.replaceAll(`file://${CACHE_DIR_TOKEN}`, `file://${normalized}`);
  return result as unknown as LocalModuleCode;
}

/**
 * Decode potentially gzip-compressed cache content.
 */
function decodeGzip(content: string): DecodeResult {
  const base64Data = content.startsWith("gz:")
    ? content.slice(3)
    : content.startsWith("gzip:")
    ? content.slice(5)
    : null;

  if (!base64Data) {
    return { code: content, wasGzipped: false, decodeFailed: false };
  }

  try {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const decompressed = gunzipSync(bytes);
    return {
      code: new TextDecoder().decode(decompressed),
      wasGzipped: true,
      decodeFailed: false,
    };
  } catch (error) {
    logger.debug("Failed to decode gzip content", { error });
    return { code: content, wasGzipped: false, decodeFailed: true };
  }
}

/**
 * Result of getting code from distributed cache.
 */
export interface GetCodeResult {
  /** The local module code (detokenized), or null if not found/invalid */
  code: LocalModuleCode | null;
  /** Whether the content was gzip-compressed in cache */
  wasGzipped: boolean;
  /** Reason for null result, if applicable */
  failReason?: "not_found" | "gzip_decode_failed" | "html_content" | "error";
}

/**
 * HttpBundleCache provides type-safe access to the distributed cache.
 *
 * All methods enforce the transformation gateway:
 * - get*() methods ALWAYS detokenize before returning
 * - set*() methods ALWAYS tokenize before storing
 *
 * This class is the ONLY authorized way to interact with distributed cache
 * for HTTP bundle code.
 */
export class HttpBundleCache {
  /**
   * Get module code from distributed cache by hash.
   * ALWAYS returns LocalModuleCode (detokenized) or null.
   *
   * @param hash - Bundle hash to look up
   * @returns Result containing local code or failure reason
   */
  async getCodeByHash(hash: BundleHash | string): Promise<GetCodeResult> {
    const distributed = await getDistributedCache();
    if (!distributed) {
      return { code: null, wasGzipped: false, failReason: "not_found" };
    }

    const hashStr = typeof hash === "string" ? hash : (hash as unknown as string);

    try {
      const rawCode = await distributed.get(distributedKey("code", hashStr));
      if (!rawCode) {
        return { code: null, wasGzipped: false, failReason: "not_found" };
      }

      const decoded = decodeGzip(rawCode);
      if (decoded.decodeFailed) {
        logger.warn("Gzip decode failed", { hash: hashStr });
        return { code: null, wasGzipped: false, failReason: "gzip_decode_failed" };
      }

      if (looksLikeHtml(decoded.code)) {
        logger.warn("Cache contains HTML not JS", { hash: hashStr });
        return { code: null, wasGzipped: decoded.wasGzipped, failReason: "html_content" };
      }

      // CRITICAL: Always detokenize before returning
      const localCode = detokenize(decoded.code);

      // Validate invariant in development (can be disabled in production for performance)
      try {
        assertLocal(localCode);
      } catch (e) {
        logger.error("Detokenization incomplete", {
          hash: hashStr,
          error: e,
        });
        throw e;
      }

      return { code: localCode, wasGzipped: decoded.wasGzipped };
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
        throw error;
      }
      logger.debug("Get code failed", { hash: hashStr, error });
      return { code: null, wasGzipped: false, failReason: "error" };
    }
  }

  /**
   * Get module code from distributed cache by URL key.
   * ALWAYS returns LocalModuleCode (detokenized) or null.
   *
   * @param hash - Bundle hash (used with "url" prefix)
   * @returns Result containing local code or failure reason
   */
  async getCodeByUrl(hash: BundleHash | string): Promise<GetCodeResult> {
    const distributed = await getDistributedCache();
    if (!distributed) {
      return { code: null, wasGzipped: false, failReason: "not_found" };
    }

    const hashStr = typeof hash === "string" ? hash : (hash as unknown as string);

    try {
      const rawCode = await distributed.get(distributedKey("url", hashStr));
      if (!rawCode) {
        return { code: null, wasGzipped: false, failReason: "not_found" };
      }

      const decoded = decodeGzip(rawCode);
      if (decoded.decodeFailed) {
        return { code: null, wasGzipped: false, failReason: "gzip_decode_failed" };
      }

      if (looksLikeHtml(decoded.code)) {
        return { code: null, wasGzipped: decoded.wasGzipped, failReason: "html_content" };
      }

      // CRITICAL: Always detokenize before returning
      const localCode = detokenize(decoded.code);
      assertLocal(localCode);

      return { code: localCode, wasGzipped: decoded.wasGzipped };
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
        throw error;
      }
      logger.debug("Get code by URL failed", { hash: hashStr, error });
      return { code: null, wasGzipped: false, failReason: "error" };
    }
  }

  /**
   * Store module code in distributed cache.
   * ALWAYS tokenizes LocalModuleCode before storing.
   *
   * @param hash - Bundle hash
   * @param code - Local module code to store
   * @param url - Original URL for reverse lookup
   * @param ttl - TTL in seconds (defaults to HTTP_MODULE_DISTRIBUTED_TTL_SEC)
   */
  async setCode(
    hash: BundleHash | string,
    code: LocalModuleCode,
    url: NormalizedUrl | string,
    ttl: number = HTTP_MODULE_DISTRIBUTED_TTL_SEC,
  ): Promise<void> {
    const distributed = await getDistributedCache();
    if (!distributed) return;

    const hashStr = typeof hash === "string" ? hash : (hash as unknown as string);
    const urlStr = typeof url === "string" ? url : (url as unknown as string);

    try {
      // CRITICAL: Always tokenize before storing
      const portableCode = tokenize(code);

      // Validate invariant
      assertPortable(portableCode);

      const portableStr = portableCode as unknown as string;

      await Promise.all([
        distributed.set(distributedKey("url", hashStr), portableStr, ttl),
        distributed.set(distributedKey("code", hashStr), portableStr, ttl),
        distributed.set(distributedKey("hash", hashStr), urlStr, ttl),
      ]);

      logger.debug("Stored code in distributed cache", { hash: hashStr });
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
        throw error;
      }
      logger.debug("Set code failed", { hash: hashStr, error });
    }
  }

  /**
   * Batch get multiple bundle codes from distributed cache.
   * ALWAYS returns LocalModuleCode (detokenized) for each successful fetch.
   *
   * @param hashes - Array of bundle hashes to fetch
   * @returns Map of hash -> local code (missing/failed hashes not included)
   */
  async getBatchCodes(
    hashes: Array<BundleHash | string>,
  ): Promise<Map<string, LocalModuleCode>> {
    const distributed = await getDistributedCache();
    if (!distributed) return new Map();

    const results = new Map<string, LocalModuleCode>();
    const hashStrs = hashes.map((h) => (typeof h === "string" ? h : (h as unknown as string)));

    const codeKeys = hashStrs.map((h) => distributedKey("code", h));
    const keyToHash = new Map(hashStrs.map((h, i) => [codeKeys[i], h]));

    try {
      for (let i = 0; i < codeKeys.length; i += BATCH_FETCH_CHUNK_SIZE) {
        const chunk = codeKeys.slice(i, i + BATCH_FETCH_CHUNK_SIZE);

        const chunkResults = distributed.getBatch ? await distributed.getBatch(chunk) : new Map(
          await Promise.all(chunk.map(async (key) => [key, await distributed.get(key)] as const)),
        );

        for (const [key, rawCode] of chunkResults) {
          if (!rawCode) continue;

          const hash = keyToHash.get(key);
          if (!hash) continue;

          const decoded = decodeGzip(rawCode);
          if (decoded.decodeFailed || looksLikeHtml(decoded.code)) continue;

          // CRITICAL: Always detokenize before returning
          const localCode = detokenize(decoded.code);

          try {
            assertLocal(localCode);
            results.set(hash, localCode);
          } catch {
            logger.warn("Batch item failed assertion", { hash });
          }
        }
      }
    } catch (error) {
      logger.debug("Batch get failed", { error });
    }

    return results;
  }

  /**
   * Get the original URL for a bundle hash.
   *
   * @param hash - Bundle hash
   * @returns Original URL or null
   */
  async getOriginalUrl(hash: BundleHash | string): Promise<string | null> {
    const distributed = await getDistributedCache();
    if (!distributed) return null;

    const hashStr = typeof hash === "string" ? hash : (hash as unknown as string);

    try {
      return await distributed.get(distributedKey("hash", hashStr));
    } catch {
      return null;
    }
  }

  /**
   * Delete a bundle from distributed cache.
   * Removes all keys associated with the hash (code, url, hash mapping).
   *
   * @param hash - Bundle hash to delete
   * @returns true if deletion was attempted, false if cache unavailable
   */
  async deleteCode(hash: BundleHash | string): Promise<boolean> {
    const distributed = await getDistributedCache();
    if (!distributed) return false;

    const hashStr = typeof hash === "string" ? hash : (hash as unknown as string);

    try {
      // Delete all keys associated with this hash
      await Promise.all([
        distributed.del(distributedKey("url", hashStr)),
        distributed.del(distributedKey("code", hashStr)),
        distributed.del(distributedKey("hash", hashStr)),
      ]);

      logger.info("Deleted bundle from distributed cache", { hash: hashStr });
      return true;
    } catch (error) {
      logger.debug("Delete code failed", { hash: hashStr, error });
      return false;
    }
  }

  /**
   * Check if distributed cache is available.
   */
  async isAvailable(): Promise<boolean> {
    const distributed = await getDistributedCache();
    return distributed !== null;
  }
}

/**
 * Singleton instance of HttpBundleCache.
 * Use this for all distributed cache operations.
 */
export const httpBundleCache = new HttpBundleCache();

/**
 * Re-export transformation functions for use in migration.
 * These should eventually be removed once all code uses the wrapper.
 */
export { asBundleHash, detokenize, tokenize };
