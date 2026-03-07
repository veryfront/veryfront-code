/**
 * Runtime invariants for HTTP bundle cache.
 *
 * These assertions fail fast when cache path handling is incorrect,
 * preventing bugs from propagating to module import time.
 *
 * @module transforms/esm/http-cache-invariants
 */

import { rendererLogger } from "#veryfront/utils";
import type { BundleHash, LocalModuleCode, PortableModuleCode } from "./http-cache-types.ts";
import {
  CACHE_DIR_TOKEN,
  CACHE_INVARIANT_VIOLATION,
  hasHardcodedCachePaths as baseHasHardcodedCachePaths,
} from "#veryfront/cache/paths.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

const logger = rendererLogger.component("http-cache");

/**
 * Portable cache directory token for cross-environment compatibility.
 * Absolute file:// paths are replaced with this token before storing in Redis.
 */
export { CACHE_DIR_TOKEN };

export { CACHE_INVARIANT_VIOLATION, VeryfrontError };

/**
 * Check if code contains hardcoded cache paths that should be tokenized.
 * Used to detect code that hasn't been properly tokenized before storage.
 *
 * @param code - The code string to check
 * @returns true if code contains paths that should have been tokenized
 */
export const hasHardcodedCachePaths = baseHasHardcodedCachePaths;

/**
 * Check if code contains the portable cache directory token.
 *
 * @param code - The code string to check
 * @returns true if code contains __VF_CACHE_DIR__ tokens
 */
function hasPortableTokens(code: string): boolean {
  return code.includes(CACHE_DIR_TOKEN);
}

/**
 * Assert that code is safe to store in distributed cache (portable).
 * Fails fast if code contains hardcoded paths that should have been tokenized.
 *
 * @param code - The code to validate
 * @throws VeryfrontError (cache-invariant-violation) if code contains hardcoded paths
 */
export function assertPortable(code: PortableModuleCode): void {
  const codeStr = code as unknown as string;

  if (hasHardcodedCachePaths(codeStr)) {
    logger.error("Invariant violation: hardcoded paths in portable code", {
      preview: codeStr.substring(0, 200),
    });

    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        "[CACHE INVARIANT VIOLATION] Code contains hardcoded cache paths that should be tokenized.\nThis indicates tokenization was not applied correctly.",
    });
  }
}

/**
 * Assert that code is safe to execute locally (no tokens).
 * Fails fast if code contains __VF_CACHE_DIR__ tokens that weren't detokenized.
 *
 * @param code - The code to validate
 * @throws VeryfrontError (cache-invariant-violation) if code contains portable tokens
 */
export function assertLocal(code: LocalModuleCode): void {
  const codeStr = code as unknown as string;

  if (hasPortableTokens(codeStr)) {
    logger.error("Invariant violation: portable tokens in local code", {
      tokenCount: (codeStr.match(new RegExp(CACHE_DIR_TOKEN, "g")) || []).length,
      preview: codeStr.substring(0, 200),
    });

    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        `[CACHE INVARIANT VIOLATION] Code contains ${CACHE_DIR_TOKEN} tokens that should be detokenized.\nThis indicates detokenization was not applied correctly.`,
    });
  }
}

/**
 * Create a BundleHash from a string.
 * Validates that the hash matches expected format.
 *
 * @param hash - The hash string
 * @returns Branded BundleHash
 * @throws VeryfrontError (cache-invariant-violation) if hash format is invalid
 */
export function asBundleHash(hash: string): BundleHash {
  // Bundle hashes should be numeric (from simpleHash)
  if (!/^\d+$/.test(hash)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        `[CACHE INVARIANT VIOLATION] Invalid bundle hash format: "${hash}" (expected numeric)`,
    });
  }
  return hash as unknown as BundleHash;
}

/**
 * Safely cast string to LocalModuleCode after validation.
 * Use this when you've verified the code has local paths.
 *
 * @param code - The code string
 * @returns Branded LocalModuleCode
 * @throws VeryfrontError (cache-invariant-violation) if code contains portable tokens
 */
export function asLocalModuleCode(code: string): LocalModuleCode {
  if (hasPortableTokens(code)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        `[CACHE INVARIANT VIOLATION] Cannot treat code as LocalModuleCode: contains ${CACHE_DIR_TOKEN} tokens`,
    });
  }
  return code as unknown as LocalModuleCode;
}

/**
 * Safely cast string to PortableModuleCode after validation.
 * Use this when you've verified the code is tokenized.
 *
 * @param code - The code string
 * @returns Branded PortableModuleCode
 * @throws VeryfrontError (cache-invariant-violation) if code contains hardcoded paths
 */
function asPortableModuleCode(code: string): PortableModuleCode {
  if (hasHardcodedCachePaths(code)) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        "[CACHE INVARIANT VIOLATION] Cannot treat code as PortableModuleCode: contains hardcoded cache paths",
    });
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
function unwrapCode(code: LocalModuleCode | PortableModuleCode): string {
  return code as unknown as string;
}
