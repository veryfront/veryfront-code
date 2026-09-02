/**
 * Import Transformer
 *
 * Functions for rewriting and transforming import specifiers in MDX compiled code.
 * Handles project aliases, React paths, JSX transforms, and import map resolution.
 *
 * @module build/transforms/mdx/esm-module-loader/import-transformer
 */

import { join } from "#veryfront/compat/path";
import { SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { getLocalReactPaths, isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { DependencyResolutionObservation } from "#veryfront/transforms/import-rewriter/dependency-resolution.ts";
import { assertNoConfiguredCommonJsBrowserImports } from "#veryfront/transforms/import-rewriter/commonjs-policy.ts";
import {
  bareStrategy,
  UnifiedImportRewriter,
} from "#veryfront/transforms/import-rewriter/index.ts";
import type { ImportRewriteStrategy } from "#veryfront/transforms/import-rewriter/index.ts";
import { isNodeBuiltinSpecifier } from "#veryfront/transforms/import-rewriter/node-builtins.ts";
import { appendSameOriginSSRDependencyPinningPathKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  describeServerExternalBrowserViolation,
  getConfiguredServerExternalPackage,
} from "#veryfront/transforms/shared/server-only-packages.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { parseImports, replaceSpecifiers } from "../../esm/lexer.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  FRAMEWORK_ROOT,
  LOG_PREFIX_MDX_LOADER,
} from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { buildMdxJsxCacheFileName, buildMdxJsxCacheFileNamePrefix } from "./cache-format.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";
import {
  assertMdxModuleImportCount,
  assertMdxModuleSourceSize,
  MAX_MDX_MODULE_CODE_BYTES,
  MAX_MDX_MODULE_TRANSFORM_CONCURRENCY,
  ModuleSourceLimitError,
  utf8ByteLength,
} from "./module-fetcher/limits.ts";
import { ensureCachedJsxModulePatched } from "./jsx-cache.ts";
import type { ESMLoaderContext } from "./types.ts";

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/;

const mdxRootBareDependencyStrategy: ImportRewriteStrategy = {
  name: "mdx-root-bare-dependency",
  priority: bareStrategy.priority,
  matches(specifier, ctx) {
    const hasNonNpmScheme = URI_SCHEME_PATTERN.test(specifier) &&
      !specifier.startsWith("npm:");
    return !hasNonNpmScheme &&
      !isNodeBuiltinSpecifier(specifier) &&
      bareStrategy.matches(specifier, ctx);
  },
  rewrite(info, ctx) {
    return bareStrategy.rewrite(info, ctx);
  },
};

const mdxRootDependencyRewriter = new UnifiedImportRewriter({
  strategies: [mdxRootBareDependencyStrategy],
});

/**
 * Rewrite @/ aliased imports to /_vf_modules/ paths.
 */
export async function rewriteProjectAliasImports(code: string): Promise<string> {
  return await replaceSpecifiers(code, (specifier) => {
    if (!specifier.startsWith("@/")) return null;
    const path = specifier.slice(2);
    const jsPath = path.endsWith(".js") ? path : `${path}.js`;
    return `/_vf_modules/${jsPath}`;
  });
}

/**
 * Transform bare React specifiers to local file:// paths for Bun/Node.
 * This ensures the same React instance as react-dom-server.
 * For Deno, getLocalReactPaths() returns an empty object, so this is a no-op.
 */
export async function transformReactToLocalPaths(code: string): Promise<string> {
  const localPaths = getLocalReactPaths();
  if (Object.keys(localPaths).length === 0) return code;

  return await replaceSpecifiers(code, (specifier) => localPaths[specifier] || null);
}

function stripReactFromImportMap(importMap: ImportMapConfig): ImportMapConfig {
  const imports = importMap.imports ? { ...importMap.imports } : undefined;
  if (imports) {
    for (const key of Object.keys(imports)) {
      if (isReactSpecifier(key)) delete imports[key];
    }
  }

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => {
        const filtered = { ...mappings };
        for (const key of Object.keys(filtered)) {
          if (isReactSpecifier(key)) delete filtered[key];
        }
        return [scope, filtered];
      }),
    )
    : undefined;

  return { imports, scopes };
}

/**
 * Transform imports using project import maps.
 * React is intentionally left as a bare specifier for SSR consistency.
 */
export function transformImports(code: string, importMap: ImportMapConfig): string {
  return transformImportsWithMap(code, stripReactFromImportMap(importMap), undefined, {
    resolveBare: true,
  });
}

export interface MdxRootDependencyRewriteOptions {
  projectDir: string;
  projectId: string;
  reactVersion: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  serverExternalPackages?: readonly string[];
  onDependencyResolutionObserved?: (
    observation: DependencyResolutionObservation,
  ) => void;
}

