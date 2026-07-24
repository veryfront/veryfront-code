/**
 * Pages Router API Handler
 *
 * Handles Pages Router API routes (under /api/ directory).
 * Supports optional cache injection for testing.
 *
 * @module server/handlers/request/api/pages-api-handler
 */

import { APIRouteHandler } from "#veryfront/routing";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import type { HandlerContext } from "../../types.ts";

const logger = serverLogger.component("reset-api-handler");
const apply = Reflect.apply;
const randomUUID = crypto.randomUUID;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;
const stringEndsWith = String.prototype.endsWith;
const stringIncludes = String.prototype.includes;
const promiseCatch = Promise.prototype.catch;
const numberToString = Number.prototype.toString;
const stringPadStart = String.prototype.padStart;
const arrayJoin = Array.prototype.join;
const NativeArray = Array;
const NativeTextEncoder = TextEncoder;
const NativeUint8Array = Uint8Array;
const scopeTextEncoder = new NativeTextEncoder();
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const subtleDigest = SubtleCrypto.prototype.digest;
const nativeSubtleCrypto = crypto.subtle;
const API_HANDLER_CACHE_KEY_VERSION = "api-handler-v2";

export interface HandlerCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
  entries(): IterableIterator<[string, T]>;
  values(): IterableIterator<T>;
}

// LRU-backed implementation of HandlerCache so entries evict naturally in
// long-lived / multi-tenant processes instead of growing without bound.
export class LRUHandlerCache<T> implements HandlerCache<T> {
  private readonly lru: LRUCacheAdapter;
  private suppressEvictionCleanup = false;

  constructor(
    options: {
      maxEntries?: number;
      onEvict?: (value: T) => void;
    } = {},
  ) {
    this.lru = new LRUCacheAdapter({
      maxEntries: options.maxEntries ?? 1000,
      onEvict: (_key, value) => {
        if (!this.suppressEvictionCleanup) options.onEvict?.(value as T);
      },
    });
  }

  get(key: string): T | undefined {
    return this.lru.get<T>(key);
  }
  set(key: string, value: T): void {
    this.lru.set(key, value);
  }
  delete(key: string): boolean {
    const had = this.lru.has(key);
    this.suppressEvictionCleanup = true;
    try {
      this.lru.delete(key);
    } finally {
      this.suppressEvictionCleanup = false;
    }
    return had;
  }
  clear(): void {
    this.suppressEvictionCleanup = true;
    try {
      this.lru.clear();
    } finally {
      this.suppressEvictionCleanup = false;
    }
  }
  entries(): IterableIterator<[string, T]> {
    return this.lru.entries<T>();
  }
  *values(): IterableIterator<T> {
    for (const [, v] of this.lru.entries<T>()) yield v;
  }
}

const apiHandlerCache = new LRUHandlerCache<Promise<APIRouteHandler>>({
  onEvict: (promise) => {
    void destroyHandler(promise);
  },
});
let injectedCache: HandlerCache<Promise<APIRouteHandler>> | null = null;

interface HandlerLeaseState {
  active: number;
  destroyRequested: boolean;
  destroyPromise?: Promise<void>;
}

const handlerLeaseStates = new WeakMap<Promise<APIRouteHandler>, HandlerLeaseState>();

function getCache(): HandlerCache<Promise<APIRouteHandler>> {
  return injectedCache ?? apiHandlerCache;
}

export function __injectCacheForTests(
  cache: HandlerCache<Promise<APIRouteHandler>> | null,
): void {
  injectedCache = cache;
}

function getApiHandlerCacheContext(ctx: HandlerContext) {
  return tryGetCacheKeyContext() ?? extractCacheKeyContext(ctx);
}

function frameCacheKeySegment(value: string | undefined | null): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  return `s${value.length}:${value}`;
}

function projectCacheKeyPrefix(projectSlug: string): string {
  return `${API_HANDLER_CACHE_KEY_VERSION}|${frameCacheKeySegment(projectSlug)}|`;
}

function getCacheKey(ctx: HandlerContext): string {
  if (!ctx.projectSlug) return ctx.projectDir;

  const cacheContext = getApiHandlerCacheContext(ctx);
  // No safe scoped key (e.g. production without a releaseId): fall back to the
  // project-specific dir key rather than a shared bucket.
  if (!cacheContext) return ctx.projectDir;

  const fields = [
    ctx.projectDir,
    ctx.projectId,
    cacheContext.projectId,
    cacheContext.mode,
    cacheContext.versionId,
    ctx.releaseId,
    ctx.environmentId,
    ctx.environmentName,
    ctx.resolvedEnvironment,
    ctx.requestContext?.mode,
    ctx.requestContext?.branch,
    ctx.parsedDomain?.branch,
  ];
  let key = projectCacheKeyPrefix(ctx.projectSlug);
  for (let index = 0; index < fields.length; index++) {
    key += `${frameCacheKeySegment(fields[index])}|`;
  }
  return key;
}

function shouldCacheApiHandler(ctx: HandlerContext): boolean {
  if (!ctx.projectSlug) return true;

  // Cannot confirm a production context → do not cache.
  return getApiHandlerCacheContext(ctx)?.mode === "production";
}

async function refreshPreviewSourceSnapshot(ctx: HandlerContext): Promise<void> {
  if (!ctx.projectSlug) return;
  const cacheContext = getApiHandlerCacheContext(ctx);
  // Skip when production, or when the context is indeterminate.
  if (!cacheContext || cacheContext.mode === "production") return;

  await ctx.adapter.fs.refreshSourceSnapshot?.("preview-api-route-discovery");
}

