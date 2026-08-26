import { AsyncLocalStorage } from "node:async_hooks";
import { ensureError } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";
import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";
import type { CacheBackend } from "./backend.ts";
import { buildBatchResults } from "./batch-results.ts";

const logger = baseLogger.component("request-cache-batcher");

interface PendingRequest {
  key: string;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
}

interface RequestCacheContext {
  cache: Map<string, string | null>;
  pending: Map<string, Promise<string | null>>;
  mutationVersions: Map<string, number>;
  batchQueue: PendingRequest[];
  batchTimer: ReturnType<typeof setTimeout> | null;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const IntrinsicMap = Map;
const IntrinsicClearTimeout = globalThis.clearTimeout;
const IntrinsicSetTimeout = globalThis.setTimeout;
const AsyncLocalStoragePrototype = AsyncLocalStorage.prototype;
const AsyncLocalStorageGetStore = AsyncLocalStoragePrototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStoragePrototype.run;
IntrinsicObjectDefineProperty(asyncLocalStorage, "getStore", {
  configurable: false,
  value: AsyncLocalStorageGetStore,
  writable: false,
});
IntrinsicObjectDefineProperty(asyncLocalStorage, "run", {
  configurable: false,
  value: AsyncLocalStorageRun,
  writable: false,
});

const BATCH_DELAY_MS = 1;

function getRequestCacheContextStore(): RequestCacheContext | undefined {
  return IntrinsicReflectApply(AsyncLocalStorageGetStore, asyncLocalStorage, []) as
    | RequestCacheContext
    | undefined;
}

function runWithRequestCacheContext<T>(
  context: RequestCacheContext,
  fn: () => Promise<T>,
): Promise<T> {
  return IntrinsicReflectApply(AsyncLocalStorageRun, asyncLocalStorage, [
    context,
    fn,
  ]) as Promise<T>;
}

function clearBatchTimer(timer: ReturnType<typeof setTimeout>): void {
  IntrinsicReflectApply(IntrinsicClearTimeout, globalThis, [timer]);
}

function scheduleBatchFlush(callback: () => void): ReturnType<typeof setTimeout> {
  return IntrinsicReflectApply(IntrinsicSetTimeout, globalThis, [
    callback,
    BATCH_DELAY_MS,
  ]) as ReturnType<typeof setTimeout>;
}

export function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T> {
  const context: RequestCacheContext = {
    cache: new IntrinsicMap(),
    pending: new IntrinsicMap(),
    mutationVersions: new IntrinsicMap(),
    batchQueue: [],
    batchTimer: null,
  };

  return runWithRequestCacheContext(context, async () => {
    try {
      return await fn();
    } finally {
      if (context.batchTimer) clearBatchTimer(context.batchTimer);
    }
  });
}

export function getRequestCacheContext(): RequestCacheContext | undefined {
  return getRequestCacheContextStore();
}

export async function getCachedWithBatching(
  backend: CacheBackend,
  key: string,
): Promise<string | null> {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return backend.get(key);

  if (ctx.cache.has(key)) return ctx.cache.get(key) ?? null;

  const existingPending = ctx.pending.get(key);
  if (existingPending) return existingPending;

  const mutationVersion = ctx.mutationVersions.get(key) ?? 0;
  const backendPromise = new Promise<string | null>((resolve, reject) => {
    ctx.batchQueue.push({ key, resolve, reject });

    if (ctx.batchQueue.length >= MAX_BATCH_SIZE) {
      void flushBatch(ctx, backend);
      return;
    }

    if (ctx.batchTimer) return;

    ctx.batchTimer = scheduleBatchFlush(() => {
      ctx.batchTimer = null;
      void flushBatch(ctx, backend);
    });
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
    clearBatchTimer(ctx.batchTimer);
    ctx.batchTimer = null;
  }

  const uniqueKeys = [...new Set(requests.map((r) => r.key))];

  logger.debug("Flushing batch", {
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
  const entries = new Map<string, string | null>();
  await Promise.all(
    keys.map(async (key) => entries.set(key, await backend.get(key))),
  );
  return buildBatchResults(keys, (key) => entries.get(key) ?? null);
}

export function setInRequestCache(key: string, value: string | null): void {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return;
  ctx.mutationVersions.set(key, (ctx.mutationVersions.get(key) ?? 0) + 1);
  ctx.cache.set(key, value);
}

export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return null;

  return { hits: 0, stored: ctx.cache.size };
}
