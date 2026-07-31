/** Distributed caching for cross-process SSR module sharing. */

import { rendererLogger } from "#veryfront/utils";
import { getSSRModuleDistributedTTL } from "../constants.ts";
import { CacheBackends, createDistributedCodeCacheAccessor } from "#veryfront/cache/backend.ts";
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

/** Resolve the configured cache once and expose its availability to the sync stats API. */
export async function initializeSSRDistributedCache(): Promise<boolean> {
  distributedCacheEnabled = (await getDistributedCodeCache()) !== null;
  return distributedCacheEnabled;
}

/** Return whether initialization selected a distributed backend. */
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
export async function getFromDistributedCache(cacheKey: string): Promise<string | null> {
  const gateway = await getDistributedCodeCache();
  if (!gateway) return null;

  try {
    return await gateway.getCode(await getDistributedCacheKey(cacheKey));
  } catch (error) {
    // A shared-cache read is an optimization. Recomputing is safe because the
    // source graph remains the authority and the failure is made observable.
    logger.warn("Distributed cache read failed; recomputing the module", {
      keyLength: cacheKey.length,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

/**
 * Store transformed code in distributed cache with automatic tokenization.
 * The TokenizingCacheGateway handles replacing absolute file:// paths with __VF_CACHE_DIR__ tokens.
 */
export async function setInDistributedCache(
  cacheKey: string,
  code: string,
  options?: { isProduction?: boolean; ttlSeconds?: number },
): Promise<void> {
  const gateway = await getDistributedCodeCache();
  if (!gateway) return;

  const ttl = options?.ttlSeconds ?? getSSRModuleDistributedTTL(options?.isProduction ?? true);

  await gateway.setCode(await getDistributedCacheKey(cacheKey), code, ttl);
}
