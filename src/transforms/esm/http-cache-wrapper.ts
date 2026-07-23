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
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import {
  brand,
  type BundleHash,
  type DecodeResult,
  type LocalModuleCode,
  type NormalizedUrl,
  type PortableModuleCode,
  unbrand,
} from "./http-cache-types.ts";
import {
  asBundleHash,
  assertLocal,
  assertPortable,
  CACHE_DIR_TOKEN,
  VeryfrontError,
} from "./http-cache-invariants.ts";
import { looksLikeHtmlContent as looksLikeHtml } from "./html-content.ts";
import { fingerprintImportMap, type HttpCacheIdentityMetadata } from "./http-cache-helpers.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { MAX_HTTP_MODULE_RESPONSE_BYTES } from "#veryfront/transforms/shared/http-module-response.ts";
import { errorLogName } from "../shared/log-context.ts";

const logger = rendererLogger.component("http-cache-wrapper");

/** Maximum number of keys per batch request to distributed cache API */
const BATCH_FETCH_CHUNK_SIZE = 100;
const MAX_GZIP_COMPRESSED_BYTES = MAX_HTTP_MODULE_RESPONSE_BYTES + 64 * 1024;
const MAX_GZIP_BASE64_CHARACTERS = 4 * Math.ceil(MAX_GZIP_COMPRESSED_BYTES / 3);
const textEncoder = new TextEncoder();

/** Lazy-loaded distributed cache backend for cross-pod sharing */
const getDistributedCache = createDistributedCacheAccessor(
  () => CacheBackends.httpModule(),
  "HTTP-CACHE-WRAPPER",
);

let testDistributedCacheAccessor: (() => Promise<CacheBackend | null>) | null = null;

function resolveDistributedCache(): Promise<CacheBackend | null> {
  return testDistributedCacheAccessor ? testDistributedCacheAccessor() : getDistributedCache();
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseImportMap(value: unknown): ImportMapConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawImportMap = value as Record<string, unknown>;
  const imports = parseStringRecord(rawImportMap.imports);
  if (rawImportMap.imports !== undefined && imports === undefined) return null;

  let scopes: Record<string, Record<string, string>> | undefined;
  if (rawImportMap.scopes !== undefined) {
    if (
      !rawImportMap.scopes || typeof rawImportMap.scopes !== "object" ||
      Array.isArray(rawImportMap.scopes)
    ) return null;
    scopes = {};
    for (const [scope, rawScopedImports] of Object.entries(rawImportMap.scopes)) {
      const scopedImports = parseStringRecord(rawScopedImports);
      if (!scopedImports) return null;
      scopes[scope] = scopedImports;
    }
  }

  return { imports, scopes };
}

interface HttpCacheIdentityReference {
  url: string;
  reactVersion?: string;
  importMapFingerprint: string;
}

function parseIdentityMetadata(
  value: string,
): HttpCacheIdentityMetadata | HttpCacheIdentityReference | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.url !== "string") return null;
    if (parsed.reactVersion !== undefined && typeof parsed.reactVersion !== "string") return null;

    // Backward compatibility for v2 records written before import maps were shared.
    if (parsed.importMap !== undefined) {
      const importMap = parseImportMap(parsed.importMap);
      return importMap
        ? {
          url: parsed.url,
          reactVersion: parsed.reactVersion as string | undefined,
          importMap,
        }
        : null;
    }

    if (typeof parsed.importMapFingerprint !== "string") return null;
    return {
      url: parsed.url,
      reactVersion: parsed.reactVersion as string | undefined,
      importMapFingerprint: parsed.importMapFingerprint,
    };
  } catch {
    return null;
  }
}

export function __setDistributedCacheAccessorForTests(
  accessor: (() => Promise<CacheBackend | null>) | null,
): void {
  testDistributedCacheAccessor = accessor;
}

export async function initializeHttpModuleDistributedCache(): Promise<boolean> {
  const distributed = await resolveDistributedCache();
  if (!distributed) return false;

  logger.info("Initialized distributed cache backend", { backend: distributed.type });
  return true;
}

/**
 * Generate versioned cache key for HTTP bundles.
 * Format: {VERSION}:{prefix}:{hash}
 */
function distributedKey(prefix: string, hash: string | BundleHash): string {
  const hashStr = typeof hash === "string" ? hash : unbrand(hash);
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
  let codeStr: string = unbrand(code);

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

  return brand<PortableModuleCode>(codeStr);
}

/**
 * Detokenize portable code to local format.
 * Replaces __VF_CACHE_DIR__ tokens with actual cache directory paths.
 */
