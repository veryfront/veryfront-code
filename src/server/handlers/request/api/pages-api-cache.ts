/** Owns the Pages Router API handler cache and its lifecycle. */

import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import type { HandlerContext } from "#veryfront/types";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import { containsUnsafeCacheStringCharacter } from "#veryfront/cache/validation.ts";
import { getSafeErrorName } from "../../../utils/error-name.ts";
import type { APIRouteHandler } from "#veryfront/routing";

const logger = serverLogger.component("reset-api-handler");

const CACHE_KEY_NAMESPACE = "pages-api-handler";
const CACHE_KEY_VERSION = 1;
const MAX_CACHE_IDENTITY_SEGMENT_LENGTH = 4096;
const MAX_CACHE_KEY_LENGTH = 20_000;

type LocalCacheIdentity = readonly [
  typeof CACHE_KEY_NAMESPACE,
  typeof CACHE_KEY_VERSION,
  projectDir: string,
  projectSlug: null,
  projectId: null,
  versionId: null,
];

type ProductionCacheIdentity = readonly [
  typeof CACHE_KEY_NAMESPACE,
  typeof CACHE_KEY_VERSION,
  projectDir: string,
  projectSlug: string,
  projectId: string,
  versionId: string,
];

type CacheIdentity = LocalCacheIdentity | ProductionCacheIdentity;

export interface HandlerCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
  entries(): IterableIterator<[string, T]>;
  values(): IterableIterator<T>;
}

/** LRU-backed resource cache with explicit manual-removal ownership. */
export class LRUHandlerCache<T> implements HandlerCache<T> {
  readonly #lru: LRUCacheAdapter;
  #suppressEvictionCleanup = false;

  constructor(
    options: {
      maxEntries?: number;
      onEvict?: (value: T) => void;
    } = {},
  ) {
    this.#lru = new LRUCacheAdapter({
      maxEntries: options.maxEntries ?? 1000,
      onEvict: (_key, value) => {
        if (!this.#suppressEvictionCleanup) options.onEvict?.(value as T);
      },
    });
  }

  get(key: string): T | undefined {
    return this.#lru.get<T>(key);
  }

  set(key: string, value: T): void {
    if (this.#lru.has(key)) {
      if (Object.is(this.#lru.get<T>(key), value)) return;
      this.#lru.delete(key);
    }
    this.#lru.set(key, value);
  }

  delete(key: string): boolean {
    const had = this.#lru.has(key);
    this.#suppressEvictionCleanup = true;
    try {
      this.#lru.delete(key);
    } finally {
      this.#suppressEvictionCleanup = false;
    }
    return had;
  }

  clear(): void {
    this.#suppressEvictionCleanup = true;
    try {
      this.#lru.clear();
    } finally {
      this.#suppressEvictionCleanup = false;
    }
  }

  entries(): IterableIterator<[string, T]> {
    return this.#lru.entries<T>();
  }

  *values(): IterableIterator<T> {
    for (const [, value] of this.#lru.entries<T>()) yield value;
  }
}

interface HandlerLeaseState {
  active: number;
  destroyRequested: boolean;
  destroyPromise?: Promise<void>;
}

function isValidIdentitySegment(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_CACHE_IDENTITY_SEGMENT_LENGTH &&
    !containsUnsafeCacheStringCharacter(value);
}

function encodeCacheIdentity(identity: CacheIdentity): string | null {
  if (!identity.slice(2).every((value) => value === null || isValidIdentitySegment(value))) {
    return null;
  }

  const encoded = JSON.stringify(identity);
  return encoded.length <= MAX_CACHE_KEY_LENGTH ? encoded : null;
}

function decodeCacheIdentity(key: string): CacheIdentity | null {
  if (key.length === 0 || key.length > MAX_CACHE_KEY_LENGTH) return null;

  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 6) return null;
    if (value[0] !== CACHE_KEY_NAMESPACE || value[1] !== CACHE_KEY_VERSION) return null;
    if (!isValidIdentitySegment(value[2])) return null;

    const [, , projectDir, projectSlug, projectId, versionId] = value;
    if (projectSlug === null && projectId === null && versionId === null) {
      return [CACHE_KEY_NAMESPACE, CACHE_KEY_VERSION, projectDir, null, null, null];
    }
    if (
      !isValidIdentitySegment(projectSlug) ||
      !isValidIdentitySegment(projectId) ||
      !isValidIdentitySegment(versionId)
    ) {
      return null;
    }
    return [
      CACHE_KEY_NAMESPACE,
      CACHE_KEY_VERSION,
      projectDir,
      projectSlug,
      projectId,
      versionId,
    ];
  } catch {
    return null;
  }
}

