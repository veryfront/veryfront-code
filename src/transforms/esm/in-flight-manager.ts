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
import { waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import { HTTP_MODULE_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { asLocalModuleCode } from "./http-cache-invariants.ts";
import { getManifestIdForHash, refreshManifestTTL } from "./bundle-manifest-ttl.ts";
import type { HttpCacheIdentityMetadata, HttpCacheLike } from "./http-cache-helpers.ts";
import type {
  TransformProgressEvent,
  TransformProgressListener,
} from "#veryfront/transforms/progress.ts";

const logger = rendererLogger.component("http-cache");

const DISTRIBUTED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Per-request stack used to detect circular HTTP module dependencies. */
export const processingStackStorage = new AsyncLocalStorage<Set<string>>();
/** Deduplicate concurrent HTTP module fetches to avoid races. */
export const inFlightHttpFetches = new Map<string, Promise<string | null>>();
/** Signals that awaiting another owner would close a shared-fetch dependency cycle. */
export const IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE = Symbol(
  "in-flight-http-fetch-dependency-cycle",
);

const inFlightHttpFetchOwnerStorage = new AsyncLocalStorage<string>();

/** Whether the current call is resolving a dependency for an active fetch owner. */
export function hasInFlightHttpFetchOwner(): boolean {
  return inFlightHttpFetchOwnerStorage.getStore() !== undefined;
}

interface InFlightHttpFetchAbortState {
  committed: boolean;
  commitTimeoutId?: ReturnType<typeof setTimeout>;
  controller: AbortController;
  completionDependencies: Map<string, Promise<string | null>>;
  completionDependencyReleases: Map<string, (reason?: unknown) => void>;
  dependencies: Map<string, number>;
  externalWaiters: number;
  promise?: Promise<string | null>;
  waiters: number;
  settled: boolean;
  progressListeners: Set<TransformProgressListener>;
}

export interface InFlightHttpFetchControl {
  /** Keep this generation authoritative after publication side effects begin. */
  commit(timeoutMs: number): boolean;
  /** Whether this owner is still the registered generation for its cache key. */
  isCurrent(): boolean;
}

const inFlightHttpFetchAbortStates = new Map<string, InFlightHttpFetchAbortState>();

function clearInFlightHttpFetchCommitTimeout(state: InFlightHttpFetchAbortState): void {
  if (state.commitTimeoutId === undefined) return;
  clearTimeout(state.commitTimeoutId);
  state.commitTimeoutId = undefined;
}

function releaseCompletionDependencyRetentions(
  state: InFlightHttpFetchAbortState,
  reason?: unknown,
): void {
  const releases = [...state.completionDependencyReleases.values()];
  state.completionDependencyReleases.clear();
  for (const release of releases) release(reason);
}

function removeInFlightHttpFetchAbortState(
  cacheKey: string,
  state: InFlightHttpFetchAbortState,
  reason?: unknown,
): void {
  if (inFlightHttpFetchAbortStates.get(cacheKey) !== state) return;
  clearInFlightHttpFetchCommitTimeout(state);
  inFlightHttpFetchAbortStates.delete(cacheKey);
  releaseCompletionDependencyRetentions(state, reason);
  state.completionDependencies.clear();
}

function releaseInFlightHttpFetchWaiter(
  cacheKey: string,
  promise: Promise<string | null>,
  state: InFlightHttpFetchAbortState,
  external: boolean,
  reason?: unknown,
): void {
  if (external) {
    state.externalWaiters--;
    if (state.externalWaiters === 0) {
      releaseCompletionDependencyRetentions(state, reason);
    }
  }
  state.waiters--;
  if (state.waiters !== 0) return;
  if (!state.settled) {
    if (state.committed) return;
    state.controller.abort(
      reason ?? new DOMException("HTTP module fetch has no active callers", "AbortError"),
    );
    if (inFlightHttpFetches.get(cacheKey) === promise) {
      inFlightHttpFetches.delete(cacheKey);
    }
  }
  removeInFlightHttpFetchAbortState(cacheKey, state, reason);
}

function retainCompletionDependency(
  ownerState: InFlightHttpFetchAbortState,
  cacheKey: string,
  promise: Promise<string | null>,
): void {
  const existingPromise = ownerState.completionDependencies.get(cacheKey);
  if (existingPromise !== promise) {
    ownerState.completionDependencyReleases.get(cacheKey)?.();
    ownerState.completionDependencyReleases.delete(cacheKey);
  } else if (ownerState.completionDependencyReleases.has(cacheKey)) {
    return;
  }
  ownerState.completionDependencies.set(cacheKey, promise);
  if (ownerState.externalWaiters === 0) return;

  const dependencyState = inFlightHttpFetchAbortStates.get(cacheKey);
  if (!dependencyState || dependencyState.promise !== promise) {
    ownerState.completionDependencyReleases.delete(cacheKey);
    return;
  }

  dependencyState.waiters++;
  let released = false;
  ownerState.completionDependencyReleases.set(cacheKey, (reason?: unknown) => {
    if (released) return;
    released = true;
    releaseInFlightHttpFetchWaiter(cacheKey, promise, dependencyState, false, reason);
  });
}

function retainStoredCompletionDependencies(state: InFlightHttpFetchAbortState): void {
  for (const [cacheKey, promise] of state.completionDependencies) {
    retainCompletionDependency(state, cacheKey, promise);
  }
}

function hasInFlightHttpFetchDependencyPath(
  fromCacheKey: string,
  toCacheKey: string,
  visited = new Set<string>(),
): boolean {
  if (fromCacheKey === toCacheKey) return true;
  if (visited.has(fromCacheKey)) return false;
  visited.add(fromCacheKey);

  const state = inFlightHttpFetchAbortStates.get(fromCacheKey);
  if (!state) return false;
  for (const [dependencyCacheKey, count] of state.dependencies) {
    if (
      count > 0 &&
      hasInFlightHttpFetchDependencyPath(dependencyCacheKey, toCacheKey, visited)
    ) {
      return true;
    }
  }
  return false;
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
    clearInFlightHttpFetchCommitTimeout(state);
    if (!state.settled) {
      state.controller.abort(
        new DOMException("The HTTP fetch registry was cleared", "AbortError"),
      );
    }
    state.completionDependencies.clear();
    state.completionDependencyReleases.clear();
  }
  inFlightHttpFetchAbortStates.clear();
  inFlightHttpFetches.clear();
}

/**
 * Start one shared HTTP fetch whose lifetime is owned by all of its waiters.
 */
export function createInFlightHttpFetch(
  cacheKey: string,
  compute: (
    abortSignal: AbortSignal,
    reportProgress: TransformProgressListener,
    control: InFlightHttpFetchControl,
  ) => Promise<string | null>,
): Promise<string | null> {
  const existing = inFlightHttpFetches.get(cacheKey);
  if (existing) return existing;

  const controller = new AbortController();
  const state: InFlightHttpFetchAbortState = {
    committed: false,
    controller,
    completionDependencies: new Map(),
    completionDependencyReleases: new Map(),
    dependencies: new Map(),
    externalWaiters: 0,
    waiters: 0,
    settled: false,
    progressListeners: new Set(),
  };
  const reportProgress = (event: TransformProgressEvent) => {
    for (const listener of state.progressListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.debug("HTTP fetch progress listener failed", { error });
      }
    }
  };
  const computation = Promise.resolve()
    .then(() =>
      inFlightHttpFetchOwnerStorage.run(
        cacheKey,
        () =>
          compute(controller.signal, reportProgress, {
            commit: (timeoutMs: number): boolean => {
              if (
                controller.signal.aborted || state.settled ||
                inFlightHttpFetches.get(cacheKey) !== promise
              ) {
                return false;
              }
              state.committed = true;
              state.commitTimeoutId ??= setTimeout(() => {
                if (state.settled || inFlightHttpFetches.get(cacheKey) !== promise) return;
                const reason = new DOMException(
                  "HTTP bundle publication timed out",
                  "TimeoutError",
                );
                state.committed = false;
                state.controller.abort(reason);
                if (inFlightHttpFetches.get(cacheKey) === promise) {
                  inFlightHttpFetches.delete(cacheKey);
                }
                removeInFlightHttpFetchAbortState(cacheKey, state, reason);
              }, timeoutMs);
              return true;
            },
            isCurrent: (): boolean => inFlightHttpFetches.get(cacheKey) === promise,
          }),
      )
    );
  const promise: Promise<string | null> = waitForSharedPromise(computation, controller.signal)
    .finally(() => {
      state.settled = true;
      clearInFlightHttpFetchCommitTimeout(state);
      if (inFlightHttpFetches.get(cacheKey) === promise) {
        inFlightHttpFetches.delete(cacheKey);
      }
      if (state.waiters === 0) removeInFlightHttpFetchAbortState(cacheKey, state);
    });

  state.promise = promise;
  inFlightHttpFetchAbortStates.set(cacheKey, state);
  inFlightHttpFetches.set(cacheKey, promise);
  return promise;
}

