import { AsyncLocalStorage } from "#veryfront/platform/compat/async-local-storage.ts";
import { join, resolve } from "#veryfront/compat/path/index.ts";
import { cwd, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";

const cacheStorage = new AsyncLocalStorage<string>();

/** Coordinates one link attempt per cache root while concurrent calls are active. */
export class CacheNodeModulesLinkCoordinator {
  private readonly inFlight = new Map<string, Promise<void>>();

  ensure(cacheRoot: string, operation: () => Promise<void>): Promise<void> {
    const existing = this.inFlight.get(cacheRoot);
    if (existing) return existing;

    const pending = Promise.resolve().then(operation);
    this.inFlight.set(cacheRoot, pending);
    void pending.then(
      () => {
        if (this.inFlight.get(cacheRoot) === pending) this.inFlight.delete(cacheRoot);
      },
      () => {
        if (this.inFlight.get(cacheRoot) === pending) this.inFlight.delete(cacheRoot);
      },
    );
    return pending;
  }
}

const nodeModulesLinkCoordinator = new CacheNodeModulesLinkCoordinator();

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

  const cacheBase = resolve(getCacheBaseDir());

  try {
    await nodeModulesLinkCoordinator.ensure(cacheBase, async () => {
      const { createRequire } = await import("node:module");
      const { lstatSync, symlinkSync, mkdirSync } = await import("node:fs");

      const targetLink = join(cacheBase, "node_modules");

      try {
        const existing = lstatSync(targetLink);
        if (existing.isDirectory() || existing.isSymbolicLink()) return;
        throw new Error("Cache node_modules path is not a directory");
      } catch (error) {
        if (
          typeof error !== "object" || error === null ||
          !("code" in error) || error.code !== "ENOENT"
        ) {
          throw error;
        }
      }

      const require = createRequire(import.meta.url);
      const reactEntry = require.resolve("react");

      const marker = "/node_modules/react";
      const idx = reactEntry.replaceAll("\\", "/").lastIndexOf(marker);
      if (idx === -1) throw new Error("React is not installed under node_modules");

      const nodeModulesDir = reactEntry.substring(0, idx + "/node_modules".length);

      mkdirSync(cacheBase, { recursive: true });
      symlinkSync(nodeModulesDir, targetLink, "dir");
    });
  } catch (_) {
    /* expected: best-effort symlink may fail due to permissions or platform */
  }
}
