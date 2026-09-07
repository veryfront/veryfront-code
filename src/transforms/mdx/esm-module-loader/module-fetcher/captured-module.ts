import { join, resolve, toFileUrl } from "#veryfront/compat/path";
import { runPipeline } from "#veryfront/transforms/pipeline/index.ts";
import { cacheHttpImportsToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import type { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { inferFilenameDefaultExportName } from "#veryfront/modules/loader-shared/filename-default-export.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import type { ModuleFetcherContext } from "../types.ts";
import { resolveModuleFile } from "../resolution/file-finder.ts";
import { frameworkSourceKeyOf } from "../resolution/module-path.ts";
import { DENO_CONFIG_STUB_CODE } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { FRAMEWORK_ROOT } from "#veryfront/platform/compat/framework-source-resolver.ts";
import {
  captureFrameworkReader,
  publishedRuntimeHelperPath,
  resolveCapturedFrameworkReference,
} from "./framework-capture.ts";
import { resolveNestedImportBase, resolveNestedModuleImports } from "./nested-imports.ts";
import { MAX_MDX_MODULE_CODE_BYTES, ModuleSourceLimitError } from "./limits.ts";
import {
  captureBoundedTextReader,
  captureSnapshotTextReader,
} from "#veryfront/platform/adapters/bounded-text-reader.ts";

/** Validate source references before resolvers emit their owned file URLs. */
export async function assertLogicalCaptureImports(
  code: string,
  allowRelative: boolean,
): Promise<void> {
  for (const imported of await parseImports(code)) {
    const specifier = imported.n;
    if (!specifier) continue;
    if (
      /^file:/i.test(specifier) ||
      (specifier.startsWith("/") && !specifier.startsWith("/_vf_modules/")) ||
      (!allowRelative && (specifier.startsWith("./") || specifier.startsWith("../")))
    ) {
      throw BUILD_FAILED.create({
        detail: "Unscoped file import in captured source. Use project module references.",
      });
    }
  }
}

function captureProjectReader(context: ModuleFetcherContext): (path: string) => Promise<string> {
  const fs = context.adapter.fs;
  if (Object.getOwnPropertyDescriptor(fs, "symlinkSemantics")?.value === "none") {
    const reader = captureBoundedTextReader(fs);
    return async (path) =>
      (await reader.readUtf8(path, MAX_MDX_MODULE_CODE_BYTES, "Project module")).content;
  }
  const reader = captureSnapshotTextReader(fs);
  return async (path) =>
    (await reader.readUtf8(
      resolve(context.projectDir, path),
      context.projectDir,
      MAX_MDX_MODULE_CODE_BYTES,
      "Project module",
    )).content;
}

/**
 * Capture a source admitted by the project resolver, without consulting the
 * legacy executable-path cache or following file URLs from compiled code.
 * Compilation caches retain logical references; every preparation resolves
 * those references again through the same scoped resolver and HTTP guard.
 */
export async function captureResolvedModule(
  normalizedPath: string,
  context: ModuleFetcherContext,
  fetchDependency: (path: string, parent?: string) => Promise<string | null>,
  capture: ModuleSourceCapture,
  importSuffix = "",
): Promise<string | null> {
  if (frameworkSourceKeyOf(normalizedPath) === "_deno-config.js") {
    const id = await computeHash(JSON.stringify(["framework-config"]));
    const path = join(context.esmCacheDir, `captured-${id}.mjs`);
    capture.record(toFileUrl(path).href, DENO_CONFIG_STUB_CODE);
    return path;
  }
  const frameworkKey = frameworkSourceKeyOf(normalizedPath);
  const frameworkReader = captureFrameworkReader();
  let projectReader: ReturnType<typeof captureProjectReader> | undefined;
  let resolved;
  try {
    const helperPath = frameworkKey === null ? undefined : publishedRuntimeHelperPath(frameworkKey);
    resolved = helperPath
      ? {
        actualFilePath: helperPath,
        sourceCode: (await frameworkReader.readUtf8(
          helperPath,
          FRAMEWORK_ROOT,
          MAX_MDX_MODULE_CODE_BYTES,
          "Framework helper",
        )).content,
      }
      : await resolveModuleFile(normalizedPath, context.adapter, context.projectDir, {
        project: (path) => {
          projectReader ??= captureProjectReader(context);
          return projectReader(path);
        },
        framework: async (path, root) =>
          (await frameworkReader.readUtf8(
            path,
            root,
            MAX_MDX_MODULE_CODE_BYTES,
            "Framework module",
          ))
            .content,
      });
  } catch (error) {
    if (error instanceof TypeError && error.cause instanceof RangeError) {
      // The bounded reader establishes an overflow, not the complete file size.
      throw new ModuleSourceLimitError(
        normalizedPath,
        MAX_MDX_MODULE_CODE_BYTES + 1,
        MAX_MDX_MODULE_CODE_BYTES,
      );
    }
    throw error;
  }
  if (!resolved) return null;
  const importMap = await loadImportMap(context.projectDir, context.adapter);
  const compiled = await runPipeline(
    resolved.sourceCode,
    resolved.actualFilePath,
    context.projectDir,
    {
      projectId: context.projectId,
      ssr: true,
      dev: context.dev === true,
      reactVersion: context.reactVersion,
      serverExternalPackages: context.serverExternalPackages,
      moduleServerOrigin: context.moduleServerOrigin,
      dependencyPinningCacheKey: context.dependencyPinningCacheKey,
      dependencyPinningDependencies: context.dependencyPinningDependencies,
      dependencyPinningSource: context.dependencyPinningSource,
      preloadedImportMap: importMap,
    },
    { ssrImports: "references" },
  );
  await assertLogicalCaptureImports(compiled.code, true);
  const cachedHttp = await cacheHttpImportsToLocal(compiled.code, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
    reactVersion: context.reactVersion,
    serverExternalPackages: context.serverExternalPackages,
    moduleServerOrigin: context.moduleServerOrigin,
    dependencyPinningCacheKey: context.dependencyPinningCacheKey,
  }, capture);
  const linked = await resolveNestedModuleImports({
    moduleCode: cachedHttp.code,
    esmCacheDir: context.esmCacheDir,
    normalizedPath,
    parentBasePath: resolveNestedImportBase(normalizedPath, resolved.actualFilePath),
    projectSlug: context.projectSlug ?? "unknown",
    strictMissingModules: context.strictMissingModules ?? true,
    fetchAndCacheModule: (path, parent) => {
      const frameworkReference = frameworkKey === null
        ? undefined
        : resolveCapturedFrameworkReference(path, resolved.actualFilePath);
      return fetchDependency(frameworkReference ?? path, parent);
    },
    sourceCapture: capture,
    log: context.logger,
  });
  const id = await computeHash(JSON.stringify(["file", resolved.actualFilePath]));
  // An identifier for the linker, not a published file or a legacy path-cache entry.
  const path = join(context.esmCacheDir, `captured-${id}.mjs`);
  const url = toFileUrl(path).href;
  capture.record(url, linked);
  const defaultName = inferFilenameDefaultExportName(normalizedPath, linked);
  if (!defaultName) return path;
  // Logical names may infer different defaults for the same source. Re-export
  // the canonical module so aliases share its evaluation and live bindings.
  const aliasId = await computeHash(
    JSON.stringify(["file-default", resolved.actualFilePath, defaultName, importSuffix]),
  );
  const aliasPath = join(context.esmCacheDir, `captured-${aliasId}.mjs`);
  const quotedUrl = JSON.stringify(url + importSuffix);
  capture.record(
    toFileUrl(aliasPath).href,
    `export * from ${quotedUrl};\nexport { ${defaultName} as default } from ${quotedUrl};\n`,
  );
  return aliasPath;
}
