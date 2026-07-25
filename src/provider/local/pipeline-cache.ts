/**
 * Shared pipeline cache for local Transformers.js engines.
 *
 * Both the text-generation engine (`local-engine.ts`) and the embedding engine
 * (`local-embedding-engine.ts`) need to lazily load a pipeline per HuggingFace
 * model id, cache it, and deduplicate concurrent loads of the same model.
 *
 * Unlike a generic object cache, this cache owns native-backed pipelines. It
 * therefore keeps active-use leases and deterministically disposes retired
 * values once the final lease is released.
 *
 * @module provider/local
 */

import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("local-pipeline-cache");

/**
 * Maximum number of loaded pipelines kept in memory at once. Loaded models are
 * large (hundreds of MB each), so the cap is intentionally small.
 */
const PIPELINE_CACHE_MAX_ENTRIES = 4;

interface CacheEntry<P> {
  readonly cacheKey: string;
  readonly value: P;
  activeLeases: number;
  retired: boolean;
  leasesReleasedPromise?: Promise<void>;
  resolveLeasesReleased?: () => void;
  disposePromise?: Promise<void>;
}

interface LoadingState<P> {
  promise: Promise<CacheEntry<P>>;
  reject: (error: unknown) => void;
  reservedLeases: number;
  demandCount: number;
  loadStarted: boolean;
  canceled: boolean;
}

interface PendingLoad<P, M> {
  readonly cacheKey: string;
  readonly modelInfo: M;
  readonly state: LoadingState<P>;
  readonly resolve: (entry: CacheEntry<P>) => void;
  readonly reject: (error: unknown) => void;
}

export interface PipelineLease<P> {
  readonly value: P;
  release(): Promise<void>;
}

export interface PipelineCacheOptions<P> {
  /** Maximum number of idle or active entries tracked by the LRU. */
  maxEntries?: number;
  /** Release native resources owned by a retired pipeline. */
  dispose?: (pipeline: P) => void | Promise<void>;
}

/** A loaded pipeline cache with concurrency-safe, deduplicated loading. */
export interface PipelineCache<P, M> {
  /** Ensure a pipeline load has completed without exposing an unleased value. */
  preload(cacheKey: string, modelInfo: M): Promise<void>;
  /** Acquire an active-use lease for a pipeline. */
  acquire(cacheKey: string, modelInfo: M, abortSignal?: AbortSignal): Promise<PipelineLease<P>>;
  /** Whether a pipeline for the given model id is currently loaded. */
  has(cacheKey: string): boolean;
  /** Retire every pipeline and dispose it once its active leases are released. */
  clear(): Promise<void>;
}

function defaultDispose<P>(pipeline: P): void | Promise<void> {
  const candidate = pipeline as { dispose?: () => void | Promise<void> };
  return candidate?.dispose?.();
}

