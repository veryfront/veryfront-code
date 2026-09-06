/**
 * Loader Helpers
 *
 * Helper functions for ESM module loading: cache directory initialization,
 * project directory resolution, framework bundle validation, and VF module
 * import discovery/processing.
 *
 * @module build/transforms/mdx/esm-module-loader/loader-helpers
 */

import { join, toFileUrl } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { exists as fsExists } from "#veryfront/platform/compat/fs.ts";
import { LOG_PREFIX_MDX_LOADER } from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { createStubModule, type DeferredImportErrorDescriptor } from "./utils/stub-module.ts";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
} from "./utils/source-spans.ts";
import { createModuleFetcherContext, fetchAndCacheModule } from "./module-fetcher/index.ts";
import { buildMissingModuleError } from "./missing-module.ts";
import {
  dynamicDependencyFailure,
  toImportStringLiteral,
} from "./module-fetcher/nested-imports.ts";
import type { MdxPreparationContext } from "./types.ts";
import type { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import {
  assertMdxModuleImportCount,
  MAX_MDX_MODULE_IMPORTS_PER_FILE,
  MAX_MDX_MODULE_TRANSFORM_CONCURRENCY,
} from "./module-fetcher/limits.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";

/**
 * Check which framework bundles are missing from disk.
 * Returns the list of missing file paths.
 */
export async function findMissingFrameworkBundles(paths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const path of paths) {
    try {
      if (!(await fsExists(path))) {
        missing.push(path);
      }
    } catch (_) {
      /* expected: file may not exist */
      missing.push(path);
    }
  }
  return missing;
}

export function resolveProjectDir(context: MdxPreparationContext): string {
  if (context.projectDir) return context.projectDir;

  const envProjectDir = context.adapter?.env.get("VERYFRONT_PROJECT_DIR") ??
    context.adapter?.env.get("VF_PROJECT_DIR");
  if (envProjectDir) return envProjectDir;

  throw INVALID_ARGUMENT.create({
    detail:
      "[MDX] projectDir is required for import map resolution. Pass it explicitly to loadModuleESM.",
  });
}

/**
 * Initialize the ESM cache directory.
 * Includes contentSourceId in the path to isolate preview vs production caches.
 */