async function hashScopeMaterial(material: string): Promise<string> {
  const bytes = apply(textEncoderEncode, scopeTextEncoder, [material]) as Uint8Array;
  const digest = await apply(subtleDigest, nativeSubtleCrypto, [
    "SHA-256",
    bytes,
  ]) as ArrayBuffer;
  const digestBytes = new NativeUint8Array(digest);
  const hex = new NativeArray<string>(digestBytes.byteLength);
  for (let index = 0; index < digestBytes.byteLength; index++) {
    const encoded = apply(numberToString, digestBytes[index]!, [16]) as string;
    hex[index] = apply(stringPadStart, encoded, [2, "0"]) as string;
  }
  return apply(arrayJoin, hex, [""]) as string;
}

async function createApiHandler(
  ctx: HandlerContext,
  capturedScopeKey = getCacheKey(ctx),
): Promise<APIRouteHandler> {
  await refreshPreviewSourceSnapshot(ctx);

  const scopeDigest = await hashScopeMaterial(capturedScopeKey);
  const executionScopeId = `api:${apply(stringSlice, scopeDigest, [0, 32])}:${
    apply(randomUUID, crypto, [])
  }`;

  const handler = new APIRouteHandler(
    ctx.projectDir,
    ctx.adapter,
    ctx.config,
    executionScopeId,
  );
  await handler.initialize();
  return handler;
}

function getHandlerLeaseState(promise: Promise<APIRouteHandler>): HandlerLeaseState {
  let state = handlerLeaseStates.get(promise);
  if (!state) {
    state = { active: 0, destroyRequested: false };
    handlerLeaseStates.set(promise, state);
  }
  return state;
}

function destroyHandlerNow(
  promise: Promise<APIRouteHandler>,
  state: HandlerLeaseState,
): Promise<void> {
  if (state.destroyPromise) return state.destroyPromise;

  state.destroyPromise = (async () => {
    try {
      const handler = await promise;
      handler.destroy?.();
    } catch (error) {
      try {
        logger.debug("Failed to destroy handler", error);
      } catch (_) {
        // expected: logger itself may throw during shutdown
      }
    }
  })();
  return state.destroyPromise;
}

async function destroyHandler(promise?: Promise<APIRouteHandler>): Promise<void> {
  if (!promise) return;

  const state = getHandlerLeaseState(promise);
  state.destroyRequested = true;
  if (state.active > 0) return;
  await destroyHandlerNow(promise, state);
}

function retainHandler(promise: Promise<APIRouteHandler>): () => Promise<void> {
  const state = getHandlerLeaseState(promise);
  state.active++;
  let released = false;

  return async () => {
    if (released) return;
    released = true;
    state.active--;
    if (state.active === 0 && state.destroyRequested) {
      await destroyHandlerNow(promise, state);
    }
  };
}

function getApiHandlerPromise(
  ctx: HandlerContext,
): { promise: Promise<APIRouteHandler>; cached: boolean } {
  const key = getCacheKey(ctx);
  if (!shouldCacheApiHandler(ctx)) {
    return { promise: createApiHandler(ctx, key), cached: false };
  }

  const cache = getCache();

  let promise = cache.get(key);
  if (!promise) {
    promise = createApiHandler(ctx, key);
    cache.set(key, promise);
    const installed = promise;
    void apply(promiseCatch, installed, [() => {
      // A transient initialization failure must not poison this immutable
      // release/environment key forever. Identity-check before deletion so a
      // late rejection cannot remove a newer successful retry.
      if (cache.get(key) !== installed) return;
      cache.delete(key);
      void destroyHandler(installed);
    }]);
  }

  return { promise, cached: true };
}

export async function getApiHandler(ctx: HandlerContext): Promise<APIRouteHandler> {
  return await getApiHandlerPromise(ctx).promise;
}

/**
 * Use an API handler while holding a lease that defers cache-eviction cleanup.
 * The lease begins before the handler promise is awaited, closing the gap
 * between a cache lookup and APIRouteHandler.handle() registering the request.
 */
export async function withApiHandler<T>(
  ctx: HandlerContext,
  use: (handler: APIRouteHandler) => T | Promise<T>,
): Promise<T> {
  const { promise, cached } = getApiHandlerPromise(ctx);
  const release = retainHandler(promise);

  try {
    return await use(await promise);
  } finally {
    if (!cached) await destroyHandler(promise);
    await release();
  }
}

export async function resetApiHandler(projectDir?: string): Promise<void> {
  const cache = getCache();

  if (projectDir) {
    const cached = cache.get(projectDir);
    cache.delete(projectDir);
    await destroyHandler(cached);
    return;
  }

  const handlers = Array.from(cache.values());
  cache.clear();
  await Promise.all(handlers.map(destroyHandler));
}

/**
 * Reset cached API handlers for a specific project slug.
 *
 * In proxy/production mode the cache key includes the project slug and release
 * context, so we can't reuse `resetApiHandler(projectDir)`. Instead we iterate
 * all entries and destroy those scoped to the project slug.
 */
export async function resetApiHandlerForProject(
  projectSlug: string,
): Promise<void> {
  const cache = getCache();
  const toDestroy: Promise<APIRouteHandler>[] = [];

  for (const [key, promise] of cache.entries()) {
    if (
      key === projectSlug ||
      apply(stringStartsWith, key, [projectCacheKeyPrefix(projectSlug)]) ||
      apply(stringEndsWith, key, [`:${projectSlug}`]) ||
      apply(stringIncludes, key, [`:${projectSlug}:`])
    ) {
      cache.delete(key);
      toDestroy.push(promise);
    }
  }

  await Promise.all(toDestroy.map(destroyHandler));
}
