import { AsyncLocalStorage } from "node:async_hooks";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import { logger } from "#veryfront/utils";
import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";
import type { CacheBackend } from "./backend.ts";

interface PendingRequest {
  key: string;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
}

interface RequestCacheContext {
  cache: Map<string, string | null>;
  pending: Map<string, Promise<string | null>>;
  batchQueue: PendingRequest[];
  batchTimer: ReturnType<typeof setTimeout> | null;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();

const BATCH_DELAY_MS = 1;

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
      if (context.batchTimer) clearTimeout(context.batchTimer);
    }
  });
}

export function getRequestCacheContext(): RequestCacheContext | undefined {
  return asyncLocalStorage.getStore();
}

export async function getCachedWithBatching(
  backend: CacheBackend,
  key: string,
): Promise<string | null> {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return backend.get(key);

  if (ctx.cache.has(key)) return ctx.cache.get(key) ?? null;

  const existingPending = ctx.pending.get(key);
  if (existingPending) return existingPending;

  const promise = new Promise<string | null>((resolve, reject) => {
    ctx.batchQueue.push({ key, resolve, reject });

    if (ctx.batchQueue.length >= MAX_BATCH_SIZE) {
      void flushBatch(ctx, backend);
      return;
    }

    if (ctx.batchTimer) return;

    ctx.batchTimer = setTimeout(() => {
      ctx.batchTimer = null;
      void flushBatch(ctx, backend);
    }, BATCH_DELAY_MS);
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

async function flushBatch(ctx: RequestCacheContext, backend: CacheBackend): Promise<void> {
  if (ctx.batchQueue.length === 0) return;

  const requests = ctx.batchQueue;
  ctx.batchQueue = [];

  if (ctx.batchTimer) {
    clearTimeout(ctx.batchTimer);
    ctx.batchTimer = null;
  }

  const uniqueKeys = [...new Set(requests.map((r) => r.key))];

  logger.debug("[RequestCacheBatcher] Flushing batch", {
    requested: requests.length,
    unique: uniqueKeys.length,
    dedupeRatio: (requests.length / uniqueKeys.length).toFixed(2),
  });

  try {
    const results = backend.getBatch && uniqueKeys.length > 1
      ? await backend.getBatch(uniqueKeys)
      : await getIndividually(backend, uniqueKeys);

    for (const request of requests) {
      const value = results.get(request.key) ?? null;
      ctx.cache.set(request.key, value);
      request.resolve(value);
    }
  } catch (error) {
    const normalizedError = ensureError(error);
    for (const request of requests) request.reject(normalizedError);
  }
}

async function getIndividually(
  backend: CacheBackend,
  keys: string[],
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  await Promise.all(
    keys.map(async (key) => {
      results.set(key, await backend.get(key));
    }),
  );
  return results;
}

export function setInRequestCache(key: string, value: string | null): void {
  asyncLocalStorage.getStore()?.cache.set(key, value);
}

export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return null;

  return { hits: 0, stored: ctx.cache.size };
}
