/**************************
 * Pod-Level Module Cache Singleton
 **************************/

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import {
  ESM_CACHE_MAX_ENTRIES,
  ESM_CACHE_TTL_MS,
  MODULE_CACHE_MAX_ENTRIES,
  MODULE_CACHE_TTL_MS,
} from "#veryfront/utils/constants/cache.ts";
import { registerLRUCache } from "./registry.ts";

let moduleCache: LRUCache<string, string> | null = null;
let esmCache: LRUCache<string, string> | null = null;

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

export function getModuleCache(): LRUCache<string, string> {
  if (moduleCache) return moduleCache;

  moduleCache = new LRUCache<string, string>({
    maxEntries: MODULE_CACHE_MAX_ENTRIES,
    ttlMs: MODULE_CACHE_TTL_MS,
  });

  registerLRUCache("pod-module-cache", moduleCache);

  logger.info("[ModuleCache] Pod-level module cache initialized", {
    maxEntries: MODULE_CACHE_MAX_ENTRIES,
    ttlMs: MODULE_CACHE_TTL_MS,
  });

  return moduleCache;
}

export function getEsmCache(): LRUCache<string, string> {
  if (esmCache) return esmCache;

  esmCache = new LRUCache<string, string>({
    maxEntries: ESM_CACHE_MAX_ENTRIES,
    ttlMs: ESM_CACHE_TTL_MS,
  });

  registerLRUCache("pod-esm-cache", esmCache);

  logger.info("[ModuleCache] Pod-level ESM cache initialized", {
    maxEntries: ESM_CACHE_MAX_ENTRIES,
    ttlMs: ESM_CACHE_TTL_MS,
  });

  return esmCache;
}

export function createModuleCache(): Map<string, string> {
  return createMapInterface(getModuleCache());
}

export function createEsmCache(): Map<string, string> {
  return createMapInterface(getEsmCache());
}

function createMapInterface(cache: LRUCache<string, string>): Map<string, string> {
  const map: Map<string, string> = {
    get(key: string): string | undefined {
      return cache.get(key);
    },
    set(key: string, value: string): Map<string, string> {
      cache.set(key, value);
      return map;
    },
    has(key: string): boolean {
      return cache.has(key);
    },
    delete(key: string): boolean {
      return cache.delete(key);
    },
    clear(): void {
      cache.clear();
    },
    get size(): number {
      return cache.size;
    },
    keys(): MapIterator<string> {
      return cache.keys() as unknown as MapIterator<string>;
    },
    values(): MapIterator<string> {
      const keysIter = cache.keys();
      const cacheRef = cache;
      return (function* () {
        for (const key of keysIter) {
          const value = cacheRef.get(key);
          if (value !== undefined) yield value;
        }
      })() as unknown as MapIterator<string>;
    },
    entries(): MapIterator<[string, string]> {
      const keysIter = cache.keys();
      const cacheRef = cache;
      return (function* () {
        for (const key of keysIter) {
          const value = cacheRef.get(key);
          if (value !== undefined) yield [key, value] as [string, string];
        }
      })() as unknown as MapIterator<[string, string]>;
    },
    forEach(callback: (value: string, key: string, map: Map<string, string>) => void): void {
      for (const key of cache.keys()) {
        const value = cache.get(key);
        if (value !== undefined) callback(value, key, map);
      }
    },
    [Symbol.iterator](): MapIterator<[string, string]> {
      return map.entries();
    },
    [Symbol.toStringTag]: "Map",
  };

  return map;
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
  logger.info("[ModuleCache] All module caches cleared");
}

export function clearModuleCacheForProject(projectId: string): number {
  if (!moduleCache) return 0;

  let cleared = 0;

  for (const key of moduleCache.keys()) {
    if (!key.startsWith(`${projectId}:`)) continue;
    moduleCache.delete(key);
    cleared++;
  }

  if (cleared > 0) {
    logger.info("[ModuleCache] Cleared module cache for project", { projectId, cleared });
  }

  return cleared;
}

export function destroyModuleCaches(): void {
  moduleCache?.destroy();
  esmCache?.destroy();
  moduleCache = null;
  esmCache = null;
  logger.info("[ModuleCache] Module caches destroyed");
}