/**
 * Wait for shared HTTP work without letting one cancelled caller abort work
 * that still has other active waiters.
 */
export function waitForSharedInFlightHttpFetch(
  cacheKey: string,
  promise: Promise<string | null>,
  waitTimeoutMs: null,
  abortSignal?: AbortSignal,
  onProgress?: TransformProgressListener,
): Promise<string | null>;
export function waitForSharedInFlightHttpFetch(
  cacheKey: string,
  promise: Promise<string | null>,
  waitTimeoutMs: number,
  abortSignal?: AbortSignal,
  onProgress?: TransformProgressListener,
): Promise<
  string | null | undefined | typeof IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE
>;
export async function waitForSharedInFlightHttpFetch(
  cacheKey: string,
  promise: Promise<string | null>,
  waitTimeoutMs: number | null,
  abortSignal?: AbortSignal,
  onProgress?: TransformProgressListener,
): Promise<
  string | null | undefined | typeof IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE
> {
  const waitForFetch = (): Promise<string | null | undefined> =>
    waitTimeoutMs === null
      ? waitForSharedPromise(promise, abortSignal)
      : waitForInFlightFetch(promise, waitTimeoutMs, abortSignal);
  const state = inFlightHttpFetchAbortStates.get(cacheKey);
  if (!state || state.promise !== promise) {
    return await waitForFetch();
  }

  const ownerCacheKey = waitTimeoutMs === null
    ? undefined
    : inFlightHttpFetchOwnerStorage.getStore();
  const ownerState = ownerCacheKey ? inFlightHttpFetchAbortStates.get(ownerCacheKey) : undefined;
  if (
    ownerCacheKey && ownerState &&
    hasInFlightHttpFetchDependencyPath(cacheKey, ownerCacheKey)
  ) {
    retainCompletionDependency(ownerState, cacheKey, promise);
    return IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE;
  }
  if (ownerCacheKey && ownerState) {
    ownerState.dependencies.set(
      cacheKey,
      (ownerState.dependencies.get(cacheKey) ?? 0) + 1,
    );
  }

  const externalWaiter = ownerCacheKey === undefined;
  state.waiters++;
  if (externalWaiter) {
    state.externalWaiters++;
    if (state.externalWaiters === 1) retainStoredCompletionDependencies(state);
  }
  const progressListener = onProgress
    ? (event: TransformProgressEvent) => onProgress(event)
    : undefined;
  if (progressListener) state.progressListeners.add(progressListener);
  try {
    // Signal-bounded render callers keep their waiter lease while the same
    // shared generation is useful. Callers without cancellation regain
    // control after one bounded wait so they can retry.
    let result: string | null | undefined;
    do {
      result = await waitForFetch();
    } while (
      abortSignal !== undefined && result === undefined &&
      inFlightHttpFetches.get(cacheKey) === promise
    );
    if (result === undefined) return undefined;
    if (ownerCacheKey && ownerState) {
      for (const [dependencyCacheKey, dependencyPromise] of state.completionDependencies) {
        if (dependencyCacheKey !== ownerCacheKey) {
          retainCompletionDependency(ownerState, dependencyCacheKey, dependencyPromise);
        }
      }
    } else {
      await Promise.all(
        [...state.completionDependencies.entries()]
          .filter(([dependencyCacheKey]) => dependencyCacheKey !== cacheKey)
          .map(([dependencyCacheKey, dependencyPromise]) =>
            waitForSharedInFlightHttpFetch(
              dependencyCacheKey,
              dependencyPromise,
              null,
              abortSignal,
              onProgress,
            )
          ),
      );
    }
    return result;
  } finally {
    if (ownerCacheKey && ownerState) {
      const dependencyCount = ownerState.dependencies.get(cacheKey) ?? 0;
      if (dependencyCount <= 1) ownerState.dependencies.delete(cacheKey);
      else ownerState.dependencies.set(cacheKey, dependencyCount - 1);
    }
    if (progressListener) state.progressListeners.delete(progressListener);
    releaseInFlightHttpFetchWaiter(
      cacheKey,
      promise,
      state,
      externalWaiter,
      abortSignal?.reason,
    );
  }
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
