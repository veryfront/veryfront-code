/**
 * Runtime invariants for HTTP bundle cache.
 *
 * These assertions fail fast when cache path handling is incorrect,
 * preventing bugs from propagating to module import time.
 *
 * @module transforms/esm/http-cache-invariants
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { BundleHash, LocalModuleCode, PortableModuleCode } from "./http-cache-types.ts";

/**
 * Portable cache directory token for cross-environment compatibility.
 * Absolute file:// paths are replaced with this token before storing in Redis.
 */
export const CACHE_DIR_TOKEN = "__VF_CACHE_DIR__";

/**
 * Error thrown when a cache invariant is violated.
 * These errors indicate programming bugs, not user errors.
 */
export class CacheInvariantError extends Error {
  constructor(message: string) {
    super(`[HTTP-CACHE INVARIANT VIOLATION] ${message}`);
    this.name = "CacheInvariantError";
  }
}

/**
 * Common patterns for hardcoded cache paths that should be tokenized.
 * These patterns match absolute paths from various environments.
 */
const HARDCODED_PATH_PATTERNS = [
  // Production container paths
  /file:\/\/\/app\/.cache\//,
  /file:\/\/\/app\/\.cache\//,
  // macOS local development
  /file:\/\/\/Users\/[^/]+\/\.cache\//,
  /file:\/\/\/Users\/[^/]+\/.cache\//,
  // Linux local development
  /file:\/\/\/home\/[^/]+\/\.cache\//,
  /file:\/\/\/home\/[^/]+\/.cache\//,
  // Temp directories (various patterns)
  /file:\/\/\/tmp\/[^/]*\.cache\//,
  /file:\/\/\/var\/tmp\/[^/]*\.cache\//,
  // Windows paths (WSL or native)
  /file:\/\/\/[A-Za-z]:\/.*\.cache\//,
];

/**
 * Check if code contains hardcoded cache paths that should be tokenized.
 * Used to detect code that hasn't been properly tokenized before storage.
 *
 * @param code - The code string to check
 * @returns true if code contains paths that should have been tokenized
 */
export function hasHardcodedCachePaths(code: string): boolean {
  return HARDCODED_PATH_PATTERNS.some((pattern) => pattern.test(code));
}

/**
 * Check if code contains the portable cache directory token.
 *
 * @param code - The code string to check
 * @returns true if code contains __VF_CACHE_DIR__ tokens
 */
export function hasPortableTokens(code: string): boolean {
  return code.includes(CACHE_DIR_TOKEN);
}

/**
 * Assert that code is safe to store in distributed cache (portable).
 * Fails fast if code contains hardcoded paths that should have been tokenized.
 *
 * @param code - The code to validate
 * @throws CacheInvariantError if code contains hardcoded paths
 */
export function assertPortable(code: PortableModuleCode): void {
  const codeStr = code as unknown as string;

  if (hasHardcodedCachePaths(codeStr)) {
    const matchedPatterns = HARDCODED_PATH_PATTERNS.filter((p) => p.test(codeStr)).map((p) =>
      p.source
    );

    logger.error("[HTTP-CACHE] Invariant violation: hardcoded paths in portable code", {
      patterns: matchedPatterns,
      preview: codeStr.substring(0, 200),
    });

    throw new CacheInvariantError(
      `Code contains hardcoded cache paths that should be tokenized.\n` +
        `Matched patterns: ${matchedPatterns.join(", ")}\n` +
        `This indicates tokenization was not applied correctly.`,
    );
  }
}

/**
 * Assert that code is safe to execute locally (no tokens).
 * Fails fast if code contains __VF_CACHE_DIR__ tokens that weren't detokenized.
 *
 * @param code - The code to validate
 * @throws CacheInvariantError if code contains portable tokens
 */
export function assertLocal(code: LocalModuleCode): void {
  const codeStr = code as unknown as string;

  if (hasPortableTokens(codeStr)) {
    logger.error("[HTTP-CACHE] Invariant violation: portable tokens in local code", {
      tokenCount: (codeStr.match(new RegExp(CACHE_DIR_TOKEN, "g")) || []).length,
      preview: codeStr.substring(0, 200),
    });

    throw new CacheInvariantError(
      `Code contains ${CACHE_DIR_TOKEN} tokens that should be detokenized.\n` +
        `This indicates detokenization was not applied correctly.`,
    );
  }
}

/**
 * Create a BundleHash from a string.
 * Validates that the hash matches expected format.
 *
 * @param hash - The hash string
 * @returns Branded BundleHash
 * @throws CacheInvariantError if hash format is invalid
 */
export function asBundleHash(hash: string): BundleHash {
  // Bundle hashes should be numeric (from simpleHash)
  if (!/^\d+$/.test(hash)) {
    throw new CacheInvariantError(`Invalid bundle hash format: "${hash}" (expected numeric)`);
  }
  return hash as unknown as BundleHash;
}

/**
 * Safely cast string to LocalModuleCode after validation.
 * Use this when you've verified the code has local paths.
 *
 * @param code - The code string
 * @returns Branded LocalModuleCode
 * @throws CacheInvariantError if code contains portable tokens
 */
export function asLocalModuleCode(code: string): LocalModuleCode {
  if (hasPortableTokens(code)) {
    throw new CacheInvariantError(
      `Cannot treat code as LocalModuleCode: contains ${CACHE_DIR_TOKEN} tokens`,
    );
  }
  return code as unknown as LocalModuleCode;
}

/**
 * Safely cast string to PortableModuleCode after validation.
 * Use this when you've verified the code is tokenized.
 *
 * @param code - The code string
 * @returns Branded PortableModuleCode
 * @throws CacheInvariantError if code contains hardcoded paths
 */
export function asPortableModuleCode(code: string): PortableModuleCode {
  if (hasHardcodedCachePaths(code)) {
    throw new CacheInvariantError(
      `Cannot treat code as PortableModuleCode: contains hardcoded cache paths`,
    );
  }
  return code as unknown as PortableModuleCode;
}

/**
 * Unwrap branded code type to plain string.
 * Use sparingly - prefer keeping code typed throughout the pipeline.
 *
 * @param code - The branded code
 * @returns Plain string
 */
export function unwrapCode(code: LocalModuleCode | PortableModuleCode): string {
  return code as unknown as string;
}
