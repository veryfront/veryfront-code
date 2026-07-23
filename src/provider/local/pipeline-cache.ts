/**
 * Shared pipeline cache for local Transformers.js engines.
 *
 * Both the text-generation engine (`local-engine.ts`) and the embedding engine
 * (`local-embedding-engine.ts`) need to lazily load a pipeline per HuggingFace
 * model id, cache it, and deduplicate concurrent loads of the same model. This
 * helper captures that shared behavior and bounds the cache with an LRU so a
 * long-running process that touches many models cannot grow memory without
 * limit (loaded models are large).
 *
 * @module provider/local
 */

import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/**
 * Maximum number of loaded pipelines kept in memory at once. Loaded models are
 * large (hundreds of MB each), so the cap is intentionally small.
 */
const PIPELINE_CACHE_MAX_ENTRIES = 4;
const PIPELINE_CACHE_MAX_KEY_LENGTH = 512;
const PIPELINE_CACHE_MAX_CONCURRENT_LOADS = 4;

/** Active-use lease that prevents a loaded pipeline from being evicted. */
export interface PipelineLease<P> {
  /** Loaded pipeline value. */
  readonly value: P;
  /** Release this lease. Calling release more than once has no effect. */
  release(): void;
}

/** A loaded pipeline cache with concurrency-safe, deduplicated loading. */
export interface PipelineCache<P, M> {
  /** Load (or return cached) pipeline for the given model id. */
  load(cacheKey: string, modelInfo: M): Promise<P>;
  /** Load and retain a pipeline until the returned lease is released. */
  acquire(cacheKey: string, modelInfo: M): Promise<PipelineLease<P>>;
  /** Whether a pipeline for the given model id is currently loaded. */
  has(cacheKey: string): boolean;
}

interface PipelineEntry<P> {
  value: P;
  activeLeases: number;
}

interface PipelineCacheOptions<P> {
  dispose?: (pipeline: P) => void | Promise<void>;
}

function assertCacheKey(cacheKey: string): void {
  if (
    typeof cacheKey !== "string" || cacheKey.length === 0 ||
    cacheKey.length > PIPELINE_CACHE_MAX_KEY_LENGTH || hasUnsafeControlCharacters(cacheKey)
  ) {
    throw new TypeError("Pipeline cache key is invalid");
  }
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
  const entries = new Map<string, PipelineEntry<P>>();
  const loadingLocks = new Map<string, Promise<P>>();
  const pendingAcquires = new Map<string, number>();

  const touch = (cacheKey: string, entry: PipelineEntry<P>): void => {
    entries.delete(cacheKey);
    entries.set(cacheKey, entry);
  };

  const disposeEntry = async (entry: PipelineEntry<P>): Promise<void> => {
    if (!options.dispose) return;
    try {
      await options.dispose(entry.value);
    } catch {
      throw new Error("Local model pipeline could not be released");
    }
  };

  const reserveCapacity = async (): Promise<void> => {
    while (entries.size + loadingLocks.size > PIPELINE_CACHE_MAX_ENTRIES) {
      let evicted: PipelineEntry<P> | undefined;
      for (const [cacheKey, entry] of entries) {
        if (entry.activeLeases > 0 || (pendingAcquires.get(cacheKey) ?? 0) > 0) continue;
        entries.delete(cacheKey);
        evicted = entry;
        break;
      }
      if (!evicted) {
        throw new RangeError("Local model pipeline capacity is currently in use");
      }
      await disposeEntry(evicted);
    }
  };

  const load = async (cacheKey: string, modelInfo: M): Promise<P> => {
    assertCacheKey(cacheKey);
    const cached = entries.get(cacheKey);
    if (cached) {
      touch(cacheKey, cached);
      return cached.value;
    }

    const existingLock = loadingLocks.get(cacheKey);
    if (existingLock) return await existingLock;

    if (loadingLocks.size >= PIPELINE_CACHE_MAX_CONCURRENT_LOADS) {
      throw new RangeError("Local model pipeline load concurrency limit exceeded");
    }

    // Defer capacity selection by one microtask so the loading lock is visible
    // before any concurrent cold load performs the same calculation.
    const loadPromise: Promise<P> = (async () => {
      await Promise.resolve();
      await reserveCapacity();
      const pipeline = await loadFn(modelInfo);
      entries.set(cacheKey, { value: pipeline, activeLeases: 0 });
      return pipeline;
    })().finally(() => {
      if (loadingLocks.get(cacheKey) === loadPromise) {
        loadingLocks.delete(cacheKey);
      }
    });
    loadingLocks.set(cacheKey, loadPromise);
    return await loadPromise;
  };

  return {
    load,

    async acquire(cacheKey: string, modelInfo: M): Promise<PipelineLease<P>> {
      assertCacheKey(cacheKey);
      pendingAcquires.set(cacheKey, (pendingAcquires.get(cacheKey) ?? 0) + 1);
      let entry: PipelineEntry<P> | undefined;
      try {
        const value = await load(cacheKey, modelInfo);
        entry = entries.get(cacheKey);
        if (!entry || entry.value !== value) {
          throw new Error("Local model pipeline cache lost a pending lease");
        }
        entry.activeLeases++;
        touch(cacheKey, entry);
      } finally {
        const remaining = (pendingAcquires.get(cacheKey) ?? 1) - 1;
        if (remaining > 0) pendingAcquires.set(cacheKey, remaining);
        else pendingAcquires.delete(cacheKey);
      }

      let released = false;
      return {
        value: entry.value,
        release() {
          if (released) return;
          released = true;
          entry.activeLeases--;
        },
      };
    },

    has(cacheKey: string): boolean {
      assertCacheKey(cacheKey);
      const entry = entries.get(cacheKey);
      if (!entry) return false;
      touch(cacheKey, entry);
      return true;
    },
  };
}
