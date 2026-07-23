/** Redis caching for cross-pod SSR module sharing */

import { rendererLogger } from "#veryfront/utils";
import { getSSRModuleRedisTTL } from "../constants.ts";
import { CacheBackends, createDistributedCodeCacheAccessor } from "#veryfront/cache/backend.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = rendererLogger.component("ssr-module-loader");
const MAX_DISTRIBUTED_CACHE_KEY_LENGTH = 16_384;
const MAX_DISTRIBUTED_MODULE_BYTES = 10 * 1024 * 1024;
let distributedCacheEnabled = false;

/**
 * Lazy-loaded distributed cache gateway for cross-pod sharing.
 * Uses TokenizingCacheGateway to automatically handle tokenization/detokenization.
 */
const getDistributedCodeCache = createDistributedCodeCacheAccessor(
  () => CacheBackends.ssrModule(),
  "SSR-MODULE-LOADER",
);

/** Initialize distributed caching for SSR modules */
export async function initializeSSRDistributedCache(): Promise<boolean> {
  try {
    distributedCacheEnabled = (await getDistributedCodeCache()) !== null;
  } catch {
    distributedCacheEnabled = false;
  }
  return distributedCacheEnabled;
}

/** Check if distributed caching is enabled for SSR modules */
export function isSSRDistributedCacheEnabled(): boolean {
  return distributedCacheEnabled;
}

/**
 * Get code from distributed cache with automatic detokenization.
 * The TokenizingCacheGateway handles replacing __VF_CACHE_DIR__ tokens with local paths.
 */
export async function getFromRedis(cacheKey: string): Promise<string | null> {
  if (
    cacheKey.length === 0 || cacheKey.length > MAX_DISTRIBUTED_CACHE_KEY_LENGTH ||
    hasUnsafeControlCharacters(cacheKey)
  ) {
    return null;
  }
  const gateway = await getDistributedCodeCache();
  if (!gateway) return null;

  try {
    // Use getCode() for automatic detokenization
    const code = await gateway.getCode(cacheKey);
    if (code && new TextEncoder().encode(code).byteLength > MAX_DISTRIBUTED_MODULE_BYTES) {
      logger.warn("Distributed module cache entry exceeds size limit");
      return null;
    }
    return code;
  } catch (error) {
    logger.debug("Distributed cache get failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

/**
 * Store transformed code in distributed cache with automatic tokenization.
 * The TokenizingCacheGateway handles replacing absolute file:// paths with __VF_CACHE_DIR__ tokens.
 */
export async function setInRedis(
  cacheKey: string,
  code: string,
  options?: { isProduction?: boolean; ttlSeconds?: number },
): Promise<void> {
  if (
    cacheKey.length === 0 || cacheKey.length > MAX_DISTRIBUTED_CACHE_KEY_LENGTH ||
    hasUnsafeControlCharacters(cacheKey) ||
    new TextEncoder().encode(code).byteLength > MAX_DISTRIBUTED_MODULE_BYTES
  ) {
    logger.warn("Distributed module cache write rejected by limits");
    return;
  }
  const gateway = await getDistributedCodeCache();
  if (!gateway) return;

  const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);

  try {
    // Use setCode() for automatic tokenization
    await gateway.setCode(cacheKey, code, ttl);
  } catch (error) {
    logger.debug("Distributed cache set failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