function detokenize(code: PortableModuleCode | string): LocalModuleCode {
  const cacheDir = getCacheBaseDir();
  const normalized = cacheDir.endsWith("/") ? cacheDir.slice(0, -1) : cacheDir;
  const codeStr = typeof code === "string" ? code : unbrand(code);
  const result = codeStr.replaceAll(`file://${CACHE_DIR_TOKEN}`, `file://${normalized}`);
  return brand<LocalModuleCode>(result);
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
    if (
      content.length > MAX_HTTP_MODULE_RESPONSE_BYTES ||
      textEncoder.encode(content).byteLength > MAX_HTTP_MODULE_RESPONSE_BYTES
    ) {
      return {
        code: "",
        wasGzipped: false,
        decodeFailed: true,
        failureReason: "content_too_large",
      };
    }
    return { code: content, wasGzipped: false, decodeFailed: false };
  }

  if (base64Data.length > MAX_GZIP_BASE64_CHARACTERS) {
    return {
      code: "",
      wasGzipped: false,
      decodeFailed: true,
      failureReason: "content_too_large",
    };
  }

  try {
    const binaryString = atob(base64Data);
    if (binaryString.length > MAX_GZIP_COMPRESSED_BYTES) {
      return {
        code: "",
        wasGzipped: false,
        decodeFailed: true,
        failureReason: "content_too_large",
      };
    }
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const decompressed = gunzipSync(bytes, {
      maxOutputLength: MAX_HTTP_MODULE_RESPONSE_BYTES + 1,
    });
    if (decompressed.byteLength > MAX_HTTP_MODULE_RESPONSE_BYTES) {
      return {
        code: "",
        wasGzipped: false,
        decodeFailed: true,
        failureReason: "content_too_large",
      };
    }
    return {
      code: new TextDecoder().decode(decompressed),
      wasGzipped: true,
      decodeFailed: false,
    };
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ERR_BUFFER_TOO_LARGE"
    ) {
      return {
        code: "",
        wasGzipped: false,
        decodeFailed: true,
        failureReason: "content_too_large",
      };
    }
    logger.debug("Failed to decode gzip content", { errorName: errorLogName(error) });
    return {
      code: "",
      wasGzipped: false,
      decodeFailed: true,
      failureReason: "gzip_decode_failed",
    };
  }
}

/**
 * Result of getting code from distributed cache.
 */
interface GetCodeResult {
  /** The local module code (detokenized), or null if not found/invalid */
  code: LocalModuleCode | null;
  /** Whether the content was gzip-compressed in cache */
  wasGzipped: boolean;
  /** Reason for null result, if applicable */
  failReason?:
    | "not_found"
    | "gzip_decode_failed"
    | "content_too_large"
    | "html_content"
    | "error";
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
class HttpBundleCache {
  /**
   * Get module code from distributed cache by hash.
   * ALWAYS returns LocalModuleCode (detokenized) or null.
   *
   * @param hash - Bundle hash to look up
   * @returns Result containing local code or failure reason
   */
  async getCodeByHash(hash: BundleHash | string): Promise<GetCodeResult> {
    const distributed = await resolveDistributedCache();
    if (!distributed) {
      return { code: null, wasGzipped: false, failReason: "not_found" };
    }

    const hashStr = typeof hash === "string" ? hash : unbrand(hash);

    try {
      const rawCode = await distributed.get(distributedKey("code", hashStr));
      if (!rawCode) {
        return { code: null, wasGzipped: false, failReason: "not_found" };
      }

      const decoded = decodeGzip(rawCode);
      if (decoded.decodeFailed) {
        logger.warn("Distributed cache code was rejected", {
          hash: hashStr,
          reason: decoded.failureReason,
        });
        return {
          code: null,
          wasGzipped: false,
          failReason: decoded.failureReason ?? "gzip_decode_failed",
        };
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
          errorName: errorLogName(e),
        });
        throw e;
      }

      return { code: localCode, wasGzipped: decoded.wasGzipped };
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
        throw error;
      }
      logger.debug("Get code failed", { hash: hashStr, errorName: errorLogName(error) });
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
    const distributed = await resolveDistributedCache();
    if (!distributed) {
      return { code: null, wasGzipped: false, failReason: "not_found" };
    }

    const hashStr = typeof hash === "string" ? hash : unbrand(hash);

