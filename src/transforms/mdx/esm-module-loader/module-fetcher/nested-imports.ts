/**
 * Nested import detection and processing for module dependency resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/nested-imports
 */

import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { NestedImportResult } from "../types.ts";
import { createStubModule } from "../utils/stub-module.ts";
import {
  findDynamicImportSpans,
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
  type SourceSpanReplacement,
} from "../utils/source-spans.ts";
import { buildMissingModuleError } from "../missing-module.ts";
import { splitSpecifierSuffix } from "../../../shared/specifier-suffix.ts";
import type { Logger } from "#veryfront/utils";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import {
  assertMdxModuleImportCount,
  MAX_MDX_MODULE_IMPORTS_PER_FILE,
  MAX_MDX_MODULE_TRANSFORM_CONCURRENCY,
} from "./limits.ts";

function matchUnresolvedVfModuleSpecifier(specifier: string): string | null {
  return specifier.match(/^((?:file:\/\/)?\/?\/?_vf_modules\/.+)$/)?.[1] ?? null;
}

type NestedImportSpan = {
  original: string;
  path: string;
  start: number;
  end: number;
  suffix?: string;
  isDynamic?: boolean;
  isSideEffect?: boolean;
};

/**
 * Serialize a resolved module URL as a JavaScript string literal.
 *
 * A preserved suffix is author-controlled text (`?label="x"`, a backslash in a
 * cache path). Wrapping it in quotes by hand emits a module that fails to
 * parse, taking every other import in the file down with it, so every emitted
 * specifier must go through this.
 */
export function toImportStringLiteral(url: string): string {
  return JSON.stringify(url);
}

/**
 * Find nested module imports in code.
 * Matches both /_vf_modules/... and file:///_vf_modules/... patterns.
 */
export function findNestedImports(
  moduleCode: string,
): {
  vfModules: NestedImportSpan[];
  relative: NestedImportSpan[];
} {
  const vfModules: NestedImportSpan[] = [];
  const relative: NestedImportSpan[] = [];

  for (
    const { original, path: rawPath, start, end } of findStaticImportFromSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    )
  ) {
    const { path, suffix } = splitSpecifierSuffix(rawPath.replace(/^(?:file:\/\/)?\/+/, ""));
    // Strip file:// prefix and leading slashes to get clean _vf_modules/... path
    vfModules.push({
      original,
      path,
      suffix,
      start,
      end,
    });
  }

  for (
    const { original, path: rawPath, start, end } of findDynamicImportSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    )
  ) {
    const { path, suffix } = splitSpecifierSuffix(rawPath.replace(/^(?:file:\/\/)?\/+/, ""));
    // Strip file:// prefix and leading slashes to get clean _vf_modules/... path
    vfModules.push({
      original,
      path,
      suffix,
      start,
      end,
      isDynamic: true,
    });
  }

  for (
    const { original, path: rawPath, start, end } of findStaticSideEffectImportSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    )
  ) {
    const { path, suffix } = splitSpecifierSuffix(rawPath.replace(/^(?:file:\/\/)?\/+/, ""));
    // Strip file:// prefix and leading slashes to get clean _vf_modules/... path
    vfModules.push({
      original,
      path,
      suffix,
      start,
      end,
      isSideEffect: true,
    });
  }

  for (
    const { original, path: rawPath, start, end } of findStaticImportFromSpans(
      moduleCode,
      (specifier) => specifier.match(/^(\.\.?\/.+)$/)?.[1],
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    )
  ) {
    const { path, suffix } = splitSpecifierSuffix(rawPath);
    relative.push({
      original,
      path,
      suffix,
      start,
      end,
    });
  }

  for (
    const { original, path: rawPath, start, end } of findDynamicImportSpans(
      moduleCode,
      (specifier) => specifier.match(/^(\.\.?\/.+)$/)?.[1],
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    )
  ) {
    const { path, suffix } = splitSpecifierSuffix(rawPath);
    relative.push({
      original,
      path,
      suffix,
      start,
      end,
      isDynamic: true,
    });
  }

  for (
    const { original, path: rawPath, start, end } of findStaticSideEffectImportSpans(
      moduleCode,
      (specifier) => specifier.match(/^(\.\.?\/.+)$/)?.[1],
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    )
  ) {
    const { path, suffix } = splitSpecifierSuffix(rawPath);
    relative.push({
      original,
      path,
      suffix,
      start,
      end,
      isSideEffect: true,
    });
  }

  return { vfModules, relative };
}

