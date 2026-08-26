import { AsyncLocalStorage } from "node:async_hooks";
import { ensureError } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";
import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";
import type { CacheBackend, CacheReadOptions } from "./backend.ts";
import { buildBatchResults } from "./batch-results.ts";

const logger = baseLogger.component("request-cache-batcher");

interface PendingRequest {
  key: string;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
  /** See {@link CacheReadOptions}; forwarded to the flush that serves this key. */
  onAuthority?: CacheReadOptions["onAuthority"];
}

interface RequestCacheContext {
  cache: Map<string, string | null>;
  pending: Map<string, Promise<string | null>>;
  mutationVersions: Map<string, number>;
  batchQueue: PendingRequest[];
  batchTimer: ReturnType<typeof setTimeout> | null;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();

const BATCH_DELAY_MS = 1;

export function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T> {
  const context: RequestCacheContext = {
    cache: new Map(),
    pending: new Map(),
    mutationVersions: new Map(),
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
  options?: CacheReadOptions,
): Promise<string | null> {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return backend.get(key, options);

  if (ctx.cache.has(key)) return ctx.cache.get(key) ?? null;

  // A caller joining a read another caller already started gets that read's
  // promise, and its own `options.onAuthority` is deliberately NOT attached to
  // the in-flight request: the joining caller can see the key as pending and
  // must not treat the shared result as a read it performed itself.
  const existingPending = ctx.pending.get(key);
  if (existingPending) return existingPending;

  const mutationVersion = ctx.mutationVersions.get(key) ?? 0;
  const backendPromise = new Promise<string | null>((resolve, reject) => {
    ctx.batchQueue.push({ key, resolve, reject, onAuthority: options?.onAuthority });

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

  // An explicit request-local set or delete supersedes a backend read that was
  // already in flight. Return that newer local view instead of letting the
  // pending result overwrite it when the backend eventually responds.
  const promise = backendPromise.then((result) => {
    if ((ctx.mutationVersions.get(key) ?? 0) !== mutationVersion) {
      return ctx.cache.get(key) ?? null;
    }
    ctx.cache.set(key, result);
    return result;
  });

  ctx.pending.set(key, promise);

  try {
    return await promise;
  } finally {
    if (ctx.pending.get(key) === promise) ctx.pending.delete(key);
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

  logger.debug("Flushing batch", {
    requested: requests.length,
    unique: uniqueKeys.length,
    dedupeRatio: (requests.length / uniqueKeys.length).toFixed(2),
  });

  // One flush is one round of backend reads serving every queued key, so each
  // authority a gated backend resolves while performing those reads is
  // reported to every caller that asked: with per-key attribution unavailable
  // (a batch endpoint reads all keys under one authority, but its fallback
  // issues one read per key), a caller must treat each reported authority as
  // one its value may have been fetched under.
  const authorityObservers = requests.flatMap((request) =>
    request.onAuthority ? [request.onAuthority] : []
  );
  const readOptions: CacheReadOptions | undefined = authorityObservers.length > 0
    ? {
      onAuthority: (authority) => {
        for (const observer of authorityObservers) observer(authority);
      },
    }
    : undefined;

  try {
    const results = backend.getBatch && uniqueKeys.length > 1
      ? await backend.getBatch(uniqueKeys, readOptions)
      : await getIndividually(backend, uniqueKeys, readOptions);

    for (const request of requests) {
      const value = results.get(request.key) ?? null;
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
  options?: CacheReadOptions,
): Promise<Map<string, string | null>> {
  const entries = new Map<string, string | null>();
  await Promise.all(
    keys.map(async (key) => entries.set(key, await backend.get(key, options))),
  );
  return buildBatchResults(keys, (key) => entries.get(key) ?? null);
}

export function setInRequestCache(key: string, value: string | null): void {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return;
  ctx.mutationVersions.set(key, (ctx.mutationVersions.get(key) ?? 0) + 1);
  ctx.cache.set(key, value);
}

export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return null;

  return { hits: 0, stored: ctx.cache.size };
}
