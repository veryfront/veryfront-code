/**
 * SSR VF Modules Stage - resolves /_vf_modules/_veryfront/ paths to framework source.
 *
 * The SSR import map rewrites "veryfront/head" -> "/_vf_modules/_veryfront/react/components/Head.js?ssr=true"
 * This stage resolves those paths to actual framework source files, transforms them
 * (including React import rewriting), and rewrites imports to file:// paths.
 *
 * This ensures framework components use the same cached React bundles as user code,
 * preventing the "dual React instances" error that causes hooks to fail.
 */

import type { TransformPlugin } from "../../types.ts";
import { TransformStage } from "../../types.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { replaceSpecifiers } from "../../../esm/lexer.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { findRelativeImports, findVfModuleImports } from "./import-finder.ts";
import {
  resolveFrameworkFile,
  resolveRelativeFrameworkImport,
  resolveVeryfrontSourcePath,
} from "./path-resolver.ts";
import {
  cacheTransformedCode,
  isCyclePlaceholder,
  resolveAndTransformVeryfrontImport,
  transformFrameworkSource,
} from "./transform.ts";
import {
  EMBEDDED_SRC_DIR,
  EXTENSIONS,
  FRAMEWORK_LOOKUPS,
  FRAMEWORK_ROOT,
  LOG_PREFIX,
} from "./constants.ts";

// Re-export submodules for external consumers
export { findRelativeImports, findVfModuleImports } from "./import-finder.ts";
export {
  resolveFrameworkFile,
  resolveRelativeFrameworkImport,
  resolveVeryfrontSourcePath,
  tryReadWithExtensions,
} from "./path-resolver.ts";
export {
  cacheTransformedCode,
  isCyclePlaceholder,
  resolveAndTransformVeryfrontImport,
  transformFrameworkCode,
  transformFrameworkSource,
} from "./transform.ts";
export {
  EMBEDDED_SRC_DIR,
  EXTENSIONS,
  FRAMEWORK_LOOKUPS,
  FRAMEWORK_ROOT,
  frameworkFileCache,
  frameworkWriteFlight,
  LOG_PREFIX,
  MAX_RELATIVE_IMPORT_DEPTH,
  type TransformContext,
  transformingFiles,
  veryfrontTransformCache,
} from "./constants.ts";

// Log initialization paths once for debugging
let _initLogged = false;
function logInitOnce(): void {
  if (_initLogged) return;
  _initLogged = true;
  logger.warn(`${LOG_PREFIX} Initialized`, {
    importMetaUrl: import.meta.url,
    frameworkRoot: FRAMEWORK_ROOT,
    embeddedSrcDir: EMBEDDED_SRC_DIR,
  });
}

// Export internal functions for testing
export const _testExports = {
  findVfModuleImports,
  findRelativeImports,
  resolveFrameworkFile,
  resolveRelativeFrameworkImport,
  resolveVeryfrontSourcePath,
  resolveAndTransformVeryfrontImport,
  FRAMEWORK_ROOT,
  EXTENSIONS,
};

export const ssrVfModulesPlugin: TransformPlugin = {
  name: "ssr-vf-modules",
  stage: TransformStage.RESOLVE_ALIASES + 0.5, // Run right after import resolution
  condition: (ctx) => ctx.target === "ssr",

  async transform(ctx) {
    logInitOnce();

    const vfModuleImports = findVfModuleImports(ctx.code);
    logger.debug(`${LOG_PREFIX} Transform called`, {
      file: ctx.filePath?.slice(-60) ?? "<unknown>",
      count: vfModuleImports.length,
      imports: vfModuleImports.slice(0, 5),
    });

    if (vfModuleImports.length === 0) return ctx.code;

    logger.debug(`${LOG_PREFIX} Found ${vfModuleImports.length} /_vf_modules/ imports`, {
      file: ctx.filePath?.slice(-60) ?? "<unknown>",
      imports: vfModuleImports,
      frameworkRoot: FRAMEWORK_ROOT,
    });

    const fs = createFileSystem();
    const replacements = new Map<string, string>();

    for (const vfModulePath of vfModuleImports) {
      try {
        logger.debug(`${LOG_PREFIX} Resolving framework file`, {
          vfModulePath,
          frameworkRoot: FRAMEWORK_ROOT,
          embeddedSrcDir: EMBEDDED_SRC_DIR,
        });

        const resolved = await resolveFrameworkFile(vfModulePath, fs);
        if (!resolved) {
          logger.warn(`${LOG_PREFIX} Could not resolve ${vfModulePath}`, {
            frameworkRoot: FRAMEWORK_ROOT,
            lookups: FRAMEWORK_LOOKUPS.map(([prefix, dir]) => ({ prefix, dir })),
          });
          continue;
        }

        logger.debug(`${LOG_PREFIX} Resolved framework file`, {
          vfModulePath,
          sourcePath: resolved.sourcePath,
          contentLength: resolved.content.length,
        });

        const transformed = await transformFrameworkSource(
          resolved.content,
          resolved.sourcePath,
          ctx.reactVersion ?? REACT_DEFAULT_VERSION,
          ctx.projectDir,
          fs,
        );

        // Skip cycle placeholders - don't cache or use them
        if (isCyclePlaceholder(transformed)) {
          logger.warn(`${LOG_PREFIX} Cycle detected for ${vfModulePath}, skipping cache`);
          continue;
        }

        const cachePath = await cacheTransformedCode(transformed, vfModulePath, fs);
        replacements.set(vfModulePath, `file://${cachePath}`);

        logger.debug(`${LOG_PREFIX} Transformed ${vfModulePath} -> file://${cachePath}`);
      } catch (error) {
        logger.error(`${LOG_PREFIX} Failed to transform ${vfModulePath}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    if (replacements.size === 0) return ctx.code;

    return replaceSpecifiers(ctx.code, (specifier) => replacements.get(specifier) ?? null);
  },
};
