/**
 * HttpBundleCache wrapper - Local-only mode.
 *
 * With JIT bundling and local-only caching, distributed cache is no longer used.
 * This wrapper provides a compatible interface that returns null for all operations,
 * effectively disabling distributed cache recovery while keeping the HTTP caching
 * functionality (fetch from network, cache to disk) working.
 *
 * @module transforms/esm/http-cache-wrapper
 */

import type { BundleHash, LocalModuleCode, NormalizedUrl } from "./http-cache-types.ts";

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
 * HttpBundleCache - Local-only mode stub.
 *
 * All methods return null/empty results since distributed cache is disabled.
 * HTTP modules are cached locally to disk without cross-pod sharing.
 */
export class HttpBundleCache {
  /**
   * Get module code from distributed cache by hash.
   * Always returns null in local-only mode.
   */
  async getCodeByHash(_hash: BundleHash | string): Promise<GetCodeResult> {
    return { code: null, wasGzipped: false, failReason: "not_found" };
  }

  /**
   * Get module code from distributed cache by URL key.
   * Always returns null in local-only mode.
   */
  async getCodeByUrl(_hash: BundleHash | string): Promise<GetCodeResult> {
    return { code: null, wasGzipped: false, failReason: "not_found" };
  }

  /**
   * Store module code in distributed cache.
   * No-op in local-only mode.
   */
  async setCode(
    _hash: BundleHash | string,
    _code: LocalModuleCode,
    _url: NormalizedUrl | string,
    _ttl?: number,
  ): Promise<void> {
    // No-op in local-only mode
  }

  /**
   * Batch get multiple bundle codes from distributed cache.
   * Always returns empty map in local-only mode.
   */
  async getBatchCodes(
    _hashes: Array<BundleHash | string>,
  ): Promise<Map<string, LocalModuleCode>> {
    return new Map();
  }

  /**
   * Get the original URL for a bundle hash.
   * Always returns null in local-only mode.
   */
  async getOriginalUrl(_hash: BundleHash | string): Promise<string | null> {
    return null;
  }

  /**
   * Check if distributed cache is available.
   * Always returns false in local-only mode.
   */
  async isAvailable(): Promise<boolean> {
    return false;
  }
}

/**
 * Singleton instance of HttpBundleCache.
 */
export const httpBundleCache = new HttpBundleCache();

/**
 * Stub transformation functions for compatibility.
 * No-ops since distributed cache is disabled.
 */
export function tokenize(code: LocalModuleCode): unknown {
  return code;
}

export function detokenize(code: unknown): LocalModuleCode {
  return code as LocalModuleCode;
}

export function asBundleHash(hash: string): BundleHash {
  return hash as unknown as BundleHash;
}
