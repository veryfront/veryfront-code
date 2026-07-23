import { AsyncLocalStorage } from "node:async_hooks";
import { ensureError, SERVICE_OVERLOADED } from "#veryfront/errors";
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

interface BackendRequestCacheContext {
  request: RequestCacheContext;
  backend: CacheBackend;
  cache: Map<string, string | null>;
  pending: Map<string, Promise<string | null>>;
  batchQueue: PendingRequest[];
  batchTimer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void> | null;
}

interface RequestCacheContext {
  /** Values explicitly seeded by request-local writers, shared across backends. */
  cache: Map<string, string | null>;
  /** Exposed for diagnostics; pending work remains isolated by backend identity. */
  pending: Map<CacheBackend, Map<string, Promise<string | null>>>;
  backendStates: Map<CacheBackend, BackendRequestCacheContext>;
  storageOrder: StoredRequestCacheEntry[];
  storedBytes: number;
  pendingCount: number;
  hits: number;
  closing: boolean;
}

interface StoredRequestCacheEntry {
  owner: Map<string, string | null>;
  key: string;
  sizeBytes: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();

const BATCH_DELAY_MS = 1;
const MAX_REQUEST_CACHE_BACKENDS = 64;
const MAX_REQUEST_CACHE_ENTRIES = 1000;
const MAX_REQUEST_CACHE_PENDING_KEYS = 2000;
const MAX_REQUEST_CACHE_BYTES = 64 * 1024 * 1024;
const cacheEntryEncoder = new TextEncoder();

function setBounded(
  context: RequestCacheContext,
  cache: Map<string, string | null>,
  key: string,
  value: string | null,
): void {
  const existingIndex = context.storageOrder.findIndex((entry) =>
    entry.owner === cache && entry.key === key
  );
  if (existingIndex !== -1) {
    const [existing] = context.storageOrder.splice(existingIndex, 1);
    context.storedBytes -= existing?.sizeBytes ?? 0;
  }
  cache.delete(key);

  const sizeBytes = cacheEntryEncoder.encode(key).byteLength +
    (value === null ? 0 : cacheEntryEncoder.encode(value).byteLength);
  if (sizeBytes > MAX_REQUEST_CACHE_BYTES) return;

  while (
    context.storageOrder.length >= MAX_REQUEST_CACHE_ENTRIES ||
    context.storedBytes + sizeBytes > MAX_REQUEST_CACHE_BYTES
  ) {
    const oldest = context.storageOrder.shift();
    if (!oldest) break;
    oldest.owner.delete(oldest.key);
    context.storedBytes -= oldest.sizeBytes;
  }

  cache.set(key, value);
  context.storageOrder.push({ owner: cache, key, sizeBytes });
  context.storedBytes += sizeBytes;
}

function getBackendContext(
  context: RequestCacheContext,
  backend: CacheBackend,
): BackendRequestCacheContext {
  const existing = context.backendStates.get(backend);
  if (existing) return existing;
  if (context.backendStates.size >= MAX_REQUEST_CACHE_BACKENDS) {
    throw SERVICE_OVERLOADED.create({
      message: "Request cache backend capacity exceeded",
    });
  }

  const state: BackendRequestCacheContext = {
    request: context,
    backend,
    cache: new Map(),
    pending: new Map(),
    batchQueue: [],
    batchTimer: null,
    flushPromise: null,
  };
  context.backendStates.set(backend, state);
  context.pending.set(backend, state.pending);
  return state;
}

export function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T> {
  const context: RequestCacheContext = {
    cache: new Map(),
    pending: new Map(),
    backendStates: new Map(),
    storageOrder: [],
    storedBytes: 0,
    pendingCount: 0,
    hits: 0,
    closing: false,
  };

  return asyncLocalStorage.run(context, async () => {
    try {
      return await fn();
    } finally {
      context.closing = true;
      await Promise.allSettled(
        Array.from(context.backendStates.values(), (state) => flushBatch(state)),
      );
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
  if (ctx.closing) return backend.get(key);

  if (ctx.cache.has(key)) {
    ctx.hits++;
    return ctx.cache.get(key) ?? null;
  }

  const state = getBackendContext(ctx, backend);
  if (state.cache.has(key)) {
    ctx.hits++;
    return state.cache.get(key) ?? null;
  }

  const existingPending = state.pending.get(key);
  if (existingPending) return existingPending;
  if (ctx.pendingCount >= MAX_REQUEST_CACHE_PENDING_KEYS) {
    throw SERVICE_OVERLOADED.create({
      message: "Request cache pending-work capacity exceeded",
    });
  }
  ctx.pendingCount++;

  let promise: Promise<string | null>;
  try {
    promise = new Promise<string | null>((resolve, reject) => {
      state.batchQueue.push({ key, resolve, reject });

      if (state.batchQueue.length >= MAX_BATCH_SIZE) {
        void flushBatch(state);
        return;
      }

      if (state.batchTimer) return;

      state.batchTimer = setTimeout(() => {
        state.batchTimer = null;
        void flushBatch(state);
      }, BATCH_DELAY_MS);
    });
  } catch (error) {
    ctx.pendingCount--;
    throw error;
  }

  state.pending.set(key, promise);

  try {
    const result = await promise;
    setBounded(ctx, state.cache, key, result);
    return result;
  } finally {
    if (state.pending.delete(key)) ctx.pendingCount--;
  }
}

async function flushBatch(state: BackendRequestCacheContext): Promise<void> {
  if (state.flushPromise) return state.flushPromise;

  const operation = flushQueuedBatches(state);
  const tracked = operation.finally(() => {
    if (state.flushPromise === tracked) state.flushPromise = null;
  });
  state.flushPromise = tracked;
  return tracked;
}

async function flushQueuedBatches(state: BackendRequestCacheContext): Promise<void> {
  if (state.batchQueue.length === 0) {
    if (state.batchTimer) {
      clearTimeout(state.batchTimer);
      state.batchTimer = null;
    }
    return;
  }

  while (state.batchQueue.length > 0) {
    const requests = state.batchQueue.splice(0, MAX_BATCH_SIZE);

    if (state.batchTimer) {
      clearTimeout(state.batchTimer);
      state.batchTimer = null;
    }

    const uniqueKeys = [...new Set(requests.map((r) => r.key))];

    logger.debug("Flushing batch", {
      requested: requests.length,
      unique: uniqueKeys.length,
      dedupeRatio: (requests.length / uniqueKeys.length).toFixed(2),
    });

    try {
      const results = state.backend.getBatch && uniqueKeys.length > 1
        ? await state.backend.getBatch(uniqueKeys)
        : await getIndividually(state.backend, uniqueKeys);

      for (const request of requests) {
        const value = results.get(request.key) ?? null;
        setBounded(state.request, state.cache, request.key, value);
        request.resolve(value);
      }
    } catch (error) {
      const normalizedError = ensureError(error);
      for (const request of requests) request.reject(normalizedError);
    }
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
  const context = asyncLocalStorage.getStore();
  if (!context || context.closing) return;
  setBounded(context, context.cache, key, value);
}

export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return null;

  return { hits: ctx.hits, stored: ctx.storageOrder.length };
}