/** Build a collision-free cache key, or return null when the source is mutable or unscoped. */
export function getPagesApiHandlerCacheKey(ctx: HandlerContext): string | null {
  if (!ctx.projectSlug) {
    return encodeCacheIdentity([
      CACHE_KEY_NAMESPACE,
      CACHE_KEY_VERSION,
      ctx.projectDir,
      null,
      null,
      null,
    ]);
  }

  const cacheContext = tryGetCacheKeyContext() ?? extractCacheKeyContext(ctx);
  if (!cacheContext || cacheContext.mode !== "production") return null;
  const expectedProjectId = ctx.projectId ?? ctx.projectSlug;
  if (cacheContext.projectId !== expectedProjectId) return null;
  if (ctx.releaseId && cacheContext.versionId !== ctx.releaseId) return null;

  return encodeCacheIdentity([
    CACHE_KEY_NAMESPACE,
    CACHE_KEY_VERSION,
    ctx.projectDir,
    ctx.projectSlug,
    cacheContext.projectId,
    cacheContext.versionId,
  ]);
}

/** Cache and lifecycle owner for initialized Pages API route handlers. */
export class PagesApiHandlerCache {
  readonly #defaultCache: HandlerCache<Promise<APIRouteHandler>>;
  readonly #handlerLeaseStates = new WeakMap<Promise<APIRouteHandler>, HandlerLeaseState>();
  #injectedCache: HandlerCache<Promise<APIRouteHandler>> | null = null;

  constructor(readonly createHandler: (ctx: HandlerContext) => Promise<APIRouteHandler>) {
    this.#defaultCache = new LRUHandlerCache({
      onEvict: (promise) => void this.#destroyHandler(promise),
    });
  }

  inject(cache: HandlerCache<Promise<APIRouteHandler>> | null): void {
    this.#injectedCache = cache;
  }

  async get(ctx: HandlerContext): Promise<APIRouteHandler> {
    return await this.#getHandlerPromise(ctx).promise;
  }

  async withHandler<T>(
    ctx: HandlerContext,
    use: (handler: APIRouteHandler) => T | Promise<T>,
  ): Promise<T> {
    const { promise, cached } = this.#getHandlerPromise(ctx);
    const release = this.#retainHandler(promise);

    try {
      return await use(await promise);
    } finally {
      if (!cached) await this.#destroyHandler(promise);
      await release();
    }
  }

  async resetByProjectDir(projectDir?: string): Promise<void> {
    const cache = this.#cache;
    if (!projectDir) {
      const handlers = Array.from(cache.values());
      cache.clear();
      await Promise.all(handlers.map((handler) => this.#destroyHandler(handler)));
      return;
    }

    const handlers: Promise<APIRouteHandler>[] = [];
    for (const [key, promise] of cache.entries()) {
      if (decodeCacheIdentity(key)?.[2] !== projectDir) continue;
      cache.delete(key);
      handlers.push(promise);
    }
    await Promise.all(handlers.map((handler) => this.#destroyHandler(handler)));
  }

  async resetByProjectSlug(projectSlug: string): Promise<void> {
    const cache = this.#cache;
    const handlers: Promise<APIRouteHandler>[] = [];
    for (const [key, promise] of cache.entries()) {
      if (decodeCacheIdentity(key)?.[3] !== projectSlug) continue;
      cache.delete(key);
      handlers.push(promise);
    }
    await Promise.all(handlers.map((handler) => this.#destroyHandler(handler)));
  }

  get #cache(): HandlerCache<Promise<APIRouteHandler>> {
    return this.#injectedCache ?? this.#defaultCache;
  }

  #getHandlerPromise(
    ctx: HandlerContext,
  ): { promise: Promise<APIRouteHandler>; cached: boolean } {
    const key = getPagesApiHandlerCacheKey(ctx);
    if (!key) return { promise: this.createHandler(ctx), cached: false };

    const cache = this.#cache;
    let promise = cache.get(key);
    if (promise) return { promise, cached: true };

    promise = this.createHandler(ctx);
    try {
      cache.set(key, promise);
    } catch (error) {
      void this.#destroyHandler(promise);
      throw error;
    }

    const pending = promise;
    void pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return { promise, cached: true };
  }

  #getLeaseState(promise: Promise<APIRouteHandler>): HandlerLeaseState {
    let state = this.#handlerLeaseStates.get(promise);
    if (!state) {
      state = { active: 0, destroyRequested: false };
      this.#handlerLeaseStates.set(promise, state);
    }
    return state;
  }

  #destroyHandlerNow(
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
          logger.debug("Failed to destroy handler", { errorName: getSafeErrorName(error) });
        } catch {
          // Logging may be unavailable during process shutdown.
        }
      }
    })();
    return state.destroyPromise;
  }

  async #destroyHandler(promise?: Promise<APIRouteHandler>): Promise<void> {
    if (!promise) return;
    const state = this.#getLeaseState(promise);
    state.destroyRequested = true;
    if (state.active === 0) await this.#destroyHandlerNow(promise, state);
  }

  #retainHandler(promise: Promise<APIRouteHandler>): () => Promise<void> {
    const state = this.#getLeaseState(promise);
    state.active++;
    let released = false;

    return async () => {
      if (released) return;
      released = true;
      state.active--;
      if (state.active === 0 && state.destroyRequested) {
        await this.#destroyHandlerNow(promise, state);
      }
    };
  }
}
