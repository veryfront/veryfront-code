/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling @/ imports and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { parallelMap, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { findSourceFile } from "../file-resolver/index.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { getProjectTmpDir } from "#veryfront/modules/react-loader/index.ts";
import {
  generateCacheKey as generateTransformCacheKey,
  getOrComputeTransform,
  initializeTransformCache,
  setCachedTransformAsync,
} from "#veryfront/transforms/esm/transform-cache.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { validateBundleGroup } from "#veryfront/transforms/esm/bundle-manifest.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { TRANSFORM_CACHE_VERSION } from "#veryfront/transforms/esm/package-registry.ts";
import {
  getModulePathCache,
  lookupMdxEsmCache,
  saveModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

/** Cache for created directories to avoid repeated mkdir calls */
const createdDirs = new Set<string>();

/** TTL for cached transforms (uses centralized config) */
const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;

export interface ModuleLoaderConfig {
  projectDir: string;
  projectId?: string;
  contentSourceId?: string;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  moduleCache: Map<string, string>;
  esmCache: Map<string, string>;
  /** React version for transforms (from project config) */
  reactVersion?: string;
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
  const scopedPath = `${effectiveProjectId}:${filePath}`;
  const transformCacheKey = generateTransformCacheKey(scopedPath, contentHash, true); // ssr=true

  // Initialize transform cache (lazy, only once per pod)
  await initializeTransformCache();

  // Use consolidated transform cache with getOrCompute pattern
  const transformResult = await getOrComputeTransform(
    transformCacheKey,
    () => {
      logger.debug("[ModuleLoader] Transform cache miss, transforming", { filePath });
      return transformToESM(fileContent, filePath, projectDir, adapter, {
        projectId: effectiveProjectId,
        dev: mode === "development",
        ssr: true,
        reactVersion: config.reactVersion,
      });
    },
    TRANSFORM_CACHE_TTL_SECONDS,
  );
  let transformedCode = transformResult.code;

  // Validate HTTP bundles using manifest (preferred) or legacy extraction
  const cacheDir = getHttpBundleCacheDir();
  let bundlesValid = true;

  if (transformResult.cacheHit && transformResult.bundleManifestId) {
    // Manifest-based validation: atomic check that ALL bundles exist
    const validation = await validateBundleGroup(transformResult.bundleManifestId, cacheDir);
    if (!validation.valid) {
      logger.warn("[ModuleLoader] Bundle manifest validation failed, re-transforming", {
        filePath,
        manifestId: transformResult.bundleManifestId.slice(0, 12),
        failedHashes: validation.failedHashes,
      });
      bundlesValid = false;
    }
  } else {
    // Legacy path: extract bundle paths and ensure they exist
    const bundlePaths = extractHttpBundlePaths(transformedCode);
    if (bundlePaths.length > 0) {
      const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
      if (failed.length > 0) {
        logger.warn("[ModuleLoader] HTTP bundle recovery failed, re-transforming", {
          filePath,
          failed,
        });
        bundlesValid = false;
      }
    }
  }

  if (!bundlesValid) {
    // Re-transform from source — this will create fresh bundles with a new manifest
    transformedCode = await transformToESM(fileContent, filePath, projectDir, adapter, {
      projectId: effectiveProjectId,
      dev: mode === "development",
      ssr: true,
      reactVersion: config.reactVersion,
    });
    setCachedTransformAsync(
      transformCacheKey,
      transformedCode,
      contentHash,
      TRANSFORM_CACHE_TTL_SECONDS,
    ).catch((error) => {
      logger.debug("[ModuleLoader] Failed to update transform cache after re-transform", {
        filePath,
        error,
      });
    });
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
    // If import fails due to missing HTTP bundle, try to recover and retry once
    const errorMsg = error instanceof Error ? error.message : String(error);
    const bundleMatch = errorMsg.match(/veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/);
    if (bundleMatch) {
      const hash = bundleMatch[1]!;
      logger.warn("[ModuleLoader] Import failed due to missing HTTP bundle, attempting recovery", {
        filePath,
        hash,
      });
      const { recoverHttpBundleByHash } = await import("#veryfront/transforms/esm/http-cache.ts");
      const cacheDir = getHttpBundleCacheDir();
      const recovered = await recoverHttpBundleByHash(hash, cacheDir);
      if (recovered) {
        logger.info("[ModuleLoader] HTTP bundle recovered, retrying import", { hash });
        return await import(`file://${tempFilePath}?t=${Date.now()}&retry=1`);
      }
    }

    logger.error("[ModuleLoader] Failed to import module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
