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
  parsedCache: Map<string, { raw: string; value: unknown }>;
  pending: Map<string, Promise<string | null>>;
  mutationVersions: Map<string, number>;
  batchQueue: PendingRequest[];
  batchTimer: ReturnType<typeof setTimeout> | null;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCacheContext>();
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const IntrinsicMap = Map;
const IntrinsicPromise = Promise;
const IntrinsicClearTimeout = globalThis.clearTimeout;
const IntrinsicSetTimeout = globalThis.setTimeout;
const ArrayPrototypePush = Array.prototype.push;
const MapPrototypeDelete = Map.prototype.delete;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeHas = Map.prototype.has;
const MapPrototypeSet = Map.prototype.set;
const MapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const PromiseAll = IntrinsicPromise.all;
const AsyncLocalStoragePrototype = AsyncLocalStorage.prototype;
const AsyncLocalStorageEnterWith = AsyncLocalStoragePrototype.enterWith;
const AsyncLocalStorageGetStore = AsyncLocalStoragePrototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStoragePrototype.run;
IntrinsicObjectDefineProperty(asyncLocalStorage, "enterWith", {
  configurable: false,
  value: AsyncLocalStorageEnterWith,
  writable: false,
});
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

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return IntrinsicReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapDeleteIfValue<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (mapGet(map, key) === value) mapDelete(map, key);
}

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return IntrinsicReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapHas<K, V>(map: Map<K, V>, key: K): boolean {
  return IntrinsicReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  IntrinsicReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize<K, V>(map: Map<K, V>): number {
  return IntrinsicReflectApply(MapSizeGetter, map, []) as number;
}

function pushArray<T>(values: T[], value: T): void {
  IntrinsicReflectApply(ArrayPrototypePush, values, [value]);
}

function formatRatio(value: number): string {
  return IntrinsicReflectApply(NumberPrototypeToFixed, value, [2]) as string;
}

export function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T> {
  const context: RequestCacheContext = {
    cache: new IntrinsicMap(),
    parsedCache: new IntrinsicMap(),
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

export function parseRequestCachedValue<T>(
  key: string,
  raw: string,
  parse: (value: string) => T,
): T {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return parse(raw);

  const cached = mapGet(ctx.parsedCache, key);
  if (cached?.raw === raw) return cached.value as T;

  const value = parse(raw);
  mapSet(ctx.parsedCache, key, { raw, value });
  return value;
}

export async function getCachedWithBatching(
  backend: CacheBackend,
  key: string,
  options?: CacheReadOptions,
): Promise<string | null> {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return backend.get(key, options);

  if (mapHas(ctx.cache, key)) return mapGet(ctx.cache, key) ?? null;

  // A caller joining a read another caller already started gets that read's
  // promise, and its own `options.onAuthority` is deliberately NOT attached to
  // the in-flight request: the joining caller can see the key as pending and
  // must not treat the shared result as a read it performed itself.
  const existingPending = mapGet(ctx.pending, key);
  if (existingPending) return existingPending;

  const mutationVersion = mapGet(ctx.mutationVersions, key) ?? 0;
  const backendPromise = new IntrinsicPromise<string | null>((resolve, reject) => {
    pushArray(ctx.batchQueue, { key, resolve, reject, onAuthority: options?.onAuthority });

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
  const promise = (async () => {
    const result = await backendPromise;
    if ((mapGet(ctx.mutationVersions, key) ?? 0) !== mutationVersion) {
      return mapGet(ctx.cache, key) ?? null;
    }
    mapSet(ctx.cache, key, result);
    return result;
  })();

  mapSet(ctx.pending, key, promise);

  try {
    return await promise;
  } finally {
    mapDeleteIfValue(ctx.pending, key, promise);
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

  const uniqueKeys: string[] = [];
  const seenKeys = new IntrinsicMap<string, true>();
  for (let index = 0; index < requests.length; index++) {
    const key = requests[index]!.key;
    if (mapHas(seenKeys, key)) continue;
    mapSet(seenKeys, key, true);
    pushArray(uniqueKeys, key);
  }

  logger.debug("Flushing batch", {
    requested: requests.length,
    unique: uniqueKeys.length,
    dedupeRatio: formatRatio(requests.length / uniqueKeys.length),
  });

  // One flush is one round of backend reads serving every queued key, so each
  // authority a gated backend resolves while performing those reads is
  // reported to every caller that asked: with per-key attribution unavailable
  // (a batch endpoint reads all keys under one authority, but its fallback
  // issues one read per key), a caller must treat each reported authority as
  // one its value may have been fetched under.
  const authorityObservers: Array<NonNullable<CacheReadOptions["onAuthority"]>> = [];
  for (let index = 0; index < requests.length; index++) {
    const observer = requests[index]!.onAuthority;
    if (observer) pushArray(authorityObservers, observer);
  }
  const readOptions: CacheReadOptions | undefined = authorityObservers.length > 0
    ? {
      onAuthority: (authority) => {
        for (let index = 0; index < authorityObservers.length; index++) {
          authorityObservers[index]!(authority);
        }
      },
    }
    : undefined;

  try {
    const results = backend.getBatch && uniqueKeys.length > 1
      ? await backend.getBatch(uniqueKeys, readOptions)
      : await getIndividually(backend, uniqueKeys, readOptions);

    for (let index = 0; index < requests.length; index++) {
      const request = requests[index]!;
      const value = mapGet(results, request.key) ?? null;
      request.resolve(value);
    }
  } catch (error) {
    const normalizedError = ensureError(error);
    for (let index = 0; index < requests.length; index++) {
      requests[index]!.reject(normalizedError);
    }
  }
}

async function getIndividually(
  backend: CacheBackend,
  keys: string[],
  options?: CacheReadOptions,
): Promise<Map<string, string | null>> {
  const entries = new IntrinsicMap<string, string | null>();
  const reads: Array<Promise<void>> = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    pushArray(reads, (async () => mapSet(entries, key, await backend.get(key, options)))());
  }
  await IntrinsicReflectApply(PromiseAll, IntrinsicPromise, [reads]);
  return buildBatchResults(keys, (key) => mapGet(entries, key) ?? null);
}

export function setInRequestCache(key: string, value: string | null): void {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return;
  mapSet(ctx.mutationVersions, key, (mapGet(ctx.mutationVersions, key) ?? 0) + 1);
  mapSet(ctx.cache, key, value);
}

export function getRequestCacheStats(): { hits: number; stored: number } | null {
  const ctx = getRequestCacheContextStore();
  if (!ctx) return null;

  return { hits: 0, stored: mapSize(ctx.cache) };
}
