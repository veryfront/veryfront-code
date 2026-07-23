import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ImportMapConfig } from "./types.ts";
import { loadImportMap } from "./loader.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const IMPORT_MAP_CACHE_MAX_ENTRIES = 500;
const MAX_CACHE_KEY_LENGTH = 4_096;
const importMapCache = new LRUCache<string, Promise<ImportMapConfig>>({
  maxEntries: IMPORT_MAP_CACHE_MAX_ENTRIES,
});

function validateCacheKey(value: string): string {
  if (
    value.length === 0 || value.length > MAX_CACHE_KEY_LENGTH ||
    hasUnsafeControlCharacters(value)
  ) {
    throw new RangeError("Import-map cache key is invalid");
  }
  return value;
}

function cloneImportMap(importMap: ImportMapConfig): ImportMapConfig {
  return {
    imports: importMap.imports ? { ...importMap.imports } : undefined,
    scopes: importMap.scopes
      ? Object.fromEntries(
        Object.entries(importMap.scopes).map(([scope, mappings]) => [
          scope,
          { ...mappings },
        ]),
      )
      : undefined,
  };
}

function snapshotImportMap(importMap: ImportMapConfig): ImportMapConfig {
  const snapshot = cloneImportMap(importMap);
  if (snapshot.imports) Object.freeze(snapshot.imports);
  if (snapshot.scopes) {
    for (const mappings of Object.values(snapshot.scopes)) Object.freeze(mappings);
    Object.freeze(snapshot.scopes);
  }
  return Object.freeze(snapshot);
}

export function preloadImportMap(
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId?: string,
): Promise<ImportMapConfig> {
  const cacheKey = validateCacheKey(projectId ?? projectDir);
  if (isVirtualFilesystem(adapter.fs)) {
    return loadImportMap(projectDir, adapter).then(cloneImportMap);
  }
  const cached = importMapCache.get(cacheKey);
  if (cached) return cached.then(cloneImportMap);

  const promise = loadImportMap(projectDir, adapter).then(snapshotImportMap);
  importMapCache.set(cacheKey, promise);

  promise.catch(() => {
    if (importMapCache.get(cacheKey) === promise) importMapCache.delete(cacheKey);
  });

  return promise.then(cloneImportMap);
}

export async function getCachedImportMap(
  cacheKey: string,
): Promise<ImportMapConfig | undefined> {
  validateCacheKey(cacheKey);
  const cached = importMapCache.get(cacheKey);
  if (!cached) return undefined;

  try {
    return cloneImportMap(await cached);
  } catch (_) {
    /* expected: cached import map promise may have been rejected */
    return undefined;
  }
}

export function clearImportMapCache(cacheKey?: string): void {
  if (cacheKey !== undefined) {
    importMapCache.delete(validateCacheKey(cacheKey));
    return;
  }

  importMapCache.clear();
}
