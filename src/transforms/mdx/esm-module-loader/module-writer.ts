/**
 * Module Writer
 *
 * Handles the core async transform and write pipeline for MDX ESM modules.
 * Manages module caching, HTTP bundle verification, framework bundle
 * regeneration, and dynamic import execution.
 *
 * @module build/transforms/mdx/esm-module-loader/module-writer
 */

import { join } from "#veryfront/compat/path";
import React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import {
  BUILD_FAILED,
  BUNDLE_ERROR,
  CACHE_ERROR,
  IMPORT_RESOLUTION_ERROR,
  INVALID_ARGUMENT,
} from "#veryfront/errors";
import { getErrorCollector } from "#veryfront/observability/error-collector.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { ensureCacheNodeModules, getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { verifyCacheFileExists, writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { cacheHttpImportsToLocal, ensureHttpBundlesExist } from "../../esm/http-cache.ts";
import {
  extractAllHttpBundlePathsRecursive,
  extractHttpBundlePaths,
} from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { setupSSRGlobals } from "#veryfront/rendering/ssr-globals.ts";
import type { MDXFrontmatter, MDXModule } from "../types.ts";
import type { ESMLoaderContext } from "./types.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import {
  LOG_PREFIX_MDX_LOADER,
  LOG_PREFIX_MDX_RENDERER,
  UNRESOLVED_VF_MODULES_PATTERN,
} from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { hashString } from "./utils/hash.ts";
import { ssrVfModulesPlugin } from "../../pipeline/stages/ssr-vf-modules.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { extractFrameworkBundlePaths } from "../../shared/framework-bundle-paths.ts";
import {
  rewriteProjectAliasImports,
  transformImports,
  transformJsxImports,
  transformReactToLocalPaths,
} from "./import-transformer.ts";
import {
  findMissingFrameworkBundles,
  findVfModuleImports,
  initializeCacheDir,
  processVfModuleImports,
  resolveProjectDir,
} from "./loader-helpers.ts";

/** Singleflight for MDX module file writes to prevent race conditions */
const mdxWriteFlight = new Singleflight<void>();

/**
 * Cache HTTP imports to local file:// paths for SSR.
 *
 * - Deno runtime: Supports HTTP imports natively, skip caching to avoid
 *   creating pod-specific file:// paths that break distributed caching.
 * - Deno compiled binary: CANNOT dynamically import HTTP URLs at runtime,
 *   so we must cache them to local file:// paths (like Node.js/Bun).
 * - Node.js/Bun: Must cache HTTP imports to local file:// paths.
 *
 * Note: We always cache HTTP imports for consistency between compiled and
 * non-compiled modes, allowing them to share the same cache.
 */
async function cacheHttpImports(code: string, importMap: ImportMapConfig): Promise<string> {
  const result = await cacheHttpImportsToLocal(code, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
  });
  return result.code;
}