function requirePositiveSafeInteger(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive safe integer`);
  }
  return value;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

async function waitForCompletion(
  promise: Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (!abortSignal) return await promise;
  if (abortSignal.aborted) throw abortReason(abortSignal);

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener("abort", onAbort);
      reject(abortReason(abortSignal));
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        if (settled) return;
        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function waitForLease<P>(
  leasePromise: Promise<PipelineLease<P>>,
  abortSignal?: AbortSignal,
  onAbortBeforeSettle?: (reason: unknown) => void,
): Promise<PipelineLease<P>> {
  if (!abortSignal) return await leasePromise;
  if (abortSignal.aborted) {
    onAbortBeforeSettle?.(abortReason(abortSignal));
    leasePromise.then((lease) => lease.release()).catch(() => {});
    throw abortReason(abortSignal);
  }

  return await new Promise<PipelineLease<P>>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener("abort", onAbort);
      const reason = abortReason(abortSignal);
      onAbortBeforeSettle?.(reason);
      reject(reason);
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
    leasePromise.then(
      (lease) => {
        if (settled) {
          lease.release().catch(() => {});
          return;
        }
        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        resolve(lease);
      },
      (error) => {
        if (settled) return;
        settled = true;
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Create a bounded, dedup-aware pipeline cache.
 *
 * @param loadFn Loads the underlying pipeline for a model. Only invoked on a
 *   cold cache miss; concurrent loads of the same key share a single promise.
 */
export function createPipelineCache<P, M>(
  loadFn: (modelInfo: M) => Promise<P>,
  options: PipelineCacheOptions<P> = {},
): PipelineCache<P, M> {
  const maxEntries = requirePositiveSafeInteger(
    options.maxEntries ?? PIPELINE_CACHE_MAX_ENTRIES,
    "maxEntries",
  );
  const dispose = options.dispose ?? defaultDispose<P>;

  // Map insertion order is the LRU order: oldest first, newest last.
  const entries = new Map<string, CacheEntry<P>>();
  const loading = new Map<string, LoadingState<P>>();
  const pendingLoads: PendingLoad<P, M>[] = [];
  const activeLoadOperations = new Set<Promise<void>>();
  let activeLoads = 0;
  let clearInProgress: Promise<void> | undefined;

  function touch(entry: CacheEntry<P>): void {
    if (entry.retired || entries.get(entry.cacheKey) !== entry) return;
    entries.delete(entry.cacheKey);
    entries.set(entry.cacheKey, entry);
  }

  function disposeEntry(entry: CacheEntry<P>): Promise<void> {
    if (entry.disposePromise) return entry.disposePromise;
    if (!entry.retired) return Promise.resolve();

    entry.disposePromise = (async () => {
      if (entry.activeLeases > 0) {
        entry.leasesReleasedPromise ??= new Promise<void>((resolve) => {
          entry.resolveLeasesReleased = resolve;
        });
        await entry.leasesReleasedPromise;
      }

      try {
        await dispose(entry.value);
      } catch (error) {
        logger.warn("Failed to dispose retired local pipeline", {
          cacheKey: entry.cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return entry.disposePromise;
  }

  function retireEvictionCandidate(): Promise<void> | undefined {
    let candidate: [string, CacheEntry<P>] | undefined;
    for (const item of entries.entries()) {
      candidate ??= item;
      if (item[1].activeLeases === 0) {
        candidate = item;
        break;
      }
    }
    if (!candidate) return undefined;

    const [cacheKey, entry] = candidate;
    entries.delete(cacheKey);
    entry.retired = true;
    return disposeEntry(entry);
  }

  async function runPendingLoad(
    pending: PendingLoad<P, M>,
    evictedEntryDisposal?: Promise<void>,
  ): Promise<void> {
    const { cacheKey, modelInfo, state } = pending;
    try {
      // Dispose the eviction before allocating its replacement. If every
      // resident entry is leased, this intentionally waits for the selected
      // entry's final lease so native-backed values stay within the bound.
      await evictedEntryDisposal;
      if (state.canceled) return;

      state.loadStarted = true;
      const value = await loadFn(modelInfo);
      const entry: CacheEntry<P> = {
        cacheKey,
        value,
        activeLeases: state.reservedLeases,
        retired: false,
      };

      // Stop advertising this as an in-flight load before publishing the
      // evictable entry. There is no await between these mutations, so a late
      // caller can only observe the new entry or begin a fresh load after it
      // has been evicted, never reuse a stale LoadingState.
      if (loading.get(cacheKey) === state) loading.delete(cacheKey);

      if (state.demandCount === 0) {
        // Every caller abandoned this load after it was admitted. Do not let a
        // completed native pipeline pollute the cache.
        entry.retired = true;
        pending.resolve(entry);
        await disposeEntry(entry);
      } else {
        entries.set(cacheKey, entry);
        pending.resolve(entry);
      }
    } catch (error) {
      if (loading.get(cacheKey) === state) loading.delete(cacheKey);
      pending.reject(error);
    } finally {
      activeLoads = Math.max(0, activeLoads - 1);
      pumpPendingLoads();
    }
  }

  function pumpPendingLoads(): void {
    while (pendingLoads.length > 0) {
      let evictedEntryDisposal: Promise<void> | undefined;

      // Loaded entries and admitted cold loads share the same logical bound.
      // Retiring an LRU entry before starting its replacement prevents an
      // unbounded burst of distinct model downloads/native allocations.
      if (entries.size + activeLoads >= maxEntries) {
        evictedEntryDisposal = retireEvictionCandidate();
        if (!evictedEntryDisposal) return;
      }

      const pending = pendingLoads.shift();
      if (!pending) return;
      activeLoads += 1;
      const operation = runPendingLoad(pending, evictedEntryDisposal);
      activeLoadOperations.add(operation);
      operation
        .finally(() => activeLoadOperations.delete(operation))
        .catch(() => {});
    }
  }

  function beginLoad(cacheKey: string, modelInfo: M): LoadingState<P> {
    let resolve!: (entry: CacheEntry<P>) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<CacheEntry<P>>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const state: LoadingState<P> = {
      promise,
      reject,
      reservedLeases: 0,
      demandCount: 0,
      loadStarted: false,
      canceled: false,
    };

    loading.set(cacheKey, state);
    pendingLoads.push({ cacheKey, modelInfo, state, resolve, reject });
    // Observe failures even when every waiting caller abandons the load.
    state.promise.catch(() => {});
    pumpPendingLoads();

    return state;
  }

  function getOrBeginLoad(cacheKey: string, modelInfo: M): LoadingState<P> {
    return loading.get(cacheKey) ?? beginLoad(cacheKey, modelInfo);
  }

  function abandonPendingAcquire(
    cacheKey: string,
    state: LoadingState<P>,
    reason: unknown,
  ): boolean {
    // Publication removes the state synchronously before resolving its promise.
    // Once that has happened, the reserved lease must instead be created and
    // released by waitForLease's late-resolution path.
    if (loading.get(cacheKey) !== state) return false;

    state.reservedLeases = Math.max(0, state.reservedLeases - 1);
    state.demandCount = Math.max(0, state.demandCount - 1);
    if (state.demandCount > 0 || state.loadStarted) return true;

    state.canceled = true;
    loading.delete(cacheKey);
    state.reject(reason);
    const pendingIndex = pendingLoads.findIndex((pending) => pending.state === state);
    if (pendingIndex >= 0) {
      pendingLoads.splice(pendingIndex, 1);
      pumpPendingLoads();
    }
    return true;
  }

  function createLease(entry: CacheEntry<P>): PipelineLease<P> {
    let released = false;
    return {
      value: entry.value,
      async release(): Promise<void> {
        if (released) return;
        released = true;
        entry.activeLeases = Math.max(0, entry.activeLeases - 1);
        const finalLease = entry.activeLeases === 0;
        if (finalLease) {
          entry.resolveLeasesReleased?.();
          entry.resolveLeasesReleased = undefined;
        }
        const disposal = disposeEntry(entry);
        if (finalLease) await disposal;
      },
    };
  }

  return {
    async preload(cacheKey: string, modelInfo: M): Promise<void> {
      while (clearInProgress) await clearInProgress;

      const cached = entries.get(cacheKey);
      if (cached) {
        touch(cached);
        return;
      }

      const state = getOrBeginLoad(cacheKey, modelInfo);
      state.demandCount += 1;
      await state.promise;
    },

    async acquire(
      cacheKey: string,
      modelInfo: M,
      abortSignal?: AbortSignal,
    ): Promise<PipelineLease<P>> {
      if (abortSignal?.aborted) throw abortReason(abortSignal);
      while (clearInProgress) {
        await waitForCompletion(clearInProgress, abortSignal);
      }
      if (abortSignal?.aborted) throw abortReason(abortSignal);

      const cached = entries.get(cacheKey);
      if (cached) {
        cached.activeLeases += 1;
        touch(cached);
        return await waitForLease(Promise.resolve(createLease(cached)), abortSignal);
      }

      const state = getOrBeginLoad(cacheKey, modelInfo);
      state.reservedLeases += 1;
      state.demandCount += 1;
      let reservationAbandoned = false;
      const leasePromise = state.promise.then((entry) => {
        if (reservationAbandoned) throw abortReason(abortSignal!);
        return createLease(entry);
      });
      return await waitForLease(leasePromise, abortSignal, (reason) => {
        reservationAbandoned = abandonPendingAcquire(cacheKey, state, reason);
      });
    },

    has(cacheKey: string): boolean {
      return entries.has(cacheKey);
    },

    clear(): Promise<void> {
      if (clearInProgress) return clearInProgress;

      const operation = Promise.resolve()
        .then(async () => {
          // Calls entering after clear() are held at clearInProgress, so this
          // drains every load admitted before the clear boundary. Admission
          // can start another queued operation while a snapshot settles, so
          // continue to a fixed point before retiring the published entries.
          while (loading.size > 0 || activeLoadOperations.size > 0) {
            await Promise.allSettled([
              ...[...loading.values()].map((state) => state.promise),
              ...activeLoadOperations,
            ]);
          }

          const disposals: Promise<void>[] = [];
          for (const entry of entries.values()) {
            entry.retired = true;
            disposals.push(disposeEntry(entry));
          }
          entries.clear();
          await Promise.all(disposals);
        })
        .finally(() => {
          if (clearInProgress === operation) clearInProgress = undefined;
        });
      clearInProgress = operation;
      return operation;
    },
  };
}
