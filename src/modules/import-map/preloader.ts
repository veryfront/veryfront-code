import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ImportMapConfig } from "./types.ts";
import { loadImportMap } from "./loader.ts";

const importMapCache = new Map<string, Promise<ImportMapConfig>>();

export function preloadImportMap(
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId?: string,
): Promise<ImportMapConfig> {
  const cacheKey = projectId ?? projectDir;
  const cached = importMapCache.get(cacheKey);
  if (cached) return cached;

  const promise = loadImportMap(projectDir, adapter);
  importMapCache.set(cacheKey, promise);

  promise.catch(() => {
    importMapCache.delete(cacheKey);
  });

  return promise;
}

export async function getCachedImportMap(
  cacheKey: string,
): Promise<ImportMapConfig | undefined> {
  const cached = importMapCache.get(cacheKey);
  if (!cached) return undefined;

  try {
    return await cached;
  } catch (_) {
    /* expected: cached import map promise may have been rejected */
    return undefined;
  }
}

export function clearImportMapCache(cacheKey?: string): void {
  if (cacheKey) {
    importMapCache.delete(cacheKey);
    return;
  }

  importMapCache.clear();
}
