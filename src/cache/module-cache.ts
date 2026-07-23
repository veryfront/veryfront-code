/**************************
 * Pod-Level Module Cache Singleton
 **************************/

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { rendererLogger } from "#veryfront/utils";
import {
  ESM_CACHE_MAX_ENTRIES,
  ESM_CACHE_TTL_MS,
  MODULE_CACHE_MAX_ENTRIES,
  MODULE_CACHE_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";
import { cacheRegistry, LRUCacheStore } from "./registry.ts";

const logger = rendererLogger.component("module-cache");

let moduleCache: LRUCache<string, string> | null = null;
let esmCache: LRUCache<string, string> | null = null;
let unregisterModuleCache: (() => boolean) | null = null;
let unregisterEsmCache: (() => boolean) | null = null;

export interface ModuleCacheMap extends Map<string, string> {
  getOrInsert(key: string, value: string): string;
  getOrInsertComputed(key: string, callback: (key: string) => string): string;
}

interface ModuleCacheStats {
  moduleCache: {
    size: number;
    maxEntries: number;
    ttlMs: number;
  };
  esmCache: {
    size: number;
    maxEntries: number;
    ttlMs: number;
  };
}

interface PodCacheOptions {
  getExisting: () => LRUCache<string, string> | null;
  assign: (cache: LRUCache<string, string>) => void;
  assignRegistration: (unregister: () => boolean) => void;
  maxEntries: number;
  ttlMs: number;
  registryName: string;
  logMessage: string;
}

function getOrInitPodCache(options: PodCacheOptions): LRUCache<string, string> {
  const existing = options.getExisting();
  if (existing) return existing;

  const cache = new LRUCache<string, string>({
    maxEntries: options.maxEntries,
    ttlMs: options.ttlMs,
  });

  options.assign(cache);
  options.assignRegistration(
    cacheRegistry.register(new LRUCacheStore(options.registryName, cache)),
  );

  logger.info(options.logMessage, {
    maxEntries: options.maxEntries,
    ttlMs: options.ttlMs,
  });

  return cache;
}

const modulePodCacheOptions: PodCacheOptions = {
  getExisting: () => moduleCache,
  assign: (cache) => {
    moduleCache = cache;
  },
  assignRegistration: (unregister) => {
    unregisterModuleCache = unregister;
  },
  maxEntries: MODULE_CACHE_MAX_ENTRIES,
  ttlMs: MODULE_CACHE_TTL_MS,
  registryName: "pod-module-cache",
  logMessage: "[ModuleCache] Pod-level module cache initialized",
};

const esmPodCacheOptions: PodCacheOptions = {
  getExisting: () => esmCache,
  assign: (cache) => {
    esmCache = cache;
  },
  assignRegistration: (unregister) => {
    unregisterEsmCache = unregister;
  },
  maxEntries: ESM_CACHE_MAX_ENTRIES,
  ttlMs: ESM_CACHE_TTL_MS,
  registryName: "pod-esm-cache",
  logMessage: "[ModuleCache] Pod-level ESM cache initialized",
};

export function getModuleCache(): LRUCache<string, string> {
  return getOrInitPodCache(modulePodCacheOptions);
}

export function getEsmCache(): LRUCache<string, string> {
  return getOrInitPodCache(esmPodCacheOptions);
}

export function createModuleCache(): ModuleCacheMap {
  return createMapInterface(getModuleCache());
}

export function createEsmCache(): ModuleCacheMap {
  return createMapInterface(getEsmCache());
}

function createMapInterface(cache: LRUCache<string, string>): ModuleCacheMap {
  return new LRUBackedMap(cache);
}

function toMapIterator<T>(source: IterableIterator<T>): MapIterator<T> {
  if (typeof Iterator !== "undefined") {
    return Iterator.from(source);
  }

  const snapshot = new Map<number, T>();
  for (const value of source) {
    snapshot.set(snapshot.size, value);
  }
  return snapshot.values();
}

class LRUBackedMap implements ModuleCacheMap {
  readonly [Symbol.toStringTag] = "Map";

  constructor(private readonly cache: LRUCache<string, string>) {
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: string): this {
    this.cache.set(key, value);
    return this;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getOrInsert(key: string, value: string): string {
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing;

    this.cache.set(key, value);
    return value;
  }

  getOrInsertComputed(key: string, callback: (key: string) => string): string {
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing;

    const value = callback(key);
    this.cache.set(key, value);
    return value;
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): MapIterator<string> {
    return toMapIterator(this.cache.keys());
  }

  values(): MapIterator<string> {
    const keysIter = this.cache.keys();
    const cacheRef = this.cache;
    return toMapIterator((function* () {
      for (const key of keysIter) {
        const value = cacheRef.get(key);
        if (value !== undefined) yield value;
      }
    })());
  }

  entries(): MapIterator<[string, string]> {
    const keysIter = this.cache.keys();
    const cacheRef = this.cache;
    return toMapIterator((function* () {
      for (const key of keysIter) {
        const value = cacheRef.get(key);
        if (value !== undefined) yield [key, value] as [string, string];
      }
    })());
  }

  forEach(
    callback: (value: string, key: string, map: Map<string, string>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  [Symbol.iterator](): MapIterator<[string, string]> {
    return this.entries();
  }
}

export function getModuleCacheStats(): ModuleCacheStats {
  return {
    moduleCache: {
      size: moduleCache?.size ?? 0,
      maxEntries: MODULE_CACHE_MAX_ENTRIES,
      ttlMs: MODULE_CACHE_TTL_MS,
    },
    esmCache: {
      size: esmCache?.size ?? 0,
      maxEntries: ESM_CACHE_MAX_ENTRIES,
      ttlMs: ESM_CACHE_TTL_MS,
    },
  };
}

export function clearModuleCaches(): void {
  moduleCache?.clear();
  esmCache?.clear();
  logger.info("All module caches cleared");
}

function belongsToProject(cacheKey: string, projectId: string): boolean {
  if (cacheKey.startsWith(`${projectId}:`)) return true;
  if (!cacheKey.startsWith("[")) return false;

  try {
    const segments: unknown = JSON.parse(cacheKey);
    return Array.isArray(segments) && segments[0] === projectId;
  } catch {
    return false;
  }
}

export function clearModuleCacheForProject(projectId: string): number {
  if (!moduleCache) return 0;

  let cleared = 0;

  for (const key of moduleCache.keys()) {
    if (!belongsToProject(key, projectId)) continue;
    moduleCache.delete(key);
    cleared++;
  }

  if (cleared > 0) {
    logger.info("Cleared module cache for project", { projectId, cleared });
  }

  return cleared;
}

export function destroyModuleCaches(): void {
  unregisterModuleCache?.();
  unregisterEsmCache?.();
  moduleCache?.destroy();
  esmCache?.destroy();
  moduleCache = null;
  esmCache = null;
  unregisterModuleCache = null;
  unregisterEsmCache = null;
  logger.info("Module caches destroyed");
}
