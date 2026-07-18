/**
 * Nested import detection and processing for module dependency resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/nested-imports
 */

import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { NestedImportResult } from "../types.ts";
import { createStubModule } from "../utils/stub-module.ts";
import {
  findStaticImportFromSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
} from "../utils/source-spans.ts";
import { buildMissingModuleError } from "../missing-module.ts";
import type { Logger } from "#veryfront/utils";

function matchUnresolvedVfModuleSpecifier(specifier: string): string | null {
  return specifier.match(/^((?:file:\/\/)?\/?\/?_vf_modules\/[^?]+)(?:\?.*)?$/)?.[1] ?? null;
}

/**
 * Find nested module imports in code.
 * Matches both /_vf_modules/... and file:///_vf_modules/... patterns.
 */
export function findNestedImports(
  moduleCode: string,
): {
  vfModules: Array<{ original: string; path: string; start: number; end: number }>;
  relative: Array<{ original: string; path: string; start: number; end: number }>;
} {
  const vfModules: Array<{ original: string; path: string; start: number; end: number }> = [];
  const relative: Array<{ original: string; path: string; start: number; end: number }> = [];

  for (
    const { original, path: rawPath, start, end } of findStaticImportFromSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
    )
  ) {
    // Strip file:// prefix and leading slashes to get clean _vf_modules/... path
    vfModules.push({
      original,
      path: rawPath.replace(/^(?:file:\/\/)?\/+/, ""),
      start,
      end,
    });
  }

  for (
    const { original, path, start, end } of findStaticImportFromSpans(
      moduleCode,
      (specifier) => specifier.match(/^(\.\.?\/[^?]+)(?:\?.*)?$/)?.[1],
    )
  ) {
    relative.push({
      original,
      path,
      start,
      end,
    });
  }

  return { vfModules, relative };
}

/**
 * Check for unresolved /_vf_modules/ imports.
 */
export function hasUnresolvedImports(moduleCode: string): { count: number; paths: string[] } {
  const matches = findStaticImportFromSpans(moduleCode, matchUnresolvedVfModuleSpecifier);
  return {
    count: matches.length,
    paths: matches.map((match) => match.path).slice(0, 5),
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
  const replacements: SourceSpanReplacement[] = [];

  for (const { original, start, end, nestedFilePath, nestedPath, relativePath } of results) {
    if (nestedFilePath) {
      replacements.push({
        start,
        end,
        expected: original,
        replacement: `from "file://${nestedFilePath}"`,
      });
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

    const stubPath = await createStubModule(modulePath, moduleCode, original, esmCacheDir);
    if (stubPath) {
      replacements.push({
        start,
        end,
        expected: original,
        replacement: `from "file://${stubPath}"`,
      });
    }
  }

  return replaceSourceSpans(moduleCode, replacements);
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
  const moduleCode = input.moduleCode;
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
  const allImports = [
    ...vfModules.map((module) => ({ ...module, key: "nestedPath" as const })),
    ...relative.map((module) => ({ ...module, key: "relativePath" as const })),
  ];
  const nestedResults = await Promise.all(
    allImports.map(async ({ original, path, start, end, key }) => ({
      original,
      start,
      end,
      nestedFilePath: await input.fetchAndCacheModule(path, input.normalizedPath),
      [key]: path,
    })),
  );
  input.log?.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules DONE`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    vfMs: (performance.now() - vfStart).toFixed(1),
  });

  input.log?.debug(
    `${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports`,
    {
      projectSlug: input.projectSlug,
      normalizedPath: input.normalizedPath,
      count: relative.length,
    },
  );

  return await processNestedImports(
    moduleCode,
    nestedResults,
    input.esmCacheDir,
    input.strictMissingModules,
    input.normalizedPath,
    input.projectSlug,
  );
}
