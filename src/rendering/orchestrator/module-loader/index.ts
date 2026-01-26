/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling @/ imports and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { parallelMap, rendererLogger as logger } from "#veryfront/utils";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { findSourceFile } from "../file-resolver/index.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { getProjectTmpDir } from "#veryfront/modules/react-loader/index.ts";
import { TRANSFORM_CACHE_VERSION } from "#veryfront/transforms/esm/package-registry.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import {
  getModulePathCache,
  lookupMdxEsmCache,
  saveModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

/** Cache for created directories to avoid repeated mkdir calls */
const createdDirs = new Set<string>();

/**
 * Distributed transform cache for cross-pod sharing.
 * Caches transformed module code in Redis/API so other pods don't need to re-transform.
 */
let distributedTransformCache: CacheBackend | null | undefined;
const distributedCacheInit = new Singleflight<CacheBackend | null>();

/** TTL for cached transforms (24 hours) */
const TRANSFORM_CACHE_TTL_SECONDS = 86400;

function getDistributedTransformCache(): Promise<CacheBackend | null> {
  if (distributedTransformCache !== undefined) {
    return Promise.resolve(distributedTransformCache);
  }

  return distributedCacheInit.do("init", async () => {
    try {
      const { CacheBackends } = await import("#veryfront/cache/backend.ts");
      const backend = await CacheBackends.transform();

      // Only use distributed cache if API or Redis (not memory - that's per-process)
      if (backend.type === "memory") {
        distributedTransformCache = null;
        logger.debug("[ModuleLoader] No distributed transform cache (memory only)");
        return null;
      }

      distributedTransformCache = backend;
      logger.debug("[ModuleLoader] Distributed transform cache initialized", {
        type: backend.type,
      });
      return backend;
    } catch (error) {
      logger.debug("[ModuleLoader] Failed to init distributed transform cache", { error });
      distributedTransformCache = null;
      return null;
    }
  });
}

/**
 * Build cache key for transformed module.
 * Includes content hash so cache invalidates when source changes.
 */
function getTransformCacheKey(projectId: string, filePath: string, contentHash: string): string {
  return `v${TRANSFORM_CACHE_VERSION}:${projectId}:${filePath}:${contentHash}`;
}

export interface ModuleLoaderConfig {
  projectDir: string;
  projectId?: string;
  contentSourceId?: string;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  moduleCache: Map<string, string>;
  esmCache: Map<string, string>;
}

function getModuleCacheKey(filePath: string, projectId?: string, projectDir?: string): string {
  return `${projectId ?? projectDir ?? "default"}:${filePath}`;
}

function decodeFileContent(fileContent: string | Uint8Array): string {
  if (typeof fileContent === "string") return fileContent;
  return new TextDecoder().decode(fileContent);
}

async function ensureDir(adapter: RuntimeAdapter, dir: string): Promise<void> {
  if (createdDirs.has(dir)) return;

  try {
    await adapter.fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist, ignore errors
  } finally {
    createdDirs.add(dir);
  }
}

type AliasImport = { full: string; path: string };
type ResolvedDep = {
  full: string;
  path: string;
  relativePath: string;
  depFilePath: string | null;
  isLocalLib: boolean;
};

async function resolveAliasImport(
  imp: AliasImport,
  projectDir: string,
  adapter: RuntimeAdapter,
  _localAdapter: RuntimeAdapter,
): Promise<ResolvedDep> {
  const relativePath = imp.path.substring(2); // Remove @/ prefix

  // @/ alias always resolves to project directory
  // Try exact path first, then components/ subdirectory
  const depFilePath = await findSourceFile(relativePath, projectDir, adapter) ??
    await findSourceFile(`components/${relativePath}`, projectDir, adapter);

  return { ...imp, relativePath, depFilePath, isLocalLib: false };
}

/**
 * Transform a module and all its @/ dependencies.
 *
 * @param filePath - Path to the module
 * @param tmpDir - Temp directory for caching
 * @param localAdapter - Local file system adapter
 * @param config - Module loader configuration
 * @param useLocalAdapter - Whether to use local adapter for reading
 * @returns Path to the transformed module file
 */