async function assertNoConfiguredServerExternalImports(
  code: string,
  options: MdxRootDependencyRewriteOptions,
): Promise<void> {
  if (options.serverExternalPackages === undefined) return;
  const sourceModule = `${options.projectDir}/__veryfront_mdx_root__.mjs`;

  for (const imported of await parseImports(code)) {
    const specifier = imported.n;
    if (!specifier) continue;
    const configuredPackage = getConfiguredServerExternalPackage(
      specifier,
      options.serverExternalPackages,
    );
    if (configuredPackage === undefined) continue;

    const violation = describeServerExternalBrowserViolation(
      specifier,
      sourceModule,
      options.projectDir,
    );
    throw SERVER_ONLY_IN_CLIENT.create({
      message: violation.message,
      detail:
        `Declared server external package reached an MDX browser transform: ${configuredPackage}`,
      instance: violation.sourceIdentity,
      context: { packageName: configuredPackage },
    });
  }
}

/**
 * Apply the existing MDX import-map behavior first, then pin remaining bare
 * dependencies with the parser-backed import rewriter. Flag-off code keeps
 * its pre-pinning identity and React remains owned by the existing MDX path.
 */
export async function rewriteMdxRootDependencyImports(
  code: string,
  importMap: ImportMapConfig,
  options: MdxRootDependencyRewriteOptions,
): Promise<string> {
  await assertNoConfiguredServerExternalImports(code, options);

  const importMapped = transformImports(code, importMap);
  await assertNoConfiguredServerExternalImports(importMapped, options);
  await assertNoConfiguredCommonJsBrowserImports(importMapped, {
    filePath: `${options.projectDir}/__veryfront_mdx_root__.mjs`,
    projectDir: options.projectDir,
    serverExternalPackages: options.serverExternalPackages,
  });
  if (!options.dependencyPinningCacheKey?.startsWith("on:")) return importMapped;

  return await mdxRootDependencyRewriter.rewrite(importMapped, {
    filePath: `${options.projectDir}/__veryfront_mdx_root__.mjs`,
    projectDir: options.projectDir,
    projectId: options.projectId,
    target: "browser",
    dev: false,
    reactVersion: options.reactVersion,
    dependencyPinningCacheKey: options.dependencyPinningCacheKey,
    dependencyPinningDependencies: options.dependencyPinningDependencies,
    dependencyPinningSource: options.dependencyPinningSource,
    serverExternalPackages: options.serverExternalPackages,
    onDependencyResolutionObserved: options.onDependencyResolutionObserved,
  });
}

export async function pinSameOriginSSRModuleImports(
  code: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): Promise<string> {
  if (!dependencyPinningCacheKey?.startsWith("on:") || !moduleServerOrigin) return code;

  return await replaceSpecifiers(code, (specifier) => {
    const pinned = appendSameOriginSSRDependencyPinningPathKey(
      specifier,
      dependencyPinningCacheKey,
      moduleServerOrigin,
    );
    return pinned === specifier ? null : pinned;
  });
}

async function hasReactImport(code: string): Promise<boolean> {
  const imports = await parseImports(code);
  return imports.some((importSpecifier) => importSpecifier.n === "react");
}

/**
 * Read one project JSX/TSX source without materializing more than the
 * MDX module source limit.
 *
 * Project source is tenant-controlled, and every render of a page that imports
 * it pays a full read plus a content hash before the cache can be consulted.
 * Bounding the read here keeps an oversized file from turning that lookup into
 * unbounded memory, CPU and I/O, the same ceiling `fetchAndCacheModule`
 * already enforces on the modules it resolves.
 */
async function readProjectJsxSourceWithinLimit(
  fs: NonNullable<ESMLoaderContext["adapter"]>["fs"],
  filePath: string,
): Promise<string> {
  if (fs.readFileBytesBounded) {
    // One byte past the ceiling distinguishes an exactly-sized file from an
    // oversized one without reading the rest of an oversized file.
    const bytes = await fs.readFileBytesBounded(filePath, MAX_MDX_MODULE_CODE_BYTES + 1);
    assertMdxModuleSourceSize(filePath, bytes.byteLength);
    return new TextDecoder().decode(bytes);
  }

  const raw = await fs.readFile(filePath);
  const sourceCode = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  assertMdxModuleSourceSize(filePath, utf8ByteLength(sourceCode));
  return sourceCode;
}

/**
 * Drop the cached artifacts left by earlier content variants of one source path.
 *
 * Artifact names are content-keyed, so a project that keeps changing the same
 * path would otherwise accumulate one persistent `jsx-*.mjs` file per variant
 * in the shared cache directory. Keeping only the artifact just written bounds
 * that growth to the project's current source.
 */
