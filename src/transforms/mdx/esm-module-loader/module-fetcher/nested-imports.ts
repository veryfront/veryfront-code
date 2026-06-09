/**
 * Nested import detection and processing for module dependency resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/nested-imports
 */

import {
  LOG_PREFIX_MDX_LOADER,
  RELATIVE_IMPORT_PATTERN,
  UNRESOLVED_VF_MODULES_PATTERN,
  VF_MODULE_IMPORT_PATTERN,
} from "../constants.ts";
import type { NestedImportResult } from "../types.ts";
import { createStubModule } from "../utils/stub-module.ts";
import { buildMissingModuleError } from "../missing-module.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";

/**
 * Find nested module imports in code.
 * Matches both /_vf_modules/... and file:///_vf_modules/... patterns.
 */
export function findNestedImports(
  moduleCode: string,
): {
  vfModules: Array<{ original: string; path: string }>;
  relative: Array<{ original: string; path: string }>;
} {
  const vfModules: Array<{ original: string; path: string }> = [];
  const relative: Array<{ original: string; path: string }> = [];

  const vfPattern = new RegExp(VF_MODULE_IMPORT_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = vfPattern.exec(moduleCode)) !== null) {
    const rawPath = match[1];
    // Strip file:// prefix and leading slashes to get clean _vf_modules/... path
    if (rawPath) {
      vfModules.push({ original: match[0], path: rawPath.replace(/^(?:file:\/\/)?\/+/, "") });
    }
  }

  const relativePattern = new RegExp(RELATIVE_IMPORT_PATTERN.source, "g");
  while ((match = relativePattern.exec(moduleCode)) !== null) {
    const path = match[1];
    if (path) relative.push({ original: match[0], path });
  }

  return { vfModules, relative };
}

/**
 * Check for unresolved /_vf_modules/ imports.
 */
export function hasUnresolvedImports(moduleCode: string): { count: number; paths: string[] } {
  const pattern = new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g");
  const matches = [...moduleCode.matchAll(pattern)];
  return {
    count: matches.length,
    paths: matches.map((m) => m[1]).filter((p): p is string => p !== undefined).slice(0, 5),
  };
}

/**
 * Process nested imports by replacing them with file:// paths or stub modules.
 */
export async function processNestedImports(
  moduleCode: string,
  results: NestedImportResult[],
  esmCacheDir: string,
  strictMissingModules: boolean,
  parentModulePath?: string,
  projectSlug?: string,
): Promise<string> {
  let result = moduleCode;

  for (const { original, nestedFilePath, nestedPath, relativePath } of results) {
    if (nestedFilePath) {
      result = result.replace(original, `from "file://${nestedFilePath}"`);
      continue;
    }

    const modulePath = nestedPath || relativePath || "";
    if (strictMissingModules) {
      throw buildMissingModuleError({
        modulePath,
        importer: parentModulePath,
        importStatement: original,
        code: moduleCode,
        projectSlug,
      });
    }

    const stubPath = await createStubModule(modulePath, result, original, esmCacheDir);
    if (stubPath) result = result.replace(original, `from "file://${stubPath}"`);
  }

  return result;
}

export interface ResolveNestedModuleImportsInput {
  moduleCode: string;
  esmCacheDir: string;
  normalizedPath: string;
  projectSlug: string;
  strictMissingModules: boolean;
  fetchAndCacheModule: (path: string, parent?: string) => Promise<string | null>;
  log?: Logger;
}

/**
 * Resolve nested /_vf_modules and relative imports into local file:// cache paths.
 */
export async function resolveNestedModuleImports(
  input: ResolveNestedModuleImportsInput,
): Promise<string> {
  let moduleCode = input.moduleCode;
  const { vfModules, relative } = findNestedImports(moduleCode);

  input.log?.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] found nested imports`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    vfModulesCount: vfModules.length,
    relativeCount: relative.length,
    vfModulePaths: vfModules.map((module) => module.path).slice(0, 5),
    relativePaths: relative.map((module) => module.path).slice(0, 5),
  });

  input.log?.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules START`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    count: vfModules.length,
  });
  const vfStart = performance.now();
  const nestedResults = await Promise.all(
    vfModules.map(async ({ original, path }) => ({
      original,
      nestedFilePath: await input.fetchAndCacheModule(path, input.normalizedPath),
      nestedPath: path,
    })),
  );
  input.log?.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules DONE`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    vfMs: (performance.now() - vfStart).toFixed(1),
  });
  moduleCode = await processNestedImports(
    moduleCode,
    nestedResults,
    input.esmCacheDir,
    input.strictMissingModules,
    input.normalizedPath,
    input.projectSlug,
  );

  input.log?.debug(
    `${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports START`,
    {
      projectSlug: input.projectSlug,
      normalizedPath: input.normalizedPath,
      count: relative.length,
    },
  );
  const relStart = performance.now();
  const relativeResults = await Promise.all(
    relative.map(async ({ original, path }) => ({
      original,
      nestedFilePath: await input.fetchAndCacheModule(path, input.normalizedPath),
      relativePath: path,
    })),
  );
  input.log?.debug(
    `${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports DONE`,
    {
      projectSlug: input.projectSlug,
      normalizedPath: input.normalizedPath,
      relMs: (performance.now() - relStart).toFixed(1),
    },
  );
  return await processNestedImports(
    moduleCode,
    relativeResults,
    input.esmCacheDir,
    input.strictMissingModules,
    input.normalizedPath,
    input.projectSlug,
  );
}
