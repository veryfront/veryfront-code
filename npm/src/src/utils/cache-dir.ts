import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "../platform/compat/path/index.js";
import { cwd } from "../platform/compat/process.js";
import { getCacheDirEnv } from "../config/env.js";

const cacheStorage = new AsyncLocalStorage<string>();

export function runWithCacheDir<T>(cacheDir: string, fn: () => T): T {
  return cacheStorage.run(cacheDir, fn);
}

export function getCacheDirFromContext(): string | undefined {
  return cacheStorage.getStore();
}

export function getCacheBaseDir(): string {
  const contextCacheDir = getCacheDirFromContext();
  if (contextCacheDir) return contextCacheDir;

  const envCacheDir = getCacheDirEnv();
  if (envCacheDir) return envCacheDir;

  return join(cwd(), ".cache");
}

export function getMdxEsmCacheDir(): string {
  return join(getCacheBaseDir(), "veryfront-mdx-esm");
}

export function getHttpBundleCacheDir(): string {
  return join(getCacheBaseDir(), "veryfront-http-bundle");
}
