import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "#veryfront/compat/path/index.ts";
import { cwd, getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  createFileSystem,
  type FileSystem,
  isAlreadyExistsError,
} from "#veryfront/platform/compat/fs.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { serverLogger } from "./logger/index.ts";

const logger = serverLogger.component("cache-dir");

const cacheStorage = new AsyncLocalStorage<string>();
let testHttpBundleCacheDir: string | undefined;
const nodeModulesLinkOperations = new Map<string, Promise<string | undefined>>();

// Bounded memo of cache roots and their expected framework dependency root.
// A cache hit still validates the target entry: cache directories can be
// cleared or replaced by another process, so remembered success must never
// turn a missing or wrong link into a false-positive `true` result.
const MAX_SETTLED_CACHE_ROOTS = 128;
const verifiedCacheRoots = new Map<string, string>();
// Roots whose link creation failed, kept only to log the failure once.
const warnedLinkFailureRoots = new Set<string>();

function rememberBounded(set: Set<string>, value: string): void {
  if (set.size >= MAX_SETTLED_CACHE_ROOTS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(value);
}

function rememberVerifiedRoot(cacheBase: string, nodeModulesDir: string): void {
  if (!verifiedCacheRoots.has(cacheBase) && verifiedCacheRoots.size >= MAX_SETTLED_CACHE_ROOTS) {
    const oldest = verifiedCacheRoots.keys().next().value;
    if (oldest !== undefined) verifiedCacheRoots.delete(oldest);
  }
  verifiedCacheRoots.set(cacheBase, nodeModulesDir);
}

function getReactNodeModulesDir(reactEntry: string): string | undefined {
  const normalizedReactEntry = reactEntry.replaceAll("\\", "/");
  const marker = "/node_modules/react";
  const markerIndex = normalizedReactEntry.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  return reactEntry.slice(0, markerIndex + "/node_modules".length);
}

function describeCacheRoot(cacheBase: string): string {
  return `cache:${hashString(cacheBase)}`;
}

function redactCachePathDetails(reason: string, cacheBase: string): string {
  return reason
    .replace(/(["'`])(?:(?:[A-Za-z]:)?[\\/])[^"'`]*\1/g, "$1[path]$1")
    .replaceAll(cacheBase, "[cache-dir]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"`]+/g, "[path]");
}

/** Reset memoized link state (test seam). */
function resetNodeModulesLinkState(): void {
  nodeModulesLinkOperations.clear();
  verifiedCacheRoots.clear();
  warnedLinkFailureRoots.clear();
}

/** Internal test seam for platform-specific resolved module paths. */
export const __cacheDirInternals = {
  createIgnoreMarker,
  describeCacheRoot,
  getReactNodeModulesDir,
  redactCachePathDetails,
  resetNodeModulesLinkState,
};

export function runWithCacheDir<T>(cacheDir: string, fn: () => T): T {
  return cacheStorage.run(cacheDir, fn);
}

export function getCacheDirFromContext(): string | undefined {
  return cacheStorage.getStore();
}

/**
 * The framework cache root for a project directory.
 *
 * Outside production every generated bundle, compiled module, and cache entry
 * lives here, so `veryfront dev` and `veryfront clean --cache` must agree on
 * one location for a given project.
 */
export function getProjectCacheDir(projectDir: string): string {
  return join(projectDir, ".cache");
}

function getDefaultCacheBaseDir(): string {
  const home = getHostEnv("HOME");
  const isProduction = getHostEnv("NODE_ENV") === "production" ||
    getHostEnv("VERYFRONT_MODE") === "production";

  if (home && isProduction) {
    return join(home, ".cache", "veryfront");
  }

  return getProjectCacheDir(cwd());
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
  const contextCacheDir = getCacheDirFromContext();
  return contextCacheDir === undefined
    ? testHttpBundleCacheDir ?? join(getCacheBaseDir(), "veryfront-http-bundle")
    : join(contextCacheDir, "veryfront-http-bundle");
}

/** Override only the HTTP bundle cache in a DENO_TESTING process. */
export function __setHttpBundleCacheDirForTests(path: string | undefined): void {
  if (getHostEnv("DENO_TESTING") !== "1") {
    throw new Error("The HTTP bundle cache test override requires DENO_TESTING=1");
  }
  testHttpBundleCacheDir = path;
}

const CACHE_DIR_IGNORE_CONTENT = [
  "# Created by Veryfront. Holds generated bundles only, safe to delete.",
  "*",
  "",
].join("\n");

/**
 * Write the ignore marker without clobbering a file that already exists.
 *
 * Adapters that expose an exclusive create use it, so a `.gitignore` another
 * process writes between the caller's `exists()` check and this write survives.
 * Adapters without that capability fall back to a plain write.
 */
async function createIgnoreMarker(
  fs: FileSystem,
  ignorePath: string,
): Promise<void> {
  const createExclusive = fs.createFileBytesExclusive?.bind(fs);
  if (createExclusive === undefined) {
    await fs.writeTextFile(ignorePath, CACHE_DIR_IGNORE_CONTENT);
    return;
  }

  try {
    // Exclusive create so a `.gitignore` that appears between the exists()
    // check and this write is left intact rather than truncated.
    await createExclusive(
      ignorePath,
      new TextEncoder().encode(CACHE_DIR_IGNORE_CONTENT),
    );
  } catch (error) {
    if (isAlreadyExistsError(error)) return;
    throw error;
  }
}

/**
 * Mark the cache base directory as ignored by version control.
 *
 * Outside production the cache root is `<project>/.cache`, so every dev server
 * run drops generated `.mjs` bundles into the user's project. `veryfront init`
 * scaffolds a `.gitignore` with a `.cache/` entry, but a project that adopted
 * Veryfront into an existing tree keeps its own `.gitignore` and never gets
 * one, so the bundles show up as untracked files and `git add -A` commits
 * them. A `.gitignore` written *inside* the cache root ignores its contents
 * (and itself) no matter what the project's own `.gitignore` says.
 *
 * Best-effort: an unwritable cache root must not fail server startup, and an
 * existing `.gitignore` is never overwritten.
 */
export async function ensureCacheDirIgnored(): Promise<void> {
  const cacheBase = getCacheBaseDir();

  try {
    const fs = createFileSystem();
    const ignorePath = join(cacheBase, ".gitignore");
    if (await fs.exists(ignorePath)) return;
    await fs.mkdir(cacheBase, { recursive: true });
    await createIgnoreMarker(fs, ignorePath);
  } catch (error) {
    logger.debug("Cache dir ignore marker not written", {
      cacheRoot: describeCacheRoot(cacheBase),
      reason: redactCachePathDetails(
        error instanceof Error ? error.message : String(error),
        cacheBase,
      ),
    });
  }
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
 * roots retain their expected framework dependency root for a cheaper
 * revalidation on later calls.
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
  const verifiedRoot = verifiedCacheRoots.get(cacheBase);
  if (verifiedRoot !== undefined) {
    if (await isCacheNodeModulesUsable(cacheBase, verifiedRoot)) return true;
    verifiedCacheRoots.delete(cacheBase);
  }

  let operation = nodeModulesLinkOperations.get(cacheBase);
  if (!operation) {
    operation = linkCacheNodeModules(cacheBase);
    nodeModulesLinkOperations.set(cacheBase, operation);
  }
  try {
    const nodeModulesDir = await operation;
    if (nodeModulesDir === undefined) return false;
    rememberVerifiedRoot(cacheBase, nodeModulesDir);
    warnedLinkFailureRoots.delete(cacheBase);
    return true;
  } finally {
    // The in-flight map deduplicates only concurrent work. The identity check
    // prevents an older waiter from deleting a replacement operation.
    if (nodeModulesLinkOperations.get(cacheBase) === operation) {
      nodeModulesLinkOperations.delete(cacheBase);
    }
  }
}

async function isCacheNodeModulesUsable(
  cacheBase: string,
  nodeModulesDir: string,
): Promise<boolean> {
  try {
    const { lstatSync, realpathSync } = await import("node:fs");
    const targetLink = join(cacheBase, "node_modules");
    const existing = lstatSync(targetLink);
    if (existing.isSymbolicLink()) {
      return realpathSync(targetLink) === realpathSync(nodeModulesDir);
    }
    if (!existing.isDirectory()) return false;
    return realpathSync(join(targetLink, "react")) ===
      realpathSync(join(nodeModulesDir, "react"));
  } catch {
    return false;
  }
}

async function linkCacheNodeModules(cacheBase: string): Promise<string | undefined> {
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
          if (realpathSync(targetLink) === realpathSync(nodeModulesDir)) return nodeModulesDir;
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
          ) return nodeModulesDir;
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
    return nodeModulesDir;
  } catch (error) {
    // Best-effort: symlink creation may fail due to permissions or platform,
    // but total failure must stay observable instead of looking like success.
    return warnLinkFailure(
      cacheBase,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function warnLinkFailure(cacheBase: string, reason: string): undefined {
  if (!warnedLinkFailureRoots.has(cacheBase)) {
    rememberBounded(warnedLinkFailureRoots, cacheBase);
    logger.warn("Cache node_modules link not established", {
      cacheRoot: describeCacheRoot(cacheBase),
      reason: redactCachePathDetails(reason, cacheBase),
    });
  }
  return undefined;
}
