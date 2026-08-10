/**
 * Concurrent fetch deduplication and distributed cache refresh management.
 *
 * Manages in-flight HTTP module fetches to prevent thundering herd,
 * and handles periodic distributed cache TTL refreshes.
 *
 * @module transforms/esm/in-flight-manager
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { rendererLogger } from "#veryfront/utils";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { asLocalModuleCode } from "./http-cache-invariants.ts";
import { getManifestIdForHash, refreshManifestTTL } from "./bundle-manifest-ttl.ts";
import type { HttpCacheIdentityMetadata, HttpCacheLike } from "./http-cache-helpers.ts";

const logger = rendererLogger.component("http-cache");

const DISTRIBUTED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Per-request stack used to detect circular HTTP module dependencies. */
export const processingStackStorage = new AsyncLocalStorage<Set<string>>();
/** Deduplicate concurrent HTTP module fetches to avoid races. */
export const inFlightHttpFetches = new Map<string, Promise<string | null>>();

interface InFlightHttpFetchAbortState {
  controller: AbortController;
  waiters: number;
  settled: boolean;
}

const inFlightHttpFetchAbortStates = new Map<
  Promise<string | null>,
  InFlightHttpFetchAbortState
>();

type ReleaseInFlightHttpFetch = (reason?: unknown) => void;

function retainInFlightHttpFetchState(
  state: InFlightHttpFetchAbortState,
): ReleaseInFlightHttpFetch {
  state.waiters++;
  let released = false;
  return (reason?: unknown) => {
    if (released) return;
    released = true;
    state.waiters = Math.max(0, state.waiters - 1);
    if (state.waiters === 0 && !state.settled) {
      state.controller.abort(
        reason ?? new DOMException("The HTTP module fetch was canceled", "AbortError"),
      );
    }
  };
}

/** Create shared HTTP work whose cancellation follows all active waiters. */
export function createInFlightHttpFetch(
  operation: (abortSignal: AbortSignal) => Promise<string | null>,
): { promise: Promise<string | null>; retain: () => ReleaseInFlightHttpFetch } {
  const controller = new AbortController();
  let promise: Promise<string | null>;
  try {
    promise = operation(controller.signal);
  } catch (error) {
    promise = Promise.reject(error);
  }

  const state: InFlightHttpFetchAbortState = {
    controller,
    waiters: 0,
    settled: false,
  };
  inFlightHttpFetchAbortStates.set(promise, state);
  const settle = () => {
    state.settled = true;
    inFlightHttpFetchAbortStates.delete(promise);
  };
  void promise.then(settle, settle);

  return {
    promise,
    retain: () => retainInFlightHttpFetchState(state),
  };
}

/** Retain an existing shared HTTP fetch for one additional caller. */
export function retainInFlightHttpFetch(
  promise: Promise<string | null>,
): ReleaseInFlightHttpFetch {
  const state = inFlightHttpFetchAbortStates.get(promise);
  return state ? retainInFlightHttpFetchState(state) : () => {};
}

/** Return the largest shared-fetch waiter count for deterministic tests. */
export function __getMaxInFlightHttpFetchWaiterCountForTests(): number {
  let maximum = 0;
  for (const state of inFlightHttpFetchAbortStates.values()) {
    maximum = Math.max(maximum, state.waiters);
  }
  return maximum;
}

/** Maximum time to wait for an in-flight fetch from another request before retrying */
const IN_FLIGHT_WAIT_TIMEOUT_MS = 30_000;

/**
 * Clear all in-flight HTTP fetches.
 * Used for testing to ensure clean state between tests.
 */
export function __clearInFlightHttpFetches(): void {
  for (const state of inFlightHttpFetchAbortStates.values()) {
    if (!state.settled) {
      state.controller.abort(
        new DOMException("The HTTP fetch registry was cleared", "AbortError"),
      );
    }
  }
  inFlightHttpFetchAbortStates.clear();
  inFlightHttpFetches.clear();
}

/** Jitter to spread out timeout retries and prevent thundering herd (0-5s) */
const IN_FLIGHT_JITTER_MS = 5_000;

/**
 * Wait for an in-flight fetch. The default timeout includes jitter; callers
 * with a bounded owner operation can supply its complete wait window.
 * Returns undefined on timeout so caller can retry.
 */
export async function waitForInFlightFetch(
  promise: Promise<string | null>,
  waitTimeoutMs?: number,
  abortSignal?: AbortSignal,
): Promise<string | null | undefined> {
  abortSignal?.throwIfAborted();
  const timeoutMs = waitTimeoutMs === undefined
    ? IN_FLIGHT_WAIT_TIMEOUT_MS + Math.floor(Math.random() * IN_FLIGHT_JITTER_MS)
    : waitTimeoutMs;

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn("In-flight fetch wait timed out, will retry", {
        timeoutMs,
      });
      resolve(undefined);
    }, timeoutMs);
  });

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = abortSignal
    ? new Promise<never>((_, reject) => {
      const abort = () => {
        reject(
          abortSignal.reason ?? new DOMException("The operation was aborted", "AbortError"),
        );
      };
      if (abortSignal.aborted) {
        abort();
        return;
      }
      abortSignal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => abortSignal.removeEventListener("abort", abort);
    })
    : undefined;

  try {
    return await Promise.race(
      abortPromise ? [promise, timeoutPromise, abortPromise] : [promise, timeoutPromise],
    );
  } finally {
    clearTimeout(timeoutId!);
    removeAbortListener?.();
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