export async function initializeCacheDir(
  context: MdxPreparationContext,
): Promise<string> {
  if (context.esmCacheDir) return context.esmCacheDir;

  if (!context.projectId) {
    throw INVALID_ARGUMENT.create({
      detail: `Missing projectId for MDX ESM cache directory (projectSlug: ${context.projectSlug})`,
    });
  }
  if (!context.contentSourceId) {
    throw INVALID_ARGUMENT.create({
      detail: `Missing contentSourceId for MDX ESM cache directory (project: ${context.projectId})`,
    });
  }

  const localFs = getLocalFs();
  const baseCacheDir = getMdxEsmCacheDir();
  // Use projectId consistently for stable cache keys (won't change if slug is renamed)
  const projectKey = encodeURIComponent(context.projectId);
  const sourceKey = encodeURIComponent(context.contentSourceId);
  const persistentCacheDir = join(baseCacheDir, projectKey, sourceKey);

  try {
    await localFs.mkdir(persistentCacheDir, { recursive: true });
    context.esmCacheDir = persistentCacheDir;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Using persistent cache dir: ${persistentCacheDir}`);
    return persistentCacheDir;
  } catch (_) {
    /* expected: persistent cache dir may not be writable, fall through to temp dir */
    const tempDir = await localFs.makeTempDir({ prefix: `veryfront-mdx-esm-${projectKey}-` });
    context.esmCacheDir = tempDir;
    return tempDir;
  }
}

/**
 * Find /_vf_modules/ imports in code.
 */
export function findVfModuleImports(
  code: string,
): Array<{
  original: string;
  path: string;
  suffix: string;
  start: number;
  end: number;
  isDynamic?: boolean;
}> {
  const matchVfModule = (specifier: string): string | null =>
    specifier.match(/^\/?(_vf_modules\/.+)$/)?.[1] ?? null;
  const staticImports = findStaticImportFromSpans(
    code,
    matchVfModule,
    MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
  );
  const dynamicImports = findDynamicImportSpans(
    code,
    matchVfModule,
    MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
  ).map((importSpan) => ({ ...importSpan, isDynamic: true }));

  return [...staticImports, ...dynamicImports]
    .map((importSpan) => {
      const { path, suffix } = splitSpecifierSuffix(importSpan.path);
      return { ...importSpan, path, suffix };
    })
    .sort((left, right) => left.start - right.start);
}

/**
 * Process /_vf_modules/ imports and replace them with file:// paths.
 */
export async function processVfModuleImports(
  code: string,
  imports: Array<{
    original: string;
    path: string;
    suffix?: string;
    start: number;
    end: number;
    isDynamic?: boolean;
  }>,
  context: MdxPreparationContext,
  projectDir: string,
  strictMissingModules: boolean,
  sourceCapture?: ModuleSourceCapture,
): Promise<string> {
  const projectSlug = context.projectSlug || "unknown";
  const adapter = context.adapter;

  if (!adapter) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} No adapter available for module fetching`);
    return code;
  }

  logger.debug(`${LOG_PREFIX_MDX_LOADER} processVfModuleImports: found imports`, {
    projectSlug,
    count: imports.length,
    paths: imports.map((i) => i.path).slice(0, 10),
  });

  if (imports.length === 0) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} processVfModuleImports: no imports to process`, {
      projectSlug,
    });
    return code;
  }
  assertMdxModuleImportCount("compiled MDX entry", imports.length);

  if (!context.projectId) {
    throw INVALID_ARGUMENT.create({
      detail: `Missing projectId for module fetching (projectSlug: ${context.projectSlug})`,
    });
  }

  const fetcherContext = createModuleFetcherContext(
    context.esmCacheDir!,
    adapter,
    projectDir,
    context.projectId,
    {
      sourceCapture,
      contentSourceId: context.contentSourceId,
      isLocalProject: context.isLocalProject,
      // The render mode decides the compile mode for every `/_vf_modules/*`
      // import of this compiled-MDX entry. A context without one compiles for
      // production, so a hosted production render never ships unminified,
      // untree-shaken code carrying an inline sourcemap of the project source.
      dev: context.mode === "development",
      reactVersion: context.reactVersion,
      serverExternalPackages: context.serverExternalPackages,
      moduleServerOrigin: context.moduleServerOrigin,
      dependencyPinningCacheKey: context.dependencyPinningCacheKey,
      dependencyPinningDependencies: context.dependencyPinningDependencies,
      dependencyPinningSource: context.dependencyPinningSource,
      projectSlug: context.projectSlug,
      logger: logger.child({
        project_id: context.projectId,
        project_slug: context.projectSlug,
      }),
      strictMissingModules,
    },
  );

  const fetchStart = performance.now();

  const results = await parallelMap(
    imports,
    async ({ original, path, suffix, start, end, isDynamic }, index) => {
      return await withSpan(
        SpanNames.MDX_FETCH_MODULE,
        async () => {
          const moduleStart = performance.now();
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module START`, {
            projectSlug,
            index,
            path,
          });
          let filePath: string | null;
          let deferredError: DeferredImportErrorDescriptor | undefined;
          try {
            filePath = await fetchAndCacheModule(
              sourceCapture ? path + suffix : path,
              fetcherContext,
            );
          } catch (error) {
            if (!isDynamic) throw error;
            deferredError = dynamicDependencyFailure(path, error) ?? undefined;
            if (!deferredError) throw error;
            filePath = null;
          }
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module DONE`, {
            projectSlug,
            index,
            path,
            durationMs: (performance.now() - moduleStart).toFixed(1),
          });
          return { original, start, end, filePath, path, suffix, isDynamic, deferredError };
        },
        {
          "mdx.module_path": path,
          "mdx.module_index": index,
          "mdx.project_slug": projectSlug,
        },
      );
    },
    { concurrency: MAX_MDX_MODULE_TRANSFORM_CONCURRENCY },
  );

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Module fetch phase completed`, {
    projectSlug,
    moduleCount: imports.length,
    durationMs: (performance.now() - fetchStart).toFixed(1),
  });

  const replacements: SourceSpanReplacement[] = [];
  for (
    const { original, start, end, filePath, path, suffix, isDynamic, deferredError } of results
  ) {
    if (filePath) {
      const importTarget = toImportStringLiteral(`${toFileUrl(filePath).href}${suffix ?? ""}`);
      replacements.push({
        start,
        end,
        expected: original,
        replacement: isDynamic ? importTarget : `from ${importTarget}`,
      });
      continue;
    }

    if (isDynamic) {
      const deferredPath = await createStubModule(
        path,
        code,
        original,
        context.esmCacheDir!,
        { failOnImport: strictMissingModules, deferredError, sourceCapture },
      );
      if (deferredPath) {
        replacements.push({
          start,
          end,
          expected: original,
          replacement: toImportStringLiteral(`${toFileUrl(deferredPath).href}${suffix ?? ""}`),
        });
        continue;
      }
    }

    if (strictMissingModules) {
      throw buildMissingModuleError({
        modulePath: path,
        importer: projectSlug,
        importStatement: original,
        code,
        projectSlug,
      });
    }

    const stubPath = await createStubModule(path, code, original, context.esmCacheDir!, {
      sourceCapture,
    });
    if (stubPath) {
      const importTarget = toImportStringLiteral(`${toFileUrl(stubPath).href}${suffix ?? ""}`);
      replacements.push({
        start,
        end,
        expected: original,
        replacement: isDynamic ? importTarget : `from ${importTarget}`,
      });
    }
  }

  return replaceSourceSpans(code, replacements);
}
