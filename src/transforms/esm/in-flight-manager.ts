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
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import { rendererLogger } from "#veryfront/utils";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { asLocalModuleCode } from "./http-cache-invariants.ts";
import { getManifestIdForHash, refreshManifestTTL } from "./bundle-manifest-ttl.ts";
import type { BundleEntry } from "./bundle-manifest-types.ts";
import type { HttpCacheIdentityMetadata, HttpCacheLike } from "./http-cache-helpers.ts";
import { errorLogName } from "../shared/log-context.ts";

const logger = rendererLogger.component("http-cache");

const DISTRIBUTED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Per-request accumulator for bundle metadata during cacheHttpImportsToLocal. */
export const bundleAccumulatorStorage = new AsyncLocalStorage<BundleEntry[]>();
/** Per-request stack used to detect circular HTTP module dependencies. */
export const processingStackStorage = new AsyncLocalStorage<Set<string>>();
/** Deduplicate concurrent HTTP module fetches to avoid races. */
export const inFlightHttpFetches = new Map<string, Promise<string | null>>();

/** Maximum time to wait for an in-flight fetch from another request before retrying */
const IN_FLIGHT_WAIT_TIMEOUT_MS = 30_000;

/**
 * Clear all in-flight HTTP fetches.
 * Used for testing to ensure clean state between tests.
 */
export function __clearInFlightHttpFetches(): void {
  inFlightHttpFetches.clear();
}

/** Remove an in-flight fetch only when the caller still owns the map entry. */
export function clearInFlightHttpFetchIfOwned(
  cacheKey: string,
  fetchPromise: Promise<string | null>,
): void {
  if (inFlightHttpFetches.get(cacheKey) === fetchPromise) {
    inFlightHttpFetches.delete(cacheKey);
  }
}

registerProcessStateReset("HTTP module in-flight fetches", __clearInFlightHttpFetches);

/** Jitter to spread out timeout retries and prevent thundering herd (0-5s) */
const IN_FLIGHT_JITTER_MS = 5_000;

/**
 * Wait for an in-flight fetch with timeout + jitter.
 * Returns undefined on timeout so caller can retry.
 */
export async function waitForInFlightFetch(
  promise: Promise<string | null>,
  _cacheKey: string,
): Promise<string | null | undefined> {
  const jitter = Math.floor(Math.random() * IN_FLIGHT_JITTER_MS);
  const timeoutMs = IN_FLIGHT_WAIT_TIMEOUT_MS + jitter;

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn("In-flight fetch wait timed out, will retry", {
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
  hash: string,
  code: string,
  _cacheDir: string,
  normalizedUrl: string,
  identityMetadata: HttpCacheIdentityMetadata,
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
          identityMetadata,
        );
        getLastDistributedRefresh().set(hashStr, now);
        logger.debug("Refreshed distributed cache TTL", { hash });

        const manifestId = getManifestIdForHash(hashStr);
        if (manifestId) {
          refreshManifestTTL(manifestId).catch((err) => {
            logger.debug("Manifest TTL refresh failed", {
              manifestId: manifestId.slice(0, 12),
              errorName: errorLogName(err),
            });
          });
        }
      } catch (error) {
        logger.debug("Distributed cache refresh failed", {
          hash,
          errorName: errorLogName(error),
        });
      }
    }
  })().catch((err) => {
    logger.debug("Distributed cache async refresh error", { errorName: errorLogName(err) });
  });
}

/**
 * Track bundle for manifest accumulation if in accumulation context.
 */
export function trackBundleAccumulator(
  hash: string,
  normalizedUrl: string,
  cachePath: string,
  knownSizeBytes?: number,
): Promise<void> {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (!accumulator || accumulator.some((entry) => entry.hash === hash)) {
    return Promise.resolve();
  }

  return (async () => {
    let sizeBytes = knownSizeBytes;
    if (sizeBytes === undefined) {
      try {
        const stat = await createFileSystem().stat(cachePath);
        sizeBytes = stat?.size ?? 0;
      } catch {
        return;
      }
    }

    if (accumulator.some((entry) => entry.hash === hash)) return;
    accumulator.push({
      hash: String(hash),
      url: normalizedUrl,
      sizeBytes,
    });
  })();
}
