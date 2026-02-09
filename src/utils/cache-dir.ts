import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "#veryfront/compat/path/index.ts";
import { cwd, getEnv } from "#veryfront/platform/compat/process.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";

const cacheStorage = new AsyncLocalStorage<string>();
let nodeModulesLinked = false;

export function runWithCacheDir<T>(cacheDir: string, fn: () => T): T {
  return cacheStorage.run(cacheDir, fn);
}

export function getCacheDirFromContext(): string | undefined {
  return cacheStorage.getStore();
}

export function getCacheBaseDir(): string {
  return (
    getCacheDirFromContext() ??
      getEnv("VERYFRONT_CACHE_DIR") ?? getEnv("VF_CACHE_DIR") ??
      join(cwd(), ".cache")
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
 * Cached .mjs files live under getCacheBaseDir() (e.g. /app/.cache/). Node.js
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
  if (!isNode || nodeModulesLinked) return;
  nodeModulesLinked = true;

  try {
    const { createRequire } = await import("node:module");
    const { lstatSync, symlinkSync, mkdirSync } = await import("node:fs");

    const cacheBase = getCacheBaseDir();
    const targetLink = join(cacheBase, "node_modules");

    try {
      lstatSync(targetLink);
      return;
    } catch {
      // Doesn't exist yet
    }

    const require = createRequire(import.meta.url);
    const reactEntry = require.resolve("react");

    const marker = "/node_modules/react";
    const idx = reactEntry.lastIndexOf(marker);
    if (idx === -1) return;

    const nodeModulesDir = reactEntry.substring(0, idx + "/node_modules".length);

    mkdirSync(cacheBase, { recursive: true });
    symlinkSync(nodeModulesDir, targetLink, "dir");
  } catch {
    // Best-effort: if symlink fails (permissions, platform), bare specifier
    // resolution will fall through to Node.js defaults.
  }
}
