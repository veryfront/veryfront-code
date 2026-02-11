/**
 * Concurrent fetch deduplication and distributed cache refresh management.
 *
 * Manages in-flight HTTP module fetches to prevent thundering herd,
 * and handles periodic distributed cache TTL refreshes.
 *
 * @module transforms/esm/in-flight-manager
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger } from "#veryfront/utils";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { asLocalModuleCode } from "./http-cache-invariants.ts";
import type { BundleEntry } from "./bundle-manifest.ts";
import { getManifestIdForHash, refreshManifestTTL } from "./bundle-manifest.ts";
import type { HttpCacheLike } from "./http-cache-helpers.ts";

const logger = rendererLogger.component("http-cache");

export const DISTRIBUTED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Per-request accumulator for bundle metadata during cacheHttpImportsToLocal. */
export const bundleAccumulatorStorage = new AsyncLocalStorage<BundleEntry[]>();
/** Per-request stack used to detect circular HTTP module dependencies. */
export const processingStackStorage = new AsyncLocalStorage<Set<string>>();
/** Deduplicate concurrent HTTP module fetches to avoid races. */
export const inFlightHttpFetches = new Map<string, Promise<string | null>>();

/** Maximum time to wait for an in-flight fetch from another request before retrying */
export const IN_FLIGHT_WAIT_TIMEOUT_MS = 30_000;

/**
 * Clear all in-flight HTTP fetches.
 * Used for testing to ensure clean state between tests.
 */
export function __clearInFlightHttpFetches(): void {
  inFlightHttpFetches.clear();
}

/** Jitter to spread out timeout retries and prevent thundering herd (0-5s) */
export const IN_FLIGHT_JITTER_MS = 5_000;

/**
 * Wait for an in-flight fetch with timeout + jitter.
 * Returns undefined on timeout so caller can retry.
 */
export async function waitForInFlightFetch(
  promise: Promise<string | null>,
  cacheKey: string,
): Promise<string | null | undefined> {
  const jitter = Math.floor(Math.random() * IN_FLIGHT_JITTER_MS);
  const timeoutMs = IN_FLIGHT_WAIT_TIMEOUT_MS + jitter;

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn("In-flight fetch wait timed out, will retry", {
        cacheKey,
        timeoutMs,
      });
      resolve(undefined);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Asynchronously refresh the distributed cache entry for a local bundle.
 * This is fire-and-forget to avoid blocking the hot path.
 */
export function refreshDistributedCacheAsync(
  hash: number,
  code: string,
  _cacheDir: string,
  normalizedUrl: string,
  getLastDistributedRefresh: () => HttpCacheLike<string, number>,
): void {
  (async () => {
    const hashStr = String(hash);
    const now = Date.now();
    const lastRefresh = getLastDistributedRefresh().get(hashStr);
    const needsRefresh = !lastRefresh || now - lastRefresh > DISTRIBUTED_REFRESH_INTERVAL_MS;

    if (needsRefresh) {
      try {
        await httpBundleCache.setCode(
          hashStr,
          asLocalModuleCode(code),
          normalizedUrl,
          HTTP_MODULE_DISTRIBUTED_TTL_SEC,
        );
        getLastDistributedRefresh().set(hashStr, now);
        logger.debug("Refreshed distributed cache TTL", { hash });

        const manifestId = getManifestIdForHash(hashStr);
        if (manifestId) {
          refreshManifestTTL(manifestId).catch((err) => {
            logger.debug("Manifest TTL refresh failed", {
              manifestId: manifestId.slice(0, 12),
              err,
            });
          });
        }
      } catch (error) {
        logger.debug("Distributed cache refresh failed", { hash, error });
      }
    }
  })().catch((err) => {
    logger.debug("Distributed cache async refresh error", { err });
  });
}

/**
 * Track bundle for manifest accumulation if in accumulation context.
 */
export function trackBundleAccumulator(
  hash: number,
  normalizedUrl: string,
  cachePath: string,
): void {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (accumulator) {
    createFileSystem().stat(cachePath).then((stat) => {
      accumulator.push({
        hash: String(hash),
        url: normalizedUrl,
        sizeBytes: stat?.size ?? 0,
      });
    }).catch(() => {
      // Ignore stat errors
    });
  }
}
