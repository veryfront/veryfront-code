/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling local imports (@/ alias and relative)
 * and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { parallelMap, rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { findSourceFile } from "../file-resolver/index.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
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
import { dirname, join, normalize } from "#veryfront/compat/path/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import {
  getModulePathCache,
  lookupMdxEsmCache,
  saveModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";

const logger = rendererLogger.component("module-loader");

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

/** Maximum number of directories to track to prevent memory leaks */
const MAX_CREATED_DIRS = 5000;

/** Cache for created directories to avoid repeated mkdir calls (LRU-style) */
const createdDirs = new Set<string>();

/** TTL for cached transforms (uses centralized config) */
const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;

/** Prune oldest entries when cache exceeds limit */
function pruneCreatedDirs(): void {
  if (createdDirs.size <= MAX_CREATED_DIRS) return;

  const toDelete = createdDirs.size - MAX_CREATED_DIRS;
  let deleted = 0;

  for (const dir of createdDirs) {
    if (deleted >= toDelete) break;
    createdDirs.delete(dir);
    deleted++;
  }
}

function getModuleCacheKey(
  filePath: string,
  projectId?: string,
  projectDir?: string,
  contentSourceId?: string,
): string {
  const base = projectId ?? projectDir ?? "default";
  const source = contentSourceId ?? "default";
  return `${base}:${source}:${filePath}`;
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
    pruneCreatedDirs();
  }
}

type AliasImport = { full: string; path: string };
type RelativeImport = { full: string; path: string; fromDir: string };
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
): Promise<ResolvedDep> {
  const relativePath = imp.path.substring(2); // Remove @/ prefix

  const depFilePath = (await findSourceFile(relativePath, projectDir, adapter)) ??
    (await findSourceFile(`components/${relativePath}`, projectDir, adapter));

  return { ...imp, relativePath, depFilePath, isLocalLib: false };
}

async function resolveRelativeImport(
  imp: RelativeImport,
  adapter: RuntimeAdapter,
): Promise<ResolvedDep> {
  // Resolve the path relative to the file's directory and normalize to resolve ..
  const basePath = normalize(join(imp.fromDir, imp.path));

  logger.debug("Resolving relative import:", {
    path: imp.path,
    fromDir: imp.fromDir,
    basePath,
  });

  // Try to find the source file with various extensions
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  let depFilePath: string | null = null;

  // First try the exact path (in case it already has an extension)
  if (await adapter.fs.exists(basePath)) {
    const stat = await adapter.fs.stat(basePath);
    if (!stat.isDirectory) {
      depFilePath = basePath;
    }
  }

  // Try with extensions
  if (!depFilePath) {
    for (const ext of extensions) {
      const pathWithExt = basePath + ext;
      if (await adapter.fs.exists(pathWithExt)) {
        depFilePath = pathWithExt;
        break;
      }
    }
  }

  // Try index files if path is a directory
  if (!depFilePath) {
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (await adapter.fs.exists(indexPath)) {
        depFilePath = indexPath;
        break;
      }
    }
  }

  return {
    full: imp.full,
    path: imp.path,
    relativePath: imp.path,
    depFilePath,
    isLocalLib: false,
  };
}

/**
 * Transform a module and all its local dependencies (@/ alias and relative imports).
 *
 * @param filePath - Path to the module
 * @param tmpDir - Temp directory for caching
 * @param localAdapter - Local file system adapter
 * @param config - Module loader configuration
 * @param useLocalAdapter - Whether to use local adapter for reading
 * @returns Path to the transformed module file
 */
