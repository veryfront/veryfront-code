import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ImportMapConfig } from "./types.ts";
import { loadImportMap } from "./loader.ts";

const importMapCache = new Map<string, Promise<ImportMapConfig>>();

export function preloadImportMap(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ImportMapConfig> {
  const cached = importMapCache.get(projectDir);
  if (cached) return cached;

  const promise = loadImportMap(projectDir, adapter);
  importMapCache.set(projectDir, promise);

  promise.catch(() => {
    importMapCache.delete(projectDir);
  });

  return promise;
}

export async function getCachedImportMap(
  projectDir: string,
): Promise<ImportMapConfig | undefined> {
  const cached = importMapCache.get(projectDir);
  if (!cached) return undefined;

  try {
    return await cached;
  } catch {
    return undefined;
  }
}

export function clearImportMapCache(projectDir?: string): void {
  if (projectDir) {
    importMapCache.delete(projectDir);
    return;
  }

  importMapCache.clear();
}
