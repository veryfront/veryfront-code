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

export interface NodeModulesLinkOperations {
  joinPath(...paths: string[]): string;
  lstatSync(path: string): unknown;
  realpathSync(path: string): string;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  symlinkSync(target: string, path: string, type: "dir"): unknown;
}

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as { code?: unknown }).code === code;
}

function assertNodeModulesLinkTarget(
  targetLink: string,
  expectedTarget: string,
  operations: NodeModulesLinkOperations,
): void {
  const existingTarget = operations.realpathSync(targetLink);
  if (existingTarget === expectedTarget) return;

  throw new Error(
    `Cache node_modules path points to a different dependency root: ${targetLink}`,
  );
}

/**
 * Create or validate one cache-root node_modules link.
 *
 * Existing paths are accepted only when their canonical target is the exact
 * framework dependency root. This prevents a stale cache directory from
 * loading a second, incompatible React installation.
 */
export function ensureNodeModulesLink(
  cacheBase: string,
  nodeModulesDir: string,
  operations: NodeModulesLinkOperations,
): void {
  const expectedTarget = operations.realpathSync(nodeModulesDir);
  const targetLink = operations.joinPath(cacheBase, "node_modules");

  try {
    operations.lstatSync(targetLink);
    assertNodeModulesLinkTarget(targetLink, expectedTarget, operations);
    return;
  } catch (error) {
    if (!hasNodeErrorCode(error, "ENOENT")) throw error;
  }

  operations.mkdirSync(cacheBase, { recursive: true });
  try {
    operations.symlinkSync(expectedTarget, targetLink, "dir");
  } catch (error) {
    if (!hasNodeErrorCode(error, "EEXIST")) throw error;
    assertNodeModulesLinkTarget(targetLink, expectedTarget, operations);
  }
}

async function linkCacheNodeModules(cacheBase: string): Promise<void> {
  const [{ createRequire }, fs, path] = await Promise.all([
    import("node:module"),
    import("node:fs"),
    import("node:path"),
  ]);

  const require = createRequire(import.meta.url);
  const reactEntry = fs.realpathSync(require.resolve("react"));
  const searchPaths = require.resolve.paths("react") ?? [];
  let nodeModulesDir: string | undefined;

  for (const candidate of searchPaths) {
    let reactPackageDir: string;
    try {
      reactPackageDir = fs.realpathSync(path.join(candidate, "react"));
    } catch (error) {
      if (hasNodeErrorCode(error, "ENOENT") || hasNodeErrorCode(error, "ENOTDIR")) {
        continue;
      }
      throw error;
    }

    const relativeEntry = path.relative(reactPackageDir, reactEntry);
    if (
      relativeEntry === "" ||
      (!relativeEntry.startsWith(`..${path.sep}`) &&
        relativeEntry !== ".." &&
        !path.isAbsolute(relativeEntry))
    ) {
      nodeModulesDir = candidate;
      break;
    }
  }

  if (!nodeModulesDir) {
    throw new Error(
      "Unable to locate the framework node_modules directory containing React",
    );
  }

  ensureNodeModulesLink(cacheBase, nodeModulesDir, {
    joinPath: path.join,
    lstatSync: fs.lstatSync,
    realpathSync: fs.realpathSync,
    mkdirSync: fs.mkdirSync,
    symlinkSync: fs.symlinkSync,
  });
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
  const cacheBase = getCacheBaseDir();
  const existing = nodeModulesLinkOperations.get(cacheBase);
  if (existing) return await existing;

  const operation = linkCacheNodeModules(cacheBase);
  nodeModulesLinkOperations.set(cacheBase, operation);
  try {
    await operation;
  } finally {
    if (nodeModulesLinkOperations.get(cacheBase) === operation) {
      nodeModulesLinkOperations.delete(cacheBase);
    }
  }
}
