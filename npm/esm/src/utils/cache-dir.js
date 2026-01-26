import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "../platform/compat/path/index.js";
import { cwd } from "../platform/compat/process.js";
import { getCacheDirEnv } from "../config/env.js";
const cacheStorage = new AsyncLocalStorage();
export function runWithCacheDir(cacheDir, fn) {
    return cacheStorage.run(cacheDir, fn);
}
export function getCacheDirFromContext() {
    return cacheStorage.getStore();
}
export function getCacheBaseDir() {
    const contextCacheDir = getCacheDirFromContext();
    if (contextCacheDir)
        return contextCacheDir;
    const envCacheDir = getCacheDirEnv();
    if (envCacheDir)
        return envCacheDir;
    return join(cwd(), ".cache");
}
export function getMdxEsmCacheDir() {
    return join(getCacheBaseDir(), "veryfront-mdx-esm");
}
export function getHttpBundleCacheDir() {
    return join(getCacheBaseDir(), "veryfront-http-bundle");
}
