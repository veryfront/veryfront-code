import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "#veryfront/compat/path/index.ts";
import { cwd, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger } from "./logger/index.ts";

const logger = serverLogger.component("cache-dir");

const cacheStorage = new AsyncLocalStorage<string>();
const nodeModulesLinkOperations = new Map<string, Promise<boolean>>();

// Bounded memo of cache roots whose node_modules link has been verified, so
// post-settle callers pay an O(1) lookup instead of repeated sync syscalls
// (require.resolve + lstat + realpath) on every render. Bounded so many
// distinct tenant cache dirs cannot pin process memory forever.
const MAX_SETTLED_CACHE_ROOTS = 128;
const verifiedCacheRoots = new Set<string>();
// Roots whose link creation failed, kept only to log the failure once.
const warnedLinkFailureRoots = new Set<string>();

function rememberBounded(set: Set<string>, value: string): void {
  if (set.size >= MAX_SETTLED_CACHE_ROOTS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(value);
}

function getReactNodeModulesDir(reactEntry: string): string | undefined {
  const normalizedReactEntry = reactEntry.replaceAll("\\", "/");
  const marker = "/node_modules/react";
  const markerIndex = normalizedReactEntry.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  return reactEntry.slice(0, markerIndex + "/node_modules".length);
}

/** Reset memoized link state (test seam). */
function resetNodeModulesLinkState(): void {
  nodeModulesLinkOperations.clear();
  verifiedCacheRoots.clear();
  warnedLinkFailureRoots.clear();
}

/** Internal test seam for platform-specific resolved module paths. */
export const __cacheDirInternals = { getReactNodeModulesDir, resetNodeModulesLinkState };

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
 *
 * Returns `true` when a usable framework dependency root is in place for the
 * cache dir (link created, correct link already present, or an equivalent
 * real directory), and `false` when it could not be ensured — so callers can
 * distinguish total link failure from success. Failures are logged once per
 * cache dir and are retried on later calls (self-healing); only verified
 * roots are memoized.
 */
export async function ensureCacheNodeModules(): Promise<boolean> {
  if (!isNode) return true;

  // Key the memoized link operation by the resolved cache base dir:
  // getCacheBaseDir() is AsyncLocalStorage-scoped, so different requests can
  // resolve different cache dirs. A single global done-flag would let the
  // first cache dir claim the link forever and leave every other cache dir
  // without a node_modules symlink (second React copy → "Invalid hook call").
  // Storing the in-flight promise also makes concurrent callers wait for the
  // link to actually exist instead of returning before the async work is done.
  const cacheBase = getCacheBaseDir();
  if (verifiedCacheRoots.has(cacheBase)) return true;

  let operation = nodeModulesLinkOperations.get(cacheBase);
  if (!operation) {
    operation = linkCacheNodeModules(cacheBase);
    nodeModulesLinkOperations.set(cacheBase, operation);
  }
  try {
    const linked = await operation;
    if (linked) rememberBounded(verifiedCacheRoots, cacheBase);
    return linked;
  } finally {
    // The in-flight map deduplicates only concurrent work; settled successes
    // live in the bounded verified-roots memo and settled failures are
    // retried. The identity check prevents an older waiter from deleting a
    // replacement operation.
    if (nodeModulesLinkOperations.get(cacheBase) === operation) {
      nodeModulesLinkOperations.delete(cacheBase);
    }
  }
}

async function linkCacheNodeModules(cacheBase: string): Promise<boolean> {
  try {
    const { createRequire } = await import("node:module");
    const { lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } = await import("node:fs");

    const targetLink = join(cacheBase, "node_modules");

    const require = createRequire(import.meta.url);
    const reactEntry = require.resolve("react");
    const nodeModulesDir = getReactNodeModulesDir(reactEntry);
    if (!nodeModulesDir) return warnLinkFailure(cacheBase, "framework node_modules not found");

    try {
      const existing = lstatSync(targetLink);
      if (existing.isSymbolicLink()) {
        try {
          if (realpathSync(targetLink) === realpathSync(nodeModulesDir)) return true;
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
          ) return true;
        } catch {
          // The existing directory is not a usable framework dependency root.
        }
        return warnLinkFailure(cacheBase, "existing node_modules directory preserved");
      } else {
        // Do not overwrite a non-directory entry in a best-effort helper.
        return warnLinkFailure(cacheBase, "existing non-directory node_modules entry preserved");
      }
    } catch (_) {
      // No entry exists yet. mkdir/symlink below owns creation.
    }

    mkdirSync(cacheBase, { recursive: true });
    symlinkSync(nodeModulesDir, targetLink, "dir");
    return true;
  } catch (error) {
    // Best-effort: symlink creation may fail due to permissions or platform,
    // but total failure must stay observable instead of looking like success.
    return warnLinkFailure(
      cacheBase,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function warnLinkFailure(cacheBase: string, reason: string): false {
  if (!warnedLinkFailureRoots.has(cacheBase)) {
    rememberBounded(warnedLinkFailureRoots, cacheBase);
    logger.warn("Cache node_modules link not established", { cacheBase, reason });
  }
  return false;
}
