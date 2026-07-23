import { AsyncLocalStorage } from "node:async_hooks";
import { ensureError } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";
import { MAX_BATCH_SIZE } from "#veryfront/utils/constants/limits.ts";
import type { CacheBackend } from "./backend.ts";
import { buildBatchResults } from "./batch-results.ts";

const logger = baseLogger.component("request-cache-batcher");

interface PendingRequest {
  key: string;
  generation: number;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
}

interface BackendBatchState {
  cache: Map<string, string | null>;
  explicitCacheKeys: Set<string>;
  pending: Map<string, Promise<string | null>>;
  batchQueue: PendingRequest[];
  batchTimer: ReturnType<typeof setTimeout> | null;
  inflightFlushes: Set<Promise<void>>;
  generations: Map<string, number>;
}

interface RequestCacheContext extends BackendBatchState {
  backend: CacheBackend | null;
  additionalBackends: Map<CacheBackend, BackendBatchState>;
  hits: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();

const BATCH_DELAY_MS = 1;
const MAX_REQUEST_CACHE_KEYS = 1_000;
const MAX_REQUEST_CACHE_BACKENDS = 32;
const MAX_REQUEST_CACHE_KEY_CODE_UNITS = 64 * 1024;

function createBackendBatchState(): BackendBatchState {
  return {
    cache: new Map(),
    explicitCacheKeys: new Set(),
    pending: new Map(),
    batchQueue: [],
    batchTimer: null,
    inflightFlushes: new Set(),
    generations: new Map(),
  };
}

function getGeneration(state: BackendBatchState, key: string): number {
  return state.generations.get(key) ?? 0;
}

function advanceGeneration(state: BackendBatchState, key: string): void {
  state.generations.set(key, getGeneration(state, key) + 1);
}

function reserveRetainedKey(state: BackendBatchState, key: string): boolean {
  if (state.cache.has(key)) return true;

  while (state.cache.size >= MAX_REQUEST_CACHE_KEYS) {
    let victim: string | undefined;
    for (const candidate of state.cache.keys()) {
      if (!state.pending.has(candidate)) {
        victim = candidate;
        break;
      }
    }
    if (victim === undefined) return false;

    state.cache.delete(victim);
    state.explicitCacheKeys.delete(victim);
    state.generations.delete(victim);
  }
  return true;
}

function retainValue(
  state: BackendBatchState,
  key: string,
  value: string | null,
  explicit: boolean,
): boolean {
  if (key.length > MAX_REQUEST_CACHE_KEY_CODE_UNITS || !reserveRetainedKey(state, key)) {
    return false;
  }
  state.cache.set(key, value);
  if (explicit) state.explicitCacheKeys.add(key);
  return true;
}

function getBackendBatchState(
  context: RequestCacheContext,
  backend: CacheBackend,
): BackendBatchState | null {
  if (context.backend === null) {
    context.backend = backend;
    return context;
  }
  if (context.backend === backend) return context;

  const existing = context.additionalBackends.get(backend);
  if (existing) return existing;

  if (context.additionalBackends.size >= MAX_REQUEST_CACHE_BACKENDS - 1) {
    return null;
  }
  const state = createBackendBatchState();
  context.additionalBackends.set(backend, state);
  return state;
}

export function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T> {
  const primaryState = createBackendBatchState();
  const context: RequestCacheContext = {
    ...primaryState,
    backend: null,
    additionalBackends: new Map(),
    hits: 0,
  };

  return asyncLocalStorage.run(context, async () => {
    try {
      return await fn();
    } finally {
      // A caller may intentionally keep a read promise and return before
      // awaiting it. Drain queued and already-started work before closing the
      // request scope so those reads cannot outlive the batching lifecycle.
      const drains: Promise<void>[] = [];
      if (context.backend) drains.push(drainBatchState(context, context.backend));
      for (const [backend, state] of context.additionalBackends) {
        drains.push(drainBatchState(state, backend));
      }
      await Promise.all(drains);
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

  const state = getBackendBatchState(ctx, backend);
  if (!state || key.length > MAX_REQUEST_CACHE_KEY_CODE_UNITS) return backend.get(key);
  if (state.explicitCacheKeys.has(key)) {
    ctx.hits++;
    return state.cache.get(key) ?? null;
  }

  if (state.cache.has(key)) {
    ctx.hits++;
    return state.cache.get(key) ?? null;
  }

  const existingPending = state.pending.get(key);
  if (existingPending) {
    ctx.hits++;
    return existingPending;
  }

  if (state.pending.size >= MAX_REQUEST_CACHE_KEYS) {
    return backend.get(key);
  }

  const promise = new Promise<string | null>((resolve, reject) => {
    state.batchQueue.push({
      key,
      generation: getGeneration(state, key),
      resolve,
      reject,
    });

    if (state.batchQueue.length >= MAX_BATCH_SIZE) {
      void flushBatch(state, backend);
      return;
    }

    if (state.batchTimer) return;

    state.batchTimer = setTimeout(() => {
      state.batchTimer = null;
      void flushBatch(state, backend);
    }, BATCH_DELAY_MS);
  });

  state.pending.set(key, promise);

  try {
    return await promise;
  } finally {
    state.pending.delete(key);
    if (!state.cache.has(key) && !state.explicitCacheKeys.has(key)) {
      state.generations.delete(key);
    }
  }
}

function flushBatch(
  state: BackendBatchState,
  backend: CacheBackend,
): Promise<void> {
  if (state.batchQueue.length === 0) return Promise.resolve();

  const flush = performFlush(state, backend);
  state.inflightFlushes.add(flush);
  void flush.then(
    () => state.inflightFlushes.delete(flush),
    () => state.inflightFlushes.delete(flush),
  );
  return flush;
}

async function drainBatchState(
  state: BackendBatchState,
  backend: CacheBackend,
): Promise<void> {
  while (state.batchQueue.length > 0 || state.inflightFlushes.size > 0) {
    if (state.batchQueue.length > 0) void flushBatch(state, backend);
    await Promise.all([...state.inflightFlushes]);
  }
}

async function performFlush(
  state: BackendBatchState,
  backend: CacheBackend,
): Promise<void> {
  const requests = state.batchQueue;
  state.batchQueue = [];

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
    const results = backend.getBatch && uniqueKeys.length > 1
      ? await backend.getBatch(uniqueKeys)
      : await getIndividually(backend, uniqueKeys);

    for (const request of requests) {
      if (request.generation !== getGeneration(state, request.key)) {
        request.resolve(state.cache.get(request.key) ?? null);
        continue;
      }
      const value = results.get(request.key) ?? null;
      retainValue(state, request.key, value, false);
      request.resolve(value);
    }
  } catch (error) {
    const normalizedError = ensureError(error);
    for (const request of requests) {
      if (request.generation !== getGeneration(state, request.key)) {
        request.resolve(state.cache.get(request.key) ?? null);
      } else {
        request.reject(normalizedError);
      }
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

export function setInRequestCache(
  backend: CacheBackend,
  key: string,
  value: string | null,
): void {
  const context = asyncLocalStorage.getStore();
  if (!context) return;

  const state = getBackendBatchState(context, backend);
  if (!state || key.length > MAX_REQUEST_CACHE_KEY_CODE_UNITS) return;
  if (!reserveRetainedKey(state, key)) return;
  advanceGeneration(state, key);
  retainValue(state, key, value, true);
}

export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return null;

  let stored = ctx.cache.size;
  for (const state of ctx.additionalBackends.values()) stored += state.cache.size;
  return { hits: ctx.hits, stored };
}