export async function doLoadModuleESM(
  compiledProgramCode: string,
  context: ESMLoaderContext,
): Promise<MDXModule> {
  const loadStart = performance.now();
  const projectSlug = context.projectSlug || "unknown";

  logger.debug(`${LOG_PREFIX_MDX_LOADER} loadModuleESM START`, { projectSlug });

  try {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: Detect adapter START`, { projectSlug });
    if (!context.adapter) {
      const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
      context.adapter = await runtime.get();
    }
    const adapter = context.adapter;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: Detect adapter DONE`, { projectSlug });

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: initializeCacheDir START`, { projectSlug });
    const esmCacheDir = await initializeCacheDir(context);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: initializeCacheDir DONE`, { projectSlug });

    let rewritten = rewriteProjectAliasImports(compiledProgramCode);

    const projectDir = resolveProjectDir(context);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: loadImportMap START`, { projectSlug });
    const importMap = await loadImportMap(projectDir, adapter);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: loadImportMap DONE`, { projectSlug });

    rewritten = transformImports(rewritten, importMap);

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: processVfModuleImports START`, { projectSlug });
    const vfModuleImports = findVfModuleImports(rewritten);
    const strictMissingModules = context.strictMissingModules ?? true;
    rewritten = await withSpan(
      SpanNames.MDX_PROCESS_VF_MODULES,
      () =>
        processVfModuleImports(
          rewritten,
          vfModuleImports,
          context,
          projectDir,
          strictMissingModules,
        ),
      { "mdx.vf_module_count": vfModuleImports.length },
    );
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: processVfModuleImports DONE`, { projectSlug });

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformJsxImports START`, { projectSlug });
    rewritten = await withSpan(
      SpanNames.MDX_TRANSFORM_JSX,
      () => transformJsxImports(rewritten, adapter, esmCacheDir),
      { "mdx.project_slug": projectSlug },
    );
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformJsxImports DONE`, { projectSlug });

    if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
      rewritten += "\nexport { MDXLayout as __vfLayout };\n";
    }

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: cacheHttpImports START`, { projectSlug });
    rewritten = await withSpan(
      SpanNames.MDX_CACHE_HTTP,
      () => cacheHttpImports(rewritten, importMap),
      { "mdx.project_slug": projectSlug },
    );
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: cacheHttpImports DONE`, { projectSlug });

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformReactToLocalPaths START`, {
      projectSlug,
    });
    rewritten = await transformReactToLocalPaths(rewritten);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: transformReactToLocalPaths DONE`, { projectSlug });

    if (!context.projectId) {
      throw INVALID_ARGUMENT.create({
        detail: `Missing projectId for MDX module cache (projectSlug: ${context.projectSlug})`,
      });
    }

    let codeHash = hashString(rewritten);
    const namespaceKey = encodeURIComponent(context.projectId);
    let compositeKey = `${namespaceKey}:${codeHash}`;

    const cached = context.moduleCache.get(compositeKey);
    if (cached) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Module cache hit`, { projectSlug, compositeKey });
      return cached as MDXModule;
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Module cache miss`, { projectSlug, compositeKey });

    const unresolvedMatches = [
      ...rewritten.matchAll(new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g")),
    ];
    if (unresolvedMatches.length > 0) {
      const unresolvedPaths = unresolvedMatches.map((m) => m[1]).slice(0, 5);
      const errorMsg = `MDX has ${unresolvedMatches.length} unresolved module imports: ${
        unresolvedPaths.join(", ")
      }`;
      logger.error(`${LOG_PREFIX_MDX_RENDERER} ${errorMsg}`);
      throw IMPORT_RESOLUTION_ERROR.create({ detail: errorMsg });
    }

    const nsDir = join(esmCacheDir, namespaceKey);
    const localFs = getLocalFs();

    let filePath = join(nsDir, `${codeHash}.mjs`);

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: mdxWriteFlight START`, { projectSlug, filePath });
    await mdxWriteFlight.do(filePath, async () => {
      // Check if file already exists (written by another request)
      if (await verifyCacheFileExists(localFs, filePath, "MDX-ESM-LOADER")) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} File exists, skipping write`, {
          projectSlug,
          filePath,
        });
        return;
      }

      logger.debug(`${LOG_PREFIX_MDX_LOADER} Writing module file`, { projectSlug, filePath });
      const written = await writeCacheFile(localFs, filePath, rewritten, "MDX-ESM-LOADER");
      if (!written) {
        throw BUILD_FAILED.create({ detail: `Failed to write MDX module cache file: ${filePath}` });
      }
    });
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: mdxWriteFlight DONE`, { projectSlug, filePath });

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: dynamic import START`, {
      projectSlug,
      filePath,
      codePreview: rewritten.substring(0, 200),
    });

    setupSSRGlobals();

    // Ensure bare specifiers (e.g. 'react') resolve from cache dir on Node.js
    await ensureCacheNodeModules();

    // Proactively ensure all HTTP bundles exist before import.
    // All modules now use local file:// paths for consistency between
    // compiled and non-compiled modes (shared cache).
    // We use recursive extraction to find bundles imported by VF modules too.
    {
      // Extract HTTP bundles from MDX code AND any VF modules it imports (recursively)
      const bundlePaths = await extractAllHttpBundlePathsRecursive(rewritten);
      if (bundlePaths.length > 0) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Checking HTTP bundles (recursive scan)`, {
          count: bundlePaths.length,
          projectSlug,
        });

        const cacheDir = getHttpBundleCacheDir();
        const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);

        if (failed.length > 0) {
          // Recovery: re-run HTTP caching to re-fetch expired bundles from esm.sh.
          // This happens when distributed cache entries expire (24h TTL) and the local
          // disk files are missing (pod restart / new deployment).
          logger.warn(
            `${LOG_PREFIX_MDX_LOADER} ${failed.length} HTTP bundle(s) missing, re-fetching from network`,
            {
              failed,
              projectSlug,
            },
          );

          const originalFilePath = filePath;
          const refreshResult = await cacheHttpImportsToLocal(rewritten, {
            cacheDir,
            importMap,
          });
          rewritten = refreshResult.code;

          // Re-write the module file with refreshed HTTP bundle paths
          const refreshedHash = hashString(rewritten);
          const refreshedPath = join(nsDir, `${refreshedHash}.mjs`);
          await mdxWriteFlight.do(refreshedPath, async () => {
            const written = await writeCacheFile(
              getLocalFs(),
              refreshedPath,
              rewritten,
              "MDX-ESM-LOADER",
            );
            if (!written) {
              throw BUILD_FAILED.create({
                detail: `Failed to write refreshed MDX module cache file: ${refreshedPath}`,
              });
            }
          });

          filePath = refreshedPath;
          codeHash = refreshedHash;
          compositeKey = `${namespaceKey}:${codeHash}`;

          // Clean up orphaned module file if path changed
          if (refreshedPath !== originalFilePath) {
            getLocalFs().remove(originalFilePath).catch(() => {});
          }

          // Verify bundles exist after re-fetch
          const refreshedBundles = extractHttpBundlePaths(rewritten);
          if (refreshedBundles.length > 0) {
            const stillFailed = await ensureHttpBundlesExist(refreshedBundles, cacheDir);
            if (stillFailed.length > 0) {
              throw BUNDLE_ERROR.create({
                detail: `Failed to recover ${stillFailed.length} HTTP bundle(s) after re-fetch: ${
                  stillFailed.join(", ")
                }`,
              });
            }
          }
        }
      }
    }

    // Check for missing framework bundles (SSR VF modules).
    // These are file:// imports to the framework/ subdirectory that were
    // generated by the SSR VF modules transform. If the distributed cache
    // returns code with stale file:// paths, those files may not exist on this pod.
    const frameworkBundlePaths = extractFrameworkBundlePaths(rewritten);
    if (frameworkBundlePaths.length > 0) {
      const missingBundles = await findMissingFrameworkBundles(frameworkBundlePaths);
      if (missingBundles.length > 0) {
        logger.warn(
          `${LOG_PREFIX_MDX_LOADER} ${missingBundles.length} framework bundle(s) missing, regenerating`,
          {
            projectSlug,
            missing: missingBundles.slice(0, 3),
            total: frameworkBundlePaths.length,
          },
        );

        // Re-run the SSR VF modules transform to regenerate framework bundles.
        // This happens when distributed cache returns code from another pod with different file paths.
        const originalFilePath = filePath;

        // The SSR VF modules plugin only uses a subset of TransformContext fields.
        // We cast to avoid creating unnecessary fields.
        const transformCtx = {
          code: rewritten,
          filePath: filePath,
          projectDir,
          target: "ssr" as const,
          reactVersion: context.reactVersion ?? REACT_DEFAULT_VERSION,
        } as Parameters<typeof ssrVfModulesPlugin.transform>[0];

        rewritten = await ssrVfModulesPlugin.transform(transformCtx);

        // Re-write the module file with regenerated framework bundle paths
        const refreshedHash = hashString(rewritten);
        const refreshedPath = join(nsDir, `${refreshedHash}.mjs`);
        await mdxWriteFlight.do(refreshedPath, async () => {
          const written = await writeCacheFile(
            getLocalFs(),
            refreshedPath,
            rewritten,
            "MDX-ESM-LOADER",
          );
          if (!written) {
            throw BUILD_FAILED.create({
              detail: `Failed to write regenerated MDX module cache file: ${refreshedPath}`,
            });
          }
        });

        filePath = refreshedPath;
        codeHash = refreshedHash;
        compositeKey = `${namespaceKey}:${codeHash}`;

        // Clean up orphaned module file if path changed
        if (refreshedPath !== originalFilePath) {
          getLocalFs().remove(originalFilePath).catch(() => {});
        }

        // Verify bundles now exist
        const stillMissing = await findMissingFrameworkBundles(
          extractFrameworkBundlePaths(rewritten),
        );
        if (stillMissing.length > 0) {
          throw BUNDLE_ERROR.create({
            detail: `Failed to regenerate ${stillMissing.length} framework bundle(s): ${
              stillMissing[0]
            }`,
          });
        }

        logger.debug(`${LOG_PREFIX_MDX_LOADER} Framework bundles regenerated successfully`, {
          projectSlug,
          count: missingBundles.length,
        });
      }
    }

    // Verify the cache file exists before attempting dynamic import
    const fileExists = await verifyCacheFileExists(localFs, filePath, "MDX-ESM-LOADER");
    if (!fileExists) {
      throw CACHE_ERROR.create({
        detail: `MDX module cache file missing before import: ${filePath}`,
      });
    }

    const mod = await withSpan(
      SpanNames.MDX_DYNAMIC_IMPORT,
      () => import(`file://${filePath}?v=${codeHash}`),
      { "mdx.file_path": filePath.split("/").pop() || filePath },
    ) as Record<string, unknown> & { __vfLayout?: React.ComponentType };

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Step: dynamic import DONE`, {
      projectSlug,
      exports: Object.keys(mod),
    });

    const result: MDXModule = {
      ...mod,
      default: mod?.default as React.ComponentType<unknown> | undefined,
      MDXContent: mod?.MDXContent as React.ComponentType<unknown> | undefined,
      frontmatter: mod?.frontmatter as MDXFrontmatter | undefined,
      headings: mod?.headings as Array<{ text: string; level: number }> | undefined,
      title: mod?.title as string | undefined,
      description: mod?.description as string | undefined,
      layout: mod?.layout as string | boolean | React.ComponentType | undefined,
      MDXLayout: (mod?.MDXLayout || mod?.__vfLayout) as React.ComponentType<unknown> | undefined,
      MainLayout: mod?.MainLayout as React.ComponentType<unknown> | undefined,
    };

    context.moduleCache.set(compositeKey, result);

    logger.debug(`${LOG_PREFIX_MDX_LOADER} loadModuleESM completed`, {
      durationMs: (performance.now() - loadStart).toFixed(1),
    });

    return result;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_RENDERER} MDX ESM load failed:`, error);

    // Capture compile error for MCP flywheel
    const errorMsg = error instanceof Error ? error.message : String(error);
    getErrorCollector().addCompileError(errorMsg, context.projectSlug || "mdx");

    throw error;
  }
}
