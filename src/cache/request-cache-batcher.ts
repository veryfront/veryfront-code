/**
 * Request-Scoped Cache Batcher
 *
 * Optimizes cache operations by:
 * 1. Deduplicating cache key requests within a single HTTP request
 * 2. Batching multiple cache lookups into a single API call
 * 3. Caching results within the request scope to avoid repeated lookups
 *
 * This addresses the N+1 cache problem where the same keys are requested
 * multiple times during a single page render (observed: 36x redundancy ratio).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "#veryfront/utils";
import type { CacheBackend } from "./backend.ts";

interface PendingRequest {
  key: string;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
}

interface RequestCacheContext {
  /** Results already fetched in this request */
  cache: Map<string, string | null>;
  /** Keys currently being fetched (for deduplication of in-flight requests) */
  pending: Map<string, Promise<string | null>>;
  /** Batch queue for collecting keys before making a batch request */
  batchQueue: PendingRequest[];
  /** Timer for flushing batch queue */
  batchTimer: ReturnType<typeof setTimeout> | null;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();

/** Batch delay in ms - wait this long to collect more keys before making a batch request */
const BATCH_DELAY_MS = 1;

/** Max batch size - flush immediately if we reach this many keys */
const MAX_BATCH_SIZE = 100;

/**
 * Run a function with request-scoped cache batching enabled.
 * Call this at the start of each HTTP request to enable cache deduplication.
 */
export function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T> {
  const context: RequestCacheContext = {
    cache: new Map(),
    pending: new Map(),
    batchQueue: [],
    batchTimer: null,
  };

  return asyncLocalStorage.run(context, async () => {
    try {
      return await fn();
    } finally {
      // Clean up any pending batch timer
      if (context.batchTimer) {
        clearTimeout(context.batchTimer);
      }
    }
  });
}

/**
 * Get the current request cache context, if running within runWithCacheBatching.
 */
export function getRequestCacheContext(): RequestCacheContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get a cache value with request-scoped deduplication and batching.
 *
 * This function:
 * 1. Returns immediately if the key was already fetched in this request
 * 2. Joins an existing in-flight request if one exists for this key
 * 3. Otherwise, queues the key for batch fetching
 */
export async function getCachedWithBatching(
  backend: CacheBackend,
  key: string,
): Promise<string | null> {
  const ctx = asyncLocalStorage.getStore();

  // No batching context - fall back to direct backend call
  if (!ctx) {
    return backend.get(key);
  }

  // Check if we already have this key in request cache
  if (ctx.cache.has(key)) {
    return ctx.cache.get(key) ?? null;
  }

  // Check if there's already a pending request for this key
  const pending = ctx.pending.get(key);
  if (pending) {
    return pending;
  }

  // Create a new pending request
  const promise = new Promise<string | null>((resolve, reject) => {
    ctx.batchQueue.push({ key, resolve, reject });

    // Flush immediately if batch is full
    if (ctx.batchQueue.length >= MAX_BATCH_SIZE) {
      flushBatch(ctx, backend);
      return;
    }

    // Schedule batch flush after delay to collect more keys
    if (!ctx.batchTimer) {
      ctx.batchTimer = setTimeout(() => {
        ctx.batchTimer = null;
        flushBatch(ctx, backend);
      }, BATCH_DELAY_MS);
    }
  });

  ctx.pending.set(key, promise);

  try {
    const result = await promise;
    ctx.cache.set(key, result);
    return result;
  } finally {
    ctx.pending.delete(key);
  }
}

/**
 * Flush the batch queue and execute the batch request.
 */
async function flushBatch(ctx: RequestCacheContext, backend: CacheBackend): Promise<void> {
  if (ctx.batchQueue.length === 0) return;

  // Take all pending requests
  const requests = [...ctx.batchQueue];
  ctx.batchQueue = [];

  // Clear timer if set
  if (ctx.batchTimer) {
    clearTimeout(ctx.batchTimer);
    ctx.batchTimer = null;
  }

  // Deduplicate keys
  const uniqueKeys = [...new Set(requests.map((r) => r.key))];

  logger.debug("[RequestCacheBatcher] Flushing batch", {
    requested: requests.length,
    unique: uniqueKeys.length,
    dedupeRatio: requests.length > 0 ? (requests.length / uniqueKeys.length).toFixed(2) : "N/A",
  });

  try {
    // Use batch API if available and we have multiple keys
    let results: Map<string, string | null>;

    if (backend.getBatch && uniqueKeys.length > 1) {
      results = await backend.getBatch(uniqueKeys);
    } else {
      // Fall back to individual requests
      results = new Map();
      const promises = uniqueKeys.map(async (key) => {
        const value = await backend.get(key);
        results.set(key, value);
      });
      await Promise.all(promises);
    }

    // Resolve all pending requests
    for (const request of requests) {
      const value = results.get(request.key) ?? null;
      ctx.cache.set(request.key, value);
      request.resolve(value);
    }
  } catch (error) {
    // Reject all pending requests on error
    const err = error instanceof Error ? error : new Error(String(error));
    for (const request of requests) {
      request.reject(err);
    }
  }
}

/**
 * Set a value in the request cache (for write-through caching).
 */
export function setInRequestCache(key: string, value: string | null): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.cache.set(key, value);
  }
}

/**
 * Get stats about the current request's cache.
 */
export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return null;

  return {
    hits: 0, // Would need additional tracking
    stored: ctx.cache.size,
  };
}