export async function transformModuleWithDeps(
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  useLocalAdapter = false,
): Promise<string> {
  const { moduleCache, projectDir, projectId, contentSourceId, adapter, mode } = config;
  const cacheKey = getModuleCacheKey(filePath, projectId, projectDir);

  const cachedPath = moduleCache.get(cacheKey);
  if (cachedPath) return cachedPath;

  // Check MDX-ESM cache to share modules with SSR loader (prevents duplicate React contexts)
  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const mdxCacheDir = join(baseCacheDir, projectKey, sourceKey);

    const mdxCachedPath = await lookupMdxEsmCache(filePath, mdxCacheDir, projectDir);
    if (mdxCachedPath) {
      moduleCache.set(cacheKey, mdxCachedPath);
      return mdxCachedPath;
    }
  }

  const readAdapter = useLocalAdapter ? localAdapter : adapter;
  let fileContent = decodeFileContent(await readAdapter.fs.readFile(filePath));

  const aliasImports: AliasImport[] = [...fileContent.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map(
    (m) => ({ full: m[0], path: m[1]! }),
  );

  logger.debug("[ModuleLoader] Processing file:", {
    filePath,
    aliasImportsCount: aliasImports.length,
    aliasImports: aliasImports.map((i) => i.path),
  });

  const resolvedDeps = await parallelMap(
    aliasImports,
    (imp) => resolveAliasImport(imp, projectDir, adapter, localAdapter),
  );

  const transformedDeps = await parallelMap(
    resolvedDeps.filter((d) => d.depFilePath),
    async (dep) => {
      logger.debug("[ModuleLoader] Found dependency:", {
        path: dep.path,
        depFilePath: dep.depFilePath,
        isLocalLib: dep.isLocalLib,
      });

      const depTempPath = await transformModuleWithDeps(
        dep.depFilePath!,
        tmpDir,
        localAdapter,
        config,
        dep.isLocalLib,
      );

      return { ...dep, depTempPath };
    },
  );

  for (const dep of transformedDeps) {
    fileContent = fileContent.replace(dep.full, `from "file://${dep.depTempPath}"`);
    logger.debug("[ModuleLoader] Replaced import:", {
      path: dep.path,
      depTempPath: dep.depTempPath,
    });
  }

  for (const dep of resolvedDeps) {
    if (dep.depFilePath) continue;
    logger.warn("[ModuleLoader] Could not find dependency:", {
      path: dep.path,
      relativePath: dep.relativePath,
      projectDir,
    });
  }

  const contentHash = hashCodeHex(fileContent);
  const effectiveProjectId = projectId ?? projectDir;
  const transformCacheKey = getTransformCacheKey(effectiveProjectId, filePath, contentHash);

  let transformedCode: string | null = null;
  const distributedCache = await getDistributedTransformCache();

  if (distributedCache) {
    try {
      const cached = await distributedCache.get(transformCacheKey);
      if (cached) {
        transformedCode = cached;
        logger.debug("[ModuleLoader] Distributed transform cache HIT", {
          filePath,
          cacheKey: transformCacheKey,
        });
      }
    } catch (error) {
      logger.debug("[ModuleLoader] Distributed cache get failed", { filePath, error });
    }
  }

  if (!transformedCode) {
    transformedCode = await transformToESM(fileContent, filePath, projectDir, adapter, {
      projectId: effectiveProjectId,
      dev: mode === "development",
      ssr: true,
    });

    if (distributedCache) {
      distributedCache
        .set(transformCacheKey, transformedCode, TRANSFORM_CACHE_TTL_SECONDS)
        .catch((error) => {
          logger.debug("[ModuleLoader] Distributed cache set failed", { filePath, error });
        });
    }
  }

  // Use TRANSFORMED hash for filename (matches SSR loader behavior)
  const transformedHash = hashCodeHex(transformedCode).slice(0, 8);

  const relativePath = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath.replace(/^\/+/, "");

  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `.${transformedHash}.js`);
  const tempFilePath = join(tmpDir, jsPath);

  // Ensure directory exists (might be nested like lib/ or components/)
  const tempDir = tempFilePath.substring(0, tempFilePath.lastIndexOf("/"));
  await ensureDir(localAdapter, tempDir);

  try {
    await localAdapter.fs.writeFile(tempFilePath, transformedCode);
  } catch (error) {
    logger.error("[ModuleLoader] Failed to write module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // Register in MDX-ESM cache index so other loaders can find this module
  if (contentSourceId) {
    const normalizedPath = `_vf_modules/${relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js")}`;
    const mdxCacheKey = `v${TRANSFORM_CACHE_VERSION}:${normalizedPath}`;
    const cache = await getModulePathCache(tmpDir);
    cache.set(mdxCacheKey, tempFilePath);
    // Persist to disk so MDX loader can find it
    saveModulePathCache(tmpDir).catch((err) => {
      logger.debug("[ModuleLoader] Failed to save module cache", { error: String(err) });
    });
    logger.debug("[ModuleLoader] Registered module in MDX-ESM cache", {
      file: filePath.slice(-40),
      mdxCacheKey,
      tempFilePath: tempFilePath.slice(-60),
    });
  }

  moduleCache.set(cacheKey, tempFilePath);
  return tempFilePath;
}

/**
 * Get the cache directory for module transforms.
 * Uses MDX-ESM cache when contentSourceId is available, otherwise falls back to project tmp dir.
 * This ensures modules are shared between orchestrator and MDX loader to prevent duplicate contexts.
 */
async function getModuleCacheDir(config: ModuleLoaderConfig): Promise<string> {
  const { projectId, contentSourceId, projectDir } = config;

  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const cacheDir = join(baseCacheDir, projectKey, sourceKey);

    // Ensure directory exists
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    await createFileSystem().mkdir(cacheDir, { recursive: true });

    return cacheDir;
  }

  // Fallback for cases without contentSourceId
  return getProjectTmpDir(projectId ?? projectDir);
}

/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export async function loadModule(filePath: string, config: ModuleLoaderConfig): Promise<any> {
  const tmpDir = await getModuleCacheDir(config);
  const localAdapter = await getLocalAdapter();

  const tempFilePath = await transformModuleWithDeps(filePath, tmpDir, localAdapter, config);
  const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;

  try {
    return await import(moduleUrl);
  } catch (error) {
    logger.error("[ModuleLoader] Failed to import module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
