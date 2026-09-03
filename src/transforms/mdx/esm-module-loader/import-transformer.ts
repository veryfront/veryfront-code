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
import { sanitizePathForDisplay } from "#veryfront/security/path-validation.ts";
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
  isFrameworkSourceFile,
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
 * Name a project source in an error without disclosing where it lives on disk.
 *
 * `filePath` is the absolute path lifted out of a `file://` import, and the
 * limit error it feeds reaches the loader's error log and the compile-error
 * collector. Project-relative identity is what a project author can act on;
 * the deployment layout above the project root is not theirs to see.
 */
function describeProjectSource(filePath: string, projectDir?: string): string {
  const relative = projectDir ? sanitizePathForDisplay(filePath, projectDir) : "";
  if (relative) return relative;
  return filePath.split(/[\\/]/).at(-1) || "project source";
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
 *
 * The strict reader is preferred over the prefix reader: adapters whose store
 * has a whole-object ceiling far above this limit (Cloudflare KV admits 25 MiB)
 * implement `readFileBytesWithinLimit` and not `readFileBytesBounded`, so
 * without this order those runtimes would fall through to `readFile` and
 * materialize the very payload the limit exists to refuse.
 */
async function readProjectJsxSourceWithinLimit(
  fs: NonNullable<ESMLoaderContext["adapter"]>["fs"],
  filePath: string,
  sourceIdentity: string,
): Promise<string> {
  if (fs.readFileBytesWithinLimit) {
    try {
      const bytes = await fs.readFileBytesWithinLimit(filePath, MAX_MDX_MODULE_CODE_BYTES);
      return new TextDecoder().decode(bytes);
    } catch (error) {
      // The contract for this capability is to reject an oversized source with
      // a RangeError rather than report its size, so the size stays unknown.
      if (error instanceof RangeError) {
        throw new ModuleSourceLimitError(sourceIdentity, undefined, MAX_MDX_MODULE_CODE_BYTES);
      }
      throw error;
    }
  }

  if (fs.readFileBytesBounded) {
    // One byte past the ceiling distinguishes an exactly-sized file from an
    // oversized one without reading the rest of an oversized file.
    const bytes = await fs.readFileBytesBounded(filePath, MAX_MDX_MODULE_CODE_BYTES + 1);
    assertMdxModuleSourceSize(sourceIdentity, bytes.byteLength);
    return new TextDecoder().decode(bytes);
  }

  const raw = await fs.readFile(filePath);
  const sourceCode = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  assertMdxModuleSourceSize(sourceIdentity, utf8ByteLength(sourceCode));
  return sourceCode;
}

/**
 * Cached content variants retained per source path.
 *
 * Deleting every variant but the one this pass wrote is not safe: a render
 * that transformed an older generation of the same path is still holding the
 * `file://` specifier of its own artifact, and deleting it breaks that render's
 * module load. The window is sized above the default per-project request
 * ceiling (`maxConcurrentPerProject`, 20) so ordinary concurrency never reaches
 * it, and {@link JSX_CACHE_VARIANT_MIN_AGE_MS} is what actually guarantees an
 * in-flight artifact survives when that ceiling is raised.
 */
export const MAX_JSX_CACHE_VARIANTS_PER_PATH = 32;

/**
 * Age an artifact must reach before it can be retired.
 *
 * A retention count alone assumes concurrency stays below the window. This
 * floor removes the assumption: an artifact a transform just returned is by
 * definition younger than the grace period, so no prune pass can delete it
 * before the render that owns it has imported it, no matter how many renders
 * of the same path are in flight.
 */
export const JSX_CACHE_VARIANT_MIN_AGE_MS = 60_000;

async function readArtifactModifiedAtMs(path: string): Promise<number> {
  try {
    return (await getLocalFs().stat(path)).mtime?.getTime() ?? 0;
  } catch (_) {
    /* expected: a concurrent transform may have removed the variant already */
    return 0;
  }
}

/**
 * Retire the oldest cached content variants of the source paths just written.
 *
 * Artifact names are content-keyed, so a project that keeps changing the same
 * path would otherwise accumulate one persistent `jsx-*.mjs` file per variant.
 *
 * One pass covers every path written by a transform: the directory holds the
 * artifacts of a whole content source, so scanning it once per import (up to
 * the 500-import ceiling) would make the cleanup itself the amplifier it is
 * meant to prevent. Each entry is matched by slicing its own name to a prefix
 * length and looking that up, so the pass stays linear in directory entries
 * rather than multiplying them by the number of paths written.
 */
async function pruneSupersededJsxArtifacts(
  esmCacheDir: string,
  writtenArtifacts: ReadonlyMap<string, string>,
  nowMs: number = Date.now(),
): Promise<void> {
  if (writtenArtifacts.size === 0) return;

  const localFs = getLocalFs();
  const variantsByPrefix = new Map<string, { current: string; superseded: string[] }>();
  for (const [filePath, currentFileName] of writtenArtifacts) {
    variantsByPrefix.set(buildMdxJsxCacheFileNamePrefix(filePath), {
      current: currentFileName,
      superseded: [],
    });
  }
  // Prefixes are fixed-width by construction; collecting the distinct lengths
  // keeps the lookup correct without assuming the name format never changes.
  const prefixLengths = [...new Set([...variantsByPrefix.keys()].map((p) => p.length))];

  try {
    for await (const entry of localFs.readDir(esmCacheDir)) {
      if (!entry.isFile) continue;
      for (const length of prefixLengths) {
        const variants = variantsByPrefix.get(entry.name.slice(0, length));
        if (!variants) continue;
        if (entry.name !== variants.current) variants.superseded.push(entry.name);
        break;
      }
    }
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to scan JSX cache artifacts for pruning`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const variants of variantsByPrefix.values()) {
    // The artifact just written always counts against the retention window.
    if (variants.superseded.length < MAX_JSX_CACHE_VARIANTS_PER_PATH) continue;

    const dated = await Promise.all(
      variants.superseded.map(async (name) => ({
        name,
        modifiedAtMs: await readArtifactModifiedAtMs(join(esmCacheDir, name)),
      })),
    );
    dated.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

    for (const { name, modifiedAtMs } of dated.slice(MAX_JSX_CACHE_VARIANTS_PER_PATH - 1)) {
      if (nowMs - modifiedAtMs < JSX_CACHE_VARIANT_MIN_AGE_MS) continue;
      try {
        await localFs.remove(join(esmCacheDir, name));
      } catch (_) {
        /* expected: a concurrent transform may have removed the variant already */
      }
    }
  }
}

/**
 * Reachable for the cache-retention and redaction tests, which need to drive
 * the prune pass and the source identity directly rather than through a full
 * JSX transform.
 */
export const __importTransformerInternals = {
  describeProjectSource,
  isFrameworkSourceFile,
  pruneSupersededJsxArtifacts,
  readArtifactModifiedAtMs,
};

/**
 * Transform JSX/TSX imports using esbuild.
 * Optimized to process all imports in parallel batches for better performance.
 */
export async function transformJsxImports(
  code: string,
  adapter: ESMLoaderContext["adapter"],
  esmCacheDir: string,
  projectDir?: string,
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

  /** Source path to the artifact name this pass wrote, for one prune pass. */
  const writtenArtifacts = new Map<string, string>();
  /**
   * An oversized source rejects the whole transform, but `parallelMap` runs on
   * `Promise.all`, which does not cancel siblings. Throwing out of the callback
   * would return the error while those siblings kept writing artifacts that no
   * prune pass ever followed, so the failure is carried out instead and rethrown
   * once every callback has settled and the cleanup has run.
   */
  let admissionFailure: ModuleSourceLimitError | undefined;

  const transformResults = await parallelMap(
    importsToProcess,
    async ({ specifier, filePath, ext }) => {
      try {
        // Only the framework's own source roots read through the unbounded
        // local filesystem: a project can live beneath FRAMEWORK_ROOT, and its
        // source has to go through the adapter that enforces the size limit.
        const isFrameworkFile = isFrameworkSourceFile(filePath) ||
          (filePath.startsWith(FRAMEWORK_ROOT) && filePath.includes("/node_modules/"));
        let sourceCode: string;
        if (isFrameworkFile) {
          sourceCode = await getLocalFs().readTextFile(filePath);
        } else if (adapter) {
          sourceCode = await readProjectJsxSourceWithinLimit(
            adapter.fs,
            filePath,
            describeProjectSource(filePath, projectDir),
          );
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
        writtenArtifacts.set(filePath, transformedFileName);

        return {
          specifier,
          replacement: `file://${transformedPath}`,
          cached: false,
        };
      } catch (error) {
        // An oversized source is an admission failure, not a transform that can
        // be skipped: surface it the way the other MDX module limits do instead
        // of leaving an untransformed file:// specifier behind.
        if (error instanceof ModuleSourceLimitError) {
          admissionFailure ??= error;
          return null;
        }
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
        return null;
      }
    },
    { semaphore: new Semaphore(MAX_MDX_MODULE_TRANSFORM_CONCURRENCY) },
  );

  // Runs before the rethrow so the artifacts written by the siblings that kept
  // going after the admission failure are still covered by a cleanup pass.
  await pruneSupersededJsxArtifacts(esmCacheDir, writtenArtifacts);
  if (admissionFailure) throw admissionFailure;

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
