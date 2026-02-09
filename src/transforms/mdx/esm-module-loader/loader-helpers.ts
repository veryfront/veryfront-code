/**
 * Loader Helpers
 *
 * Helper functions for ESM module loading: cache directory initialization,
 * project directory resolution, framework bundle validation, and VF module
 * import discovery/processing.
 *
 * @module build/transforms/mdx/esm-module-loader/loader-helpers
 */

import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { exists as fsExists } from "#veryfront/platform/compat/fs.ts";
import { LOG_PREFIX_MDX_LOADER } from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { createStubModule } from "./utils/stub-module.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "./module-fetcher/index.ts";
import { buildMissingModuleError } from "./missing-module.ts";
import type { ESMLoaderContext } from "./types.ts";

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
    } catch {
      missing.push(path);
    }
  }
  return missing;
}

export function resolveProjectDir(context: ESMLoaderContext): string {
  if (context.projectDir) return context.projectDir;

  const envProjectDir = context.adapter?.env.get("VERYFRONT_PROJECT_DIR") ??
    context.adapter?.env.get("VF_PROJECT_DIR");
  if (envProjectDir) return envProjectDir;

  throw new Error(
    "[MDX] projectDir is required for import map resolution. Pass it explicitly to loadModuleESM.",
  );
}

/**
 * Initialize the ESM cache directory.
 * Includes contentSourceId in the path to isolate preview vs production caches.
 */
export async function initializeCacheDir(context: ESMLoaderContext): Promise<string> {
  if (context.esmCacheDir) return context.esmCacheDir;

  if (!context.projectId) {
    throw new Error(
      `Missing projectId for MDX ESM cache directory (projectSlug: ${context.projectSlug})`,
    );
  }
  if (!context.contentSourceId) {
    throw new Error(
      `Missing contentSourceId for MDX ESM cache directory (project: ${context.projectId})`,
    );
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
  } catch {
    const tempDir = await localFs.makeTempDir({ prefix: `veryfront-mdx-esm-${projectKey}-` });
    context.esmCacheDir = tempDir;
    return tempDir;
  }
}

/**
 * Find /_vf_modules/ imports in code.
 */
export function findVfModuleImports(code: string): Array<{ original: string; path: string }> {
  const imports: Array<{ original: string; path: string }> = [];
  const pattern = /from\s*["'](\/?)(_vf_modules\/[^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const [original, , path] = match;
    if (path) imports.push({ original, path });
  }

  return imports;
}

/**
 * Process /_vf_modules/ imports and replace them with file:// paths.
 */
export async function processVfModuleImports(
  code: string,
  imports: Array<{ original: string; path: string }>,
  context: ESMLoaderContext,
  projectDir: string,
  strictMissingModules: boolean,
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

  if (!context.projectId) {
    throw new Error(
      `Missing projectId for module fetching (projectSlug: ${context.projectSlug})`,
    );
  }

  const fetcherContext = createModuleFetcherContext(
    context.esmCacheDir!,
    adapter,
    projectDir,
    context.projectId,
    {
      reactVersion: context.reactVersion,
      projectSlug: context.projectSlug,
      logger: logger.child({
        project_id: context.projectId,
        project_slug: context.projectSlug,
      }),
      strictMissingModules,
    },
  );

  const fetchStart = performance.now();

  const results = await Promise.all(
    imports.map(async ({ original, path }, index) => {
      return await withSpan(
        SpanNames.MDX_FETCH_MODULE,
        async () => {
          const moduleStart = performance.now();
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module START`, {
            projectSlug,
            index,
            path,
          });
          const filePath = await fetchAndCacheModule(path, fetcherContext);
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Fetching module DONE`, {
            projectSlug,
            index,
            path,
            durationMs: (performance.now() - moduleStart).toFixed(1),
          });
          return { original, filePath, path };
        },
        {
          "mdx.module_path": path,
          "mdx.module_index": index,
          "mdx.project_slug": projectSlug,
        },
      );
    }),
  );

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Module fetch phase completed`, {
    projectSlug,
    moduleCount: imports.length,
    durationMs: (performance.now() - fetchStart).toFixed(1),
  });

  let result = code;
  for (const { original, filePath, path } of results) {
    if (filePath) {
      result = result.replace(original, `from "file://${filePath}"`);
      continue;
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

    const stubPath = await createStubModule(path, result, original, context.esmCacheDir!);
    if (stubPath) result = result.replace(original, `from "file://${stubPath}"`);
  }

  return result;
}
