/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling local imports (@/ alias and relative)
 * and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getProjectTmpDir } from "#veryfront/modules/react-loader/index.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  invalidateMdxEsmModule,
  lookupMdxEsmCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  resolveModuleDependencies,
  rewriteResolvedDependencyImports,
} from "./dependency-resolver.ts";
import { persistTransformedModule } from "./module-persistence.ts";
import {
  transformModuleCodeWithCache,
  UNRESOLVED_VF_MODULES_RE,
} from "./module-transform-cache.ts";

const logger = rendererLogger.component("module-loader");

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

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
    } catch (_) {
      /* expected: cached file may no longer exist on disk */
      moduleCache.delete(cacheKey);
    }
  }

  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const mdxCacheDir = join(baseCacheDir, projectKey, sourceKey);

    const mdxCacheResult = await lookupMdxEsmCache(
      filePath,
      mdxCacheDir,
      projectDir,
      undefined,
      {
        projectId,
        contentSourceId,
      },
      config.reactVersion,
    );
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

  const resolvedDeps = await resolveModuleDependencies({
    adapter,
    fileContent,
    filePath,
    projectDir,
  });

  const transformedDeps = await Promise.all(
    resolvedDeps.filter((d) => d.depFilePath).map(async (dep) => {
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
    }),
  );

  fileContent = rewriteResolvedDependencyImports(fileContent, transformedDeps);
  for (const dep of transformedDeps) {
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

  const effectiveProjectId = projectId ?? projectDir;
  const { code: transformedCode } = await transformModuleCodeWithCache({
    fileContent,
    filePath,
    projectDir,
    effectiveProjectId,
    mode,
    adapter,
    reactVersion: config.reactVersion,
  });

  return await persistTransformedModule({
    filePath,
    projectDir,
    tmpDir,
    transformedCode,
    localAdapter,
    moduleCache,
    cacheKey,
    contentSourceId,
    reactVersion: config.reactVersion,
  });
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
 * Detect a dynamic `import()` failure caused by a module file that is missing on
 * disk (e.g. a stale/evicted cached page module). Matches Node/Deno's
 * `ERR_MODULE_NOT_FOUND` as well as the "Cannot find module" / "Module not found"
 * message variants the runtimes surface for a missing `import()` target.
 */
export function isMissingModuleError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") return true;
  return /cannot find module|module not found/i.test(error.message);
}

/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export async function loadModule(
  filePath: string,
  config: ModuleLoaderConfig,
): Promise<Record<string, unknown>> {
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

    // Self-heal: the cached module artifact resolved to a path that no longer
    // exists on disk (evicted, or rebuilt under a different content hash by a
    // racing write). Rather than hard-failing the whole page render (#2077),
    // treat it as a cache miss: drop the stale cache pointers so we don't get
    // handed the same dead path, rebuild the module from source, and retry the
    // import once. Skip HTTP-bundle misses, which have dedicated recovery above.
    if (!bundleMatch && isMissingModuleError(error)) {
      logger.warn("Cached module missing on disk, rebuilding and retrying import", {
        filePath,
        tempFilePath,
      });

      config.moduleCache.delete(
        getModuleCacheKey(filePath, config.projectId, config.projectDir, config.contentSourceId),
      );
      // tmpDir is the exact cache dir this module was registered under, so the
      // invalidation stays scoped to this tenant (the path-cache key is not
      // project-scoped — see invalidateMdxEsmModule).
      invalidateMdxEsmModule(tmpDir, filePath, config.projectDir, config.reactVersion);

      const rebuiltPath = await transformModuleWithDeps(filePath, tmpDir, localAdapter, config);
      return await import(`file://${rebuiltPath}?t=${Date.now()}&rebuilt=1`);
    }

    logger.error("Failed to import module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
