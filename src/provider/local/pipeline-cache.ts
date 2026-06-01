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

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

/**
 * Maximum number of loaded pipelines kept in memory at once. Loaded models are
 * large (hundreds of MB each), so the cap is intentionally small.
 */
const PIPELINE_CACHE_MAX_ENTRIES = 4;

/** A loaded pipeline cache with concurrency-safe, deduplicated loading. */
export interface PipelineCache<P, M> {
  /** Load (or return cached) pipeline for the given model id. */
  load(cacheKey: string, modelInfo: M): Promise<P>;
  /** Whether a pipeline for the given model id is currently loaded. */
  has(cacheKey: string): boolean;
}

/**
 * Create a bounded, dedup-aware pipeline cache.
 *
 * @param loadFn Loads the underlying pipeline for a model. Only invoked on a
 *   cold cache miss; concurrent loads of the same key share a single promise.
 */
export function createPipelineCache<P, M>(
  loadFn: (modelInfo: M) => Promise<P>,
): PipelineCache<P, M> {
  const pipelineCache = new LRUCache<string, P>({
    maxEntries: PIPELINE_CACHE_MAX_ENTRIES,
  });

  // Whether a model is currently being loaded (prevents concurrent loads).
  const loadingLocks = new Map<string, Promise<P>>();

  return {
    async load(cacheKey: string, modelInfo: M): Promise<P> {
      // Return cached pipeline.
      const cached = pipelineCache.get(cacheKey);
      if (cached) return cached;

      // Wait for existing load if in progress.
      const existingLock = loadingLocks.get(cacheKey);
      if (existingLock) return existingLock;

      // Start loading.
      const loadPromise = (async () => {
        const pipe = await loadFn(modelInfo);
        pipelineCache.set(cacheKey, pipe);
        loadingLocks.delete(cacheKey);
        return pipe;
      })();

      loadingLocks.set(cacheKey, loadPromise);

      try {
        return await loadPromise;
      } catch (error) {
        loadingLocks.delete(cacheKey);
        throw error;
      }
    },

    has(cacheKey: string): boolean {
      return pipelineCache.has(cacheKey);
    },
  };
}