/**
 * Check for unresolved /_vf_modules/ imports.
 */
export function hasUnresolvedImports(moduleCode: string): { count: number; paths: string[] } {
  const matches = [
    ...findStaticImportFromSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    ),
    ...findStaticSideEffectImportSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    ),
    ...findDynamicImportSpans(
      moduleCode,
      matchUnresolvedVfModuleSpecifier,
      MAX_MDX_MODULE_IMPORTS_PER_FILE + 1,
    ),
  ];
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

  for (
    const {
      original,
      start,
      end,
      suffix,
      isDynamic,
      isSideEffect,
      nestedFilePath,
      nestedPath,
      relativePath,
    } of results
  ) {
    if (nestedFilePath) {
      const importTarget = toImportStringLiteral(`file://${nestedFilePath}${suffix ?? ""}`);
      replacements.push({
        start,
        end,
        expected: original,
        replacement: isDynamic
          ? importTarget
          : isSideEffect
          ? `import ${importTarget}`
          : `from ${importTarget}`,
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
      const importTarget = toImportStringLiteral(`file://${stubPath}${suffix ?? ""}`);
      replacements.push({
        start,
        end,
        expected: original,
        replacement: isDynamic
          ? importTarget
          : isSideEffect
          ? `import ${importTarget}`
          : `from ${importTarget}`,
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
  /**
   * Path this module's relative imports resolve against. Defaults to
   * `normalizedPath`; see {@link resolveNestedImportBase}.
   */
  parentBasePath?: string;
}

/**
 * Whether a path names the index module of its directory.
 *
 * The check is on the file name rather than on an extension list: which
 * extensions reach here depends on the resolver in play (the project adapter
 * resolves `.md` as well), and a path can arrive either rewritten to `.js` or
 * still carrying its source extension. A file named `index` is the directory's
 * module however it is spelled.
 */
function namesIndexModule(path: string): boolean {
  const fileName = path.split("/").pop() ?? "";
  return stripFileExtension(fileName) === "index";
}

function stripFileExtension(path: string): string {
  return path.replace(/\.[^./]+$/, "");
}

/**
 * The path a module's own relative imports should resolve against.
 *
 * A directory barrel lives at `lib/index.ts` but is addressed as
 * `_vf_modules/lib`. Resolving its children against `_vf_modules/lib.js` drops
 * the trailing segment as if it were a filename, so `./constants.js` becomes
 * `_vf_modules/constants.js`, one directory too high. The file is then not
 * found and gets replaced by a stub, and the barrel silently stops re-exporting
 * anything: `does not provide an export named 'COLORS'`.
 *
 * When the module actually resolved to an index file, keep the directory
 * segment by addressing it as `<dir>/index.js`. A path that already names its
 * own index file is left alone, whichever extension it carries: appending a
 * second `/index.js` would invent a directory that holds no files at all.
 */
export function resolveNestedImportBase(
  normalizedPath: string,
  actualFilePath?: string,
): string {
  if (!actualFilePath || !namesIndexModule(actualFilePath)) return normalizedPath;
  if (namesIndexModule(normalizedPath)) return normalizedPath;

  return `${stripFileExtension(normalizedPath)}/index.js`;
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
  assertMdxModuleImportCount(input.normalizedPath, allImports.length);

  const nestedResults: NestedImportResult[] = await parallelMap(
    allImports,
    async ({ original, path, suffix, start, end, isDynamic, isSideEffect, key }) => ({
      original,
      start,
      end,
      suffix,
      isDynamic,
      isSideEffect,
      nestedFilePath: await input.fetchAndCacheModule(
        path,
        input.parentBasePath ?? input.normalizedPath,
      ),
      [key]: path,
    }),
    {
      semaphore: new Semaphore(MAX_MDX_MODULE_TRANSFORM_CONCURRENCY),
    },
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