    try {
      const rawCode = await distributed.get(distributedKey("url", hashStr));
      if (!rawCode) {
        return { code: null, wasGzipped: false, failReason: "not_found" };
      }

      const decoded = decodeGzip(rawCode);
      if (decoded.decodeFailed) {
        return {
          code: null,
          wasGzipped: false,
          failReason: decoded.failureReason ?? "gzip_decode_failed",
        };
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
      logger.debug("Get code by URL failed", {
        hash: hashStr,
        errorName: errorLogName(error),
      });
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
    identityMetadata?: HttpCacheIdentityMetadata,
  ): Promise<void> {
    const distributed = await resolveDistributedCache();
    if (!distributed) return;

    const hashStr = typeof hash === "string" ? hash : unbrand(hash);
    const urlStr = typeof url === "string" ? url : unbrand(url);

    try {
      // CRITICAL: Always tokenize before storing
      const portableCode = tokenize(code);

      // Validate invariant
      assertPortable(portableCode);

      const portableStr = unbrand(portableCode);

      const writes = [
        distributed.set(distributedKey("url", hashStr), portableStr, ttl),
        distributed.set(distributedKey("code", hashStr), portableStr, ttl),
        distributed.set(distributedKey("hash", hashStr), urlStr, ttl),
      ];
      if (identityMetadata) {
        const importMapFingerprint = identityMetadata.importMapFingerprint ??
          await fingerprintImportMap(identityMetadata.importMap);
        writes.push(
          distributed.set(
            distributedKey("import-map", importMapFingerprint),
            JSON.stringify(identityMetadata.importMap),
            ttl,
          ),
          distributed.set(
            distributedKey("identity", hashStr),
            JSON.stringify({
              url: identityMetadata.url,
              reactVersion: identityMetadata.reactVersion,
              importMapFingerprint,
            }),
            ttl,
          ),
        );
      }
      await Promise.all(writes);

      logger.debug("Stored code in distributed cache", { hash: hashStr });
    } catch (error) {
      if (error instanceof VeryfrontError && error.slug === "cache-invariant-violation") {
        throw error;
      }
      logger.debug("Set code failed", { hash: hashStr, errorName: errorLogName(error) });
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
    const distributed = await resolveDistributedCache();
    if (!distributed) return new Map();

    const results = new Map<string, LocalModuleCode>();
    const hashStrs = hashes.map((h) => (typeof h === "string" ? h : unbrand(h)));

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
          } catch (_) {
            /* expected: detokenization may be incomplete for some items */
            logger.warn("Batch item failed assertion", { hash });
          }
        }
      }
    } catch (error) {
      logger.debug("Batch get failed", { errorName: errorLogName(error) });
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
    const distributed = await resolveDistributedCache();
    if (!distributed) return null;

    const hashStr = typeof hash === "string" ? hash : unbrand(hash);

    try {
      return await distributed.get(distributedKey("hash", hashStr));
    } catch (_) {
      /* expected: distributed cache may be unavailable */
      return null;
    }
  }

  /** Return the full rewrite identity needed to reproduce a bundle by URL. */
  async getIdentityMetadata(
    hash: BundleHash | string,
  ): Promise<HttpCacheIdentityMetadata | null> {
    const distributed = await resolveDistributedCache();
    if (!distributed) return null;

    const hashStr = typeof hash === "string" ? hash : unbrand(hash);
    try {
      const raw = await distributed.get(distributedKey("identity", hashStr));
      if (!raw) return null;
      const parsed = parseIdentityMetadata(raw);
      if (!parsed || "importMap" in parsed) return parsed;

      const rawImportMap = await distributed.get(
        distributedKey("import-map", parsed.importMapFingerprint),
      );
      if (!rawImportMap) return null;
      let importMapValue: unknown;
      try {
        importMapValue = JSON.parse(rawImportMap);
      } catch {
        return null;
      }
      const importMap = parseImportMap(importMapValue);
      if (!importMap) return null;
      if (await fingerprintImportMap(importMap) !== parsed.importMapFingerprint) return null;

      return { ...parsed, importMap };
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
    const distributed = await resolveDistributedCache();
    if (!distributed) return false;

    const hashStr = typeof hash === "string" ? hash : unbrand(hash);

    try {
      // Delete all keys associated with this hash
      await Promise.all([
        distributed.del(distributedKey("url", hashStr)),
        distributed.del(distributedKey("code", hashStr)),
        distributed.del(distributedKey("hash", hashStr)),
        distributed.del(distributedKey("identity", hashStr)),
      ]);

      logger.info("Deleted bundle from distributed cache", { hash: hashStr });
      return true;
    } catch (error) {
      logger.debug("Delete code failed", { hash: hashStr, errorName: errorLogName(error) });
      return false;
    }
  }

  /**
   * Check if distributed cache is available.
   */
  async isAvailable(): Promise<boolean> {
    const distributed = await resolveDistributedCache();
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