/** Pattern to detect unresolved /_vf_modules/ imports that will fail at runtime */
const UNRESOLVED_VF_MODULES_RE = /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/[^"']+)["']/;

export async function transformModuleWithDeps(
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  useLocalAdapter = false,
): Promise<string> {
  const { moduleCache, projectDir, projectId, contentSourceId, adapter, mode } = config;
  const cacheKey = getModuleCacheKey(filePath, projectId, projectDir, contentSourceId);

  const cachedPath = moduleCache.get(cacheKey);
  if (cachedPath) {
    // Validate cached file doesn't contain unresolved /_vf_modules/ imports
    // These would fail at runtime and indicate stale cache from before framework import fix
    try {
      const cachedCode = await createFileSystem().readTextFile(cachedPath);
      if (UNRESOLVED_VF_MODULES_RE.test(cachedCode)) {
        logger.warn(
          "[ModuleLoader] In-memory cache contains unresolved _vf_modules, invalidating",
          {
            filePath: filePath.slice(-60),
            cachedPath: cachedPath.slice(-60),
          },
        );
        moduleCache.delete(cacheKey);
        // Don't return - fall through to re-transform
      } else {
        return cachedPath;
      }
    } catch {
      // File doesn't exist or can't be read - fall through to re-transform
      moduleCache.delete(cacheKey);
    }
  }

  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const mdxCacheDir = join(baseCacheDir, projectKey, sourceKey);

    const mdxCacheResult = await lookupMdxEsmCache(filePath, mdxCacheDir, projectDir);
    if (mdxCacheResult.status === "hit") {
      moduleCache.set(cacheKey, mdxCacheResult.path);
      return mdxCacheResult.path;
    }

    if (mdxCacheResult.status === "corrupted") {
      logger.warn("MDX-ESM cache corrupted, will re-transform", {
        filePath,
        reason: mdxCacheResult.reason,
      });
    }
  }

  const readAdapter = useLocalAdapter ? localAdapter : adapter;
  let fileContent = decodeFileContent(await readAdapter.fs.readFile(filePath));

  const fileDir = dirname(filePath);

  // Match @/ alias imports
  const aliasImports: AliasImport[] = [...fileContent.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map(
    (m) => ({ full: m[0], path: m[1]! }),
  );

  // Match relative imports (./ and ../) - exclude npm:, http://, https://, file://
  const relativeImports: RelativeImport[] = [
    ...fileContent.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g),
  ]
    .map((m) => ({ full: m[0], path: m[1]!, fromDir: fileDir }))
    // Filter out already-transformed file:// imports
    .filter((imp) => !imp.path.includes("file://"));

  logger.debug("Processing file:", {
    filePath,
    aliasImportsCount: aliasImports.length,
    relativeImportsCount: relativeImports.length,
    aliasImports: aliasImports.map((i) => i.path),
    relativeImports: relativeImports.map((i) => i.path),
  });

  // Resolve alias imports
  const resolvedAliasDeps = await parallelMap(
    aliasImports,
    (imp) => resolveAliasImport(imp, projectDir, adapter),
  );

  // Resolve relative imports
  const resolvedRelativeDeps = await parallelMap(
    relativeImports,
    (imp) => resolveRelativeImport(imp, adapter),
  );

  // Combine all resolved dependencies
  const resolvedDeps = [...resolvedAliasDeps, ...resolvedRelativeDeps];

  const transformedDeps = await parallelMap(
    resolvedDeps.filter((d) => d.depFilePath),
    async (dep) => {
      logger.debug("Found dependency:", {
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
    logger.debug("Replaced import:", {
      path: dep.path,
      depTempPath: dep.depTempPath,
    });
  }

  for (const dep of resolvedDeps) {
    if (dep.depFilePath) continue;
    logger.warn("Could not find dependency:", {
      path: dep.path,
      relativePath: dep.relativePath,
      projectDir,
    });
  }

  const contentHash = hashCodeHex(fileContent);
  const effectiveProjectId = projectId ?? projectDir;
  const scopedPath = `${effectiveProjectId}:${filePath}`;
  const transformCacheKey = generateTransformCacheKey(scopedPath, contentHash, true);

  await initializeTransformCache();

  const transformResult = await getOrComputeTransform(
    transformCacheKey,
    () => {
      logger.debug("Transform cache miss, transforming", { filePath });
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

  const cacheDir = getHttpBundleCacheDir();
  let bundlesValid = true;

  if (transformResult.cacheHit && transformResult.bundleManifestId) {
    const validation = await validateBundleGroup(transformResult.bundleManifestId, cacheDir);
    if (!validation.valid) {
      logger.warn("Bundle manifest validation failed, re-transforming", {
        filePath,
        manifestId: transformResult.bundleManifestId.slice(0, 12),
        failedHashes: validation.failedHashes,
      });
      bundlesValid = false;
    }
  } else {
    const bundlePaths = extractHttpBundlePaths(transformedCode);
    if (bundlePaths.length > 0) {
      const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
      if (failed.length > 0) {
        logger.warn("HTTP bundle recovery failed, re-transforming", {
          filePath,
          failed,
        });
        bundlesValid = false;
      }
    }
  }

  if (!bundlesValid) {
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
      logger.debug("Failed to update transform cache after re-transform", {
        filePath,
        error,
      });
    });
  }

  // CRITICAL: Validate that no unresolved /_vf_modules/ imports remain after transform.
  // These imports should have been resolved to file:// paths by ssrVfModulesPlugin.
  // If they're still present, retry the transform bypassing all caches.
  if (UNRESOLVED_VF_MODULES_RE.test(transformedCode)) {
    const match = transformedCode.match(UNRESOLVED_VF_MODULES_RE);
    const unresolvedImport = match?.[1] || "unknown";
    logger.warn(
      "[ModuleLoader] Transform has unresolved _vf_modules import, retrying without cache",
      {
        filePath: filePath.slice(-60),
        unresolvedImport: unresolvedImport.slice(0, 80),
        cacheHit: transformResult.cacheHit,
      },
    );

    // Force a fresh transform bypassing all caches
    // Import runPipeline directly to bypass getOrComputeTransform cache
    const { runPipeline } = await import("#veryfront/transforms/pipeline/index.ts");
    const pipelineResult = await runPipeline(fileContent, filePath, projectDir, {
      projectId: effectiveProjectId,
      dev: mode === "development",
      ssr: true,
      reactVersion: config.reactVersion,
    });
    transformedCode = pipelineResult.code;

    // Check again after retry
    if (UNRESOLVED_VF_MODULES_RE.test(transformedCode)) {
      const retryMatch = transformedCode.match(UNRESOLVED_VF_MODULES_RE);
      logger.error("Transform still has unresolved _vf_modules after retry", {
        filePath: filePath.slice(-60),
        unresolvedImport: retryMatch?.[1]?.slice(0, 80) || "unknown",
        hint:
          "Check that framework sources exist in dist/framework-src/ and ssrVfModulesPlugin is running",
      });
      // Continue anyway - let it fail at import time for better error context
    } else {
      // Retry succeeded - update the cache
      setCachedTransformAsync(
        transformCacheKey,
        transformedCode,
        hashCodeHex(transformedCode).slice(0, 16),
        TRANSFORM_CACHE_TTL_SECONDS,
      ).catch((error) => {
        logger.debug("Failed to update cache after retry", { filePath, error });
      });
    }
  }

  const transformedHash = hashCodeHex(transformedCode).slice(0, 8);

  const relativePath = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath.replace(/^\/+/, "");

  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `.${transformedHash}.js`);
  const tempFilePath = join(tmpDir, jsPath);

  const tempDir = tempFilePath.substring(0, tempFilePath.lastIndexOf("/"));
  await ensureDir(localAdapter, tempDir);

  try {
    await localAdapter.fs.writeFile(tempFilePath, transformedCode);
  } catch (error) {
    logger.error("Failed to write module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (contentSourceId) {
    const normalizedPath = `_vf_modules/${relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js")}`;
    const mdxCacheKey = `v${VERSION}:${normalizedPath}`;
    const cache = await getModulePathCache(tmpDir);
    cache.set(mdxCacheKey, tempFilePath);

    saveModulePathCache(tmpDir).catch((err) => {
      logger.debug("Failed to save module cache", { error: String(err) });
    });

    logger.debug("Registered module in MDX-ESM cache", {
      file: filePath.slice(-40),
      mdxCacheKey,
      tempFilePath: tempFilePath.slice(-60),
    });
  }

  moduleCache.set(cacheKey, tempFilePath);
  return tempFilePath;
}

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

    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    await createFileSystem().mkdir(cacheDir, { recursive: true });

    return cacheDir;
  }

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
    const errorMsg = error instanceof Error ? error.message : String(error);
    const bundleMatch = errorMsg.match(/veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/);

    if (bundleMatch) {
      const hash = bundleMatch[1]!;
      logger.warn("Import failed due to missing HTTP bundle, attempting recovery", {
        filePath,
        hash,
      });

      const { recoverHttpBundleByHash } = await import("#veryfront/transforms/esm/http-cache.ts");
      const cacheDir = getHttpBundleCacheDir();
      const recovered = await recoverHttpBundleByHash(hash, cacheDir);

      if (recovered) {
        logger.info("HTTP bundle recovered, retrying import", { hash });
        return await import(`file://${tempFilePath}?t=${Date.now()}&retry=1`);
      }
    }

    logger.error("Failed to import module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
