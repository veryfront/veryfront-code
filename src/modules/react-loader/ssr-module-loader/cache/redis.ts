/** Redis caching for cross-pod SSR module sharing */

import { rendererLogger } from "#veryfront/utils";
import { getSSRModuleRedisTTL } from "../constants.ts";
import { CacheBackends, createDistributedCodeCacheAccessor } from "#veryfront/cache/backend.ts";

const logger = rendererLogger.component("ssr-module-loader");

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
  return (await getDistributedCodeCache()) !== null;
}

/** Check if distributed caching is enabled for SSR modules */
export function isSSRDistributedCacheEnabled(): boolean {
  return true;
}

/**
 * Get code from distributed cache with automatic detokenization.
 * The TokenizingCacheGateway handles replacing __VF_CACHE_DIR__ tokens with local paths.
 */
export async function getFromRedis(cacheKey: string): Promise<string | null> {
  const gateway = await getDistributedCodeCache();
  if (!gateway) return null;

  try {
    // Use getCode() for automatic detokenization
    return await gateway.getCode(cacheKey);
  } catch (error) {
    logger.debug("Distributed cache get failed", { key: cacheKey, error });
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
  const gateway = await getDistributedCodeCache();
  if (!gateway) return;

  const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);

  try {
    // Use setCode() for automatic tokenization
    await gateway.setCode(cacheKey, code, ttl);
  } catch (error) {
    logger.debug("Distributed cache set failed", { key: cacheKey, error });
  }
}
