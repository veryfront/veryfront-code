/** Redis caching for cross-pod SSR module sharing */

import { rendererLogger } from "#veryfront/utils";
import { getSSRModuleRedisTTL } from "../constants.ts";
import {
  CacheBackends,
  createDistributedCodeCacheAccessor,
  isLocalDevDiskCacheEnabled,
} from "#veryfront/cache/backend.ts";
import { LOCAL_DEV_SSR_MODULE_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const logger = rendererLogger.component("ssr-module-loader");
const SSR_MODULE_CACHE_PREFIX = "ssr-module";
// Mirrors the maximum key length accepted by veryfront-api.
const API_CACHE_KEY_MAX_LENGTH = 512;
const API_CACHE_KEY_PATTERN = /^[a-zA-Z0-9_:.\-/]+$/;
const SHA256_KEY_PREFIX = "sha256:";

/**
 * Lazy-loaded distributed cache gateway for cross-pod sharing.
 * Uses TokenizingCacheGateway to automatically handle tokenization/detokenization.
 */
const getDistributedCodeCache = createDistributedCodeCacheAccessor(
  () => CacheBackends.ssrModule(),
  "SSR-MODULE-LOADER",
);

let distributedCacheEnabled = false;

/** Initialize distributed caching for SSR modules */
export async function initializeSSRDistributedCache(): Promise<boolean> {
  distributedCacheEnabled = (await getDistributedCodeCache()) !== null;
  return distributedCacheEnabled;
}

/**
 * Report whether initialization actually resolved a distributed backend.
 * Stays false when the process runs on the in-memory backend, where
 * `initializeSSRDistributedCache` is never called.
 */
export function isSSRDistributedCacheEnabled(): boolean {
  return distributedCacheEnabled;
}

async function getDistributedCacheKey(cacheKey: string): Promise<string> {
  const fullyPrefixedKey = `${SSR_MODULE_CACHE_PREFIX}:${cacheKey}`;
  if (
    fullyPrefixedKey.length <= API_CACHE_KEY_MAX_LENGTH &&
    API_CACHE_KEY_PATTERN.test(fullyPrefixedKey)
  ) {
    return cacheKey;
  }

  return `${SHA256_KEY_PREFIX}${await computeHash(fullyPrefixedKey)}`;
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
    return await gateway.getCode(await getDistributedCacheKey(cacheKey));
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

  // The preview TTL is tuned for a shared branch cache and expires long before
  // a developer returns to the project, so an on-disk local dev cache would go
  // cold anyway. Keep those entries for a working day instead.
  const ttl = options?.ttlSeconds ??
    (isLocalDevDiskCacheEnabled()
      ? LOCAL_DEV_SSR_MODULE_TTL_SEC
      : getSSRModuleRedisTTL(options?.isProduction ?? true));

  try {
    // Use setCode() for automatic tokenization
    await gateway.setCode(await getDistributedCacheKey(cacheKey), code, ttl);
  } catch (error) {
    logger.debug("Distributed cache set failed", { key: cacheKey, error });
  }
}