async function pruneSupersededJsxArtifacts(
  esmCacheDir: string,
  filePath: string,
  currentFileName: string,
): Promise<void> {
  const prefix = buildMdxJsxCacheFileNamePrefix(filePath);
  const localFs = getLocalFs();

  try {
    for await (const entry of localFs.readDir(esmCacheDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith(prefix) || entry.name === currentFileName) continue;

      try {
        await localFs.remove(join(esmCacheDir, entry.name));
      } catch (_) {
        /* expected: a concurrent transform may have removed the variant already */
      }
    }
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to prune superseded JSX cache artifacts`, {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Transform JSX/TSX imports using esbuild.
 * Optimized to process all imports in parallel batches for better performance.
 */
export async function transformJsxImports(
  code: string,
  adapter: ESMLoaderContext["adapter"],
  esmCacheDir: string,
): Promise<string> {
  const { transform } = await import("veryfront/extensions/bundler");

  const importsToProcess: Array<{
    specifier: string;
    filePath: string;
    ext: string;
  }> = [];

  const imports = await parseImports(code);
  for (const importSpecifier of imports) {
    const specifier = importSpecifier.n;
    if (!specifier?.startsWith("file://")) continue;

    const filePath = specifier.slice("file://".length);
    const ext = filePath.match(/\.(tsx?|jsx?)$/)?.[1];
    if (!ext) continue;

    importsToProcess.push({ specifier, filePath, ext });
  }

  if (importsToProcess.length === 0) return code;
  assertMdxModuleImportCount("compiled MDX JSX imports", importsToProcess.length);

  const transformStart = performance.now();
  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Transforming ${importsToProcess.length} JSX imports in parallel`,
  );

  const transformResults = await parallelMap(
    importsToProcess,
    async ({ specifier, filePath, ext }) => {
      try {
        const isFrameworkFile = filePath.startsWith(FRAMEWORK_ROOT);
        let sourceCode: string;
        if (isFrameworkFile) {
          sourceCode = await getLocalFs().readTextFile(filePath);
        } else if (adapter) {
          sourceCode = await readProjectJsxSourceWithinLimit(adapter.fs, filePath);
        } else {
          logger.warn(
            `${LOG_PREFIX_MDX_LOADER} No adapter available to read JSX file: ${filePath}`,
          );
          return null;
        }

        const transformedFileName = buildMdxJsxCacheFileName(filePath, sourceCode);
        const transformedPath = join(esmCacheDir, transformedFileName);

        try {
          const stat = await getLocalFs().stat(transformedPath);
          if (stat?.isFile) {
            const useCached = await ensureCachedJsxModulePatched(transformedPath, filePath);
            if (useCached) {
              return {
                specifier,
                replacement: `file://${transformedPath}`,
                cached: true,
              };
            }
          }
        } catch (_) {
          /* expected: cached JSX module may not exist yet */
        }

        const loaderMap: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
          tsx: "tsx",
          ts: "ts",
          jsx: "jsx",
          js: "js",
        };
        const loader = loaderMap[ext] ?? "tsx";

        const result = await transform(sourceCode, {
          loader,
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        let transformed = result.code;
        if (!(await hasReactImport(transformed))) {
          transformed = `import React from 'react';\n${transformed}`;
        }

        // Rewrite _dnt.polyfills.js / _dnt.shims.js relative imports to absolute file:// paths.
        // Framework files from the npm package contain relative dnt imports that resolve
        // incorrectly when cached to a different directory.
        transformed = await rewriteDntImports(transformed, filePath);

        await getLocalFs().writeTextFile(transformedPath, transformed);
        await pruneSupersededJsxArtifacts(esmCacheDir, filePath, transformedFileName);

        return {
          specifier,
          replacement: `file://${transformedPath}`,
          cached: false,
        };
      } catch (error) {
        // An oversized source is an admission failure, not a transform that can
        // be skipped: surface it the way the other MDX module limits do instead
        // of leaving an untransformed file:// specifier behind.
        if (error instanceof ModuleSourceLimitError) throw error;
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
        return null;
      }
    },
    { semaphore: new Semaphore(MAX_MDX_MODULE_TRANSFORM_CONCURRENCY) },
  );

  logger.debug(`${LOG_PREFIX_MDX_LOADER} JSX transform phase completed`, {
    total: importsToProcess.length,
    success: transformResults.filter(Boolean).length,
    cached: transformResults.filter((r) => r?.cached).length,
    durationMs: (performance.now() - transformStart).toFixed(1),
  });

  const replacements = new Map<string, string>();
  for (const t of transformResults) {
    if (t) replacements.set(t.specifier, t.replacement);
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
