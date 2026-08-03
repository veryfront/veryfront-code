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
  try {
    await operation;
  } finally {
    // The map deduplicates only concurrent work. Retaining every resolved
    // tenant cache path forever would turn this helper into an unbounded
    // process-lifetime index. The identity check prevents an older waiter from
    // deleting a replacement operation.
    if (nodeModulesLinkOperations.get(cacheBase) === operation) {
      nodeModulesLinkOperations.delete(cacheBase);
    }
  }
}

async function linkCacheNodeModules(cacheBase: string): Promise<void> {
  try {
    const { createRequire } = await import("node:module");
    const { lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } = await import("node:fs");

    const targetLink = join(cacheBase, "node_modules");

    const require = createRequire(import.meta.url);
    const reactEntry = require.resolve("react");

    const marker = "/node_modules/react";
    const idx = reactEntry.lastIndexOf(marker);
    if (idx === -1) return;

    const nodeModulesDir = reactEntry.substring(0, idx + "/node_modules".length);

    try {
      const existing = lstatSync(targetLink);
      if (existing.isSymbolicLink()) {
        try {
          if (realpathSync(targetLink) === realpathSync(nodeModulesDir)) return;
        } catch {
          // A dangling link is safe to replace without touching its target.
        }
        unlinkSync(targetLink);
      } else if (existing.isDirectory()) {
        // Preserve a real directory only when it resolves React to the same
        // framework-owned package. Never remove user-created directories.
        try {
          if (
            realpathSync(join(targetLink, "react")) ===
              realpathSync(join(nodeModulesDir, "react"))
          ) return;
        } catch {
          // The existing directory is not a usable framework dependency root.
        }
        return;
      } else {
        // Do not overwrite a non-directory entry in a best-effort helper.
        return;
      }
    } catch (_) {
      // No entry exists yet. mkdir/symlink below owns creation.
    }

    mkdirSync(cacheBase, { recursive: true });
    symlinkSync(nodeModulesDir, targetLink, "dir");
  } catch (_) {
    /* expected: best-effort symlink may fail due to permissions or platform */
  }
}
