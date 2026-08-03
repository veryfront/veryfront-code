import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "#veryfront/compat/path/index.ts";
import { cwd, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";

const cacheStorage = new AsyncLocalStorage<string>();
const nodeModulesLinkOperations = new Map<string, Promise<void>>();

export function runWithCacheDir<T>(cacheDir: string, fn: () => T): T {
  return cacheStorage.run(cacheDir, fn);
}

export function getCacheDirFromContext(): string | undefined {
  return cacheStorage.getStore();
}

function getDefaultCacheBaseDir(): string {
  const home = getHostEnv("HOME");
  const isProduction = getHostEnv("NODE_ENV") === "production" ||
    getHostEnv("VERYFRONT_MODE") === "production";

  if (home && isProduction) {
    return join(home, ".cache", "veryfront");
  }

  return join(cwd(), ".cache");
}

export function getCacheBaseDir(): string {
  return (
    getCacheDirFromContext() ??
      getHostEnv("VERYFRONT_CACHE_DIR") ?? getHostEnv("VF_CACHE_DIR") ??
      getDefaultCacheBaseDir()
  );
}

export function getMdxEsmCacheDir(): string {
  return join(getCacheBaseDir(), "veryfront-mdx-esm");
}

export function getHttpBundleCacheDir(): string {
  return join(getCacheBaseDir(), "veryfront-http-bundle");
}

/**
 * Ensure cached ESM modules can resolve bare specifiers (e.g. `import 'react'`)
 * when running on Node.js.
 *
 * Cached .mjs files live under getCacheBaseDir(). Node.js
 * resolves bare specifiers by walking up from the importing file looking for
 * node_modules/. Because the cache directory has no node_modules ancestor,
 * packages like `react` cannot be found.
 *
 * This function creates a symlink:
 *   {cacheBaseDir}/node_modules → {framework's node_modules}
 *
 * so Node.js module resolution finds the same packages the framework itself uses,
 * guaranteeing a single React instance (no "Invalid hook call" errors).
 */
export async function ensureCacheNodeModules(): Promise<void> {
  if (!isNode) return;

  // Key the memoized link operation by the resolved cache base dir:
  // getCacheBaseDir() is AsyncLocalStorage-scoped, so different requests can
  // resolve different cache dirs. A single global done-flag would let the
  // first cache dir claim the link forever and leave every other cache dir
  // without a node_modules symlink (second React copy → "Invalid hook call").
  // Storing the in-flight promise also makes concurrent callers wait for the
  // link to actually exist instead of returning before the async work is done.
  const cacheBase = getCacheBaseDir();
  let operation = nodeModulesLinkOperations.get(cacheBase);
  if (!operation) {
    operation = linkCacheNodeModules(cacheBase);
    nodeModulesLinkOperations.set(cacheBase, operation);
  }
  await operation;
}

async function linkCacheNodeModules(cacheBase: string): Promise<void> {
  try {
    const { createRequire } = await import("node:module");
    const { lstatSync, symlinkSync, mkdirSync } = await import("node:fs");

    const targetLink = join(cacheBase, "node_modules");

    try {
      lstatSync(targetLink);
      return;
    } catch (_) {
      /* expected: symlink doesn't exist yet */
    }

    const require = createRequire(import.meta.url);
    const reactEntry = require.resolve("react");

    const marker = "/node_modules/react";
    const idx = reactEntry.lastIndexOf(marker);
    if (idx === -1) return;

    const nodeModulesDir = reactEntry.substring(0, idx + "/node_modules".length);

    mkdirSync(cacheBase, { recursive: true });
    symlinkSync(nodeModulesDir, targetLink, "dir");
  } catch (_) {
    /* expected: best-effort symlink may fail due to permissions or platform */
  }
}
