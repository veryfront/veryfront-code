/**
 * Code transformation logic for the SSR VF Modules stage.
 *
 * Compiles framework TypeScript/TSX files to JavaScript and recursively
 * resolves all imports (#veryfront/, relative, React).
 */

import {
  stripJsonImportAttributes,
  upgradeImportAssertions,
} from "#veryfront/transforms/esm/import-attributes.ts";
import { ESBUILD_SUPPORTED_FEATURES } from "#veryfront/transforms/esm/transform-utils.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import denoConfig from "#deno-config" with { type: "json" };
import { rendererLogger as logger } from "#veryfront/utils";
import { IMPORT_RESOLUTION_ERROR } from "#veryfront/errors";
import { parseImports, replaceSpecifiers } from "../../../esm/lexer.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { cacheHttpImportsToLocal } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { getReactImportMap } from "../../../import-rewriter/url-builder.ts";
import { findRelativeImports } from "./import-finder.ts";
import { resolveRelativeFrameworkImport, resolveVeryfrontSourcePath } from "./path-resolver.ts";
import {
  createFrameworkSpecifierResolver,
  reactReExportToEsmUrl,
  resolveReactSpecifier,
} from "./specifier-resolver.ts";
import {
  buildFrameworkTransformCacheKey,
  EMBEDDED_SRC_DIR,
  FRAMEWORK_ROOT,
  frameworkFileCache,
  frameworkFileTransformFlight,
  frameworkWriteFlight,
  LOG_PREFIX,
  MAX_RELATIVE_IMPORT_DEPTH,
  type TransformContext,
  transformingFiles,
  veryfrontTransformCache,
} from "./constants.ts";
import { buildFrameworkVfModuleCacheFileName } from "../../../mdx/esm-module-loader/cache-format.ts";

const DENO_CONFIG_STUB_CODE = `export default ${JSON.stringify(denoConfig)};`;

/**
 * Unique token embedded in every cycle-detection placeholder as an extra
 * collision guard. Detection keys off the stable `/* Cycle detected:` prefix
 * (below); the marker is additional insurance and is not required for a match,
 * so placeholders produced before this marker existed are still recognized.
 */
const CYCLE_PLACEHOLDER_MARKER = "vf-cycle-9f4a21b7";

/**
 * Prefix that every cycle-detection placeholder starts with. A real bundler
 * would never emit this exact string at position 0 of transformed output, so
 * it is a reliable sentinel on its own.
 */
const CYCLE_PLACEHOLDER_PREFIX = "/* Cycle detected:";

/**
 * Check if a transformed code string is a cycle placeholder.
 * Cycle placeholders are returned when transformFrameworkCode detects a cycle
 * (a file that's already being transformed). These should never be cached
 * to disk as they represent an in-progress state, not the final transform.
 */
export function isCyclePlaceholder(code: string): boolean {
  return code.startsWith(CYCLE_PLACEHOLDER_PREFIX);
}

/**
 * Cache transformed framework code and return the file:// path.
 *
 * Cache key format: vfmod-{namespace}-{pathHash}-{envKey}-{contentHash}.mjs
 *
 * Cache invalidation is handled by:
 * - namespace prefix: Auto-rolls when the framework vfmod cache shape changes
 * - envKey (FRAMEWORK_ROOT hash): Prevents cross-environment contamination
 *   (compiled binary vs source have different FRAMEWORK_ROOT values)
 * - contentHash: Content-based invalidation
 */
export async function cacheTransformedCode(
  transformed: string,
  vfModulePath: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<string> {
  const cacheDir = getMdxEsmCacheDir();
  // Include FRAMEWORK_ROOT in the hash to prevent cross-environment cache issues.
  // Different environments (source vs compiled binary) have different FRAMEWORK_ROOT values,
  // so their file:// paths are incompatible.
  const envKey = hashCodeHex(FRAMEWORK_ROOT).slice(0, 8);
  const contentHash = hashCodeHex(transformed);
  const pathHash = hashCodeHex(vfModulePath);
  const fileName = buildFrameworkVfModuleCacheFileName(pathHash, envKey, contentHash);
  const frameworkCacheDir = join(cacheDir, "framework");
  const cachePath = join(frameworkCacheDir, fileName);

  // Use Singleflight to prevent concurrent writes to the same file
  return await frameworkWriteFlight.do(cachePath, async () => {
    await fs.mkdir(frameworkCacheDir, { recursive: true });

    // Check if file already exists to avoid unnecessary writes
    if (await fs.exists(cachePath)) {
      logger.debug(`${LOG_PREFIX} Framework module cache hit`, { cachePath });
      return cachePath;
    }

    await fs.writeTextFile(cachePath, transformed);
    logger.debug(`${LOG_PREFIX} Wrote framework module to cache`, { cachePath });

    return cachePath;
  });
}

// Fallback-only cache for depth-limit fallback transforms. Kept separate
// from `frameworkFileCache` so the fallback's esbuild-only output never
// poisons the main path, which expects fully-resolved code (`#veryfront/`,
// React, HTTP imports all rewritten). The fallback still reads
// `frameworkFileCache` first, so when the main path has already produced
// a high-quality entry the fallback prefers it.
// Bounded so the fallback's per-path output cannot grow memory without limit
// in a long-running dev server. Entries are deterministic per resolved path and
// safe to evict/recompute.
const FALLBACK_TRANSFORM_CACHE_MAX_ENTRIES = 2000;
const fallbackTransformCache = new LRUCache<string, string>({
  maxEntries: FALLBACK_TRANSFORM_CACHE_MAX_ENTRIES,
});

export { reactReExportToEsmUrl } from "./specifier-resolver.ts";

/**
 * Pick an esbuild loader for a file path, honoring the embedded `.src`
 * suffix used in compiled binaries (`foo.ts.src` → `ts`). Recognizes
 * `.mjs`/`.cjs` as plain JS and `.mts`/`.cts` as TypeScript.
 */
function pickFrameworkLoader(sourcePath: string): "tsx" | "ts" | "jsx" | "js" {
  const ext = sourcePath
    .match(/\.(tsx?|jsx?|m[jt]s|c[jt]s)(?:\.src)?$/i)?.[1]
    ?.toLowerCase();
  if (ext === "tsx") return "tsx";
  if (ext === "ts" || ext === "mts" || ext === "cts") return "ts";
  if (ext === "jsx") return "jsx";
  return "js";
}

/**
 * Compile a framework source file with esbuild only (no recursive
 * import resolution). Used by the depth-limit fallback and by its
 * nested handling of embedded `.src` dependencies.
 */
async function compileFallbackSource(
  content: string,
  sourcePath: string,
): Promise<string> {
  const { transform } = await import("veryfront/extensions/bundler");
  const result = await transform(content, {
    loader: pickFrameworkLoader(sourcePath),
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: "es2022",
    supported: ESBUILD_SUPPORTED_FEATURES,
  });
  return await upgradeImportAssertions(result.code);
}

/**
 * Transform and cache a single dependency referenced from the depth-limit
 * fallback. Required for compiled binaries where the resolver returns
 * embedded `.src` paths (e.g. `foo.ts.src`) — those are not loadable
 * module URLs, so the fallback must materialize a real `.mjs` cache file.
 *
 * Recursion is bounded by `visited` (cycle guard) and by `frameworkFileCache`
 * (per-process dedupe), the same primitives the main transform path uses.
 */
async function transformAndCacheFallbackDep(
  resolvedPath: string,
  ctx: TransformContext,
  visited: Set<string>,
): Promise<string | null> {
  if (visited.has(resolvedPath)) {
    // Cycle: bail and leave the parent's import bare. Logged so a stuck
    // dev server isn't silently producing un-loadable cache files.
    logger.warn(
      `${LOG_PREFIX} Depth-limit fallback skipping cycle`,
      { resolvedPath: resolvedPath.slice(-60) },
    );
    return null;
  }
  let depContent: string;
  try {
    depContent = await ctx.fs.readTextFile(resolvedPath);
  } catch (error) {
    logger.warn(
      `${LOG_PREFIX} Depth-limit fallback could not read dependency`,
      { resolvedPath: resolvedPath.slice(-60), error: String(error) },
    );
    return null;
  }

  const transformKey = buildFrameworkTransformCacheKey(
    resolvedPath,
    ctx.reactVersion,
    ctx.projectDir,
    depContent,
  );
  // Prefer the main path's fully-resolved cache entry when present —
  // that output is strictly higher quality than what the fallback
  // produces (no `#veryfront/` / React / HTTP rewriting here). But
  // never propagate a cycle placeholder: the main path stores those
  // mid-transform and treats them as invalid (see `isCyclePlaceholder`
  // / the cache-invalidation branch upstream). If the fallback wrote
  // a placeholder into a cache file, an importer would silently see
  // `export {}` and any named import would be `undefined` at runtime.
  const mainCached = frameworkFileCache.get(transformKey);
  if (mainCached && !isCyclePlaceholder(mainCached)) {
    return await cacheTransformedCode(mainCached, resolvedPath, ctx.fs);
  }
  const fallbackCached = fallbackTransformCache.get(transformKey);
  if (fallbackCached) {
    return await cacheTransformedCode(fallbackCached, resolvedPath, ctx.fs);
  }
  visited.add(resolvedPath);

  // Catch esbuild failures (bad syntax, encoding issues) so one bad
  // `.src` dep does not abort the entire top-level fallback. The bare
  // import is left in the parent and the runtime's own loader will
  // surface a clear "Module not found" instead of a stack trace
  // pointing at an unrelated parent file.
  let compiled: string;
  try {
    compiled = await compileFallbackSource(depContent, resolvedPath);
  } catch (error) {
    logger.warn(
      `${LOG_PREFIX} Depth-limit fallback could not compile dependency`,
      { resolvedPath: resolvedPath.slice(-60), error: String(error) },
    );
    return null;
  }
  const rewritten = await rewriteFallbackRelativeImports(compiled, resolvedPath, ctx, visited);
  fallbackTransformCache.set(transformKey, rewritten);
  return await cacheTransformedCode(rewritten, resolvedPath, ctx.fs);
}

/**
 * Rewrite relative imports in the depth-limit fallback output. Each
 * `./foo.js` / `../bar.js` is resolved against `sourcePath` and emitted
 * as an absolute `file://` URL so the cached fallback module is
 * executable from the cache directory.
 *
 * In dev mode the resolver returns a `.ts` / `.js` path the runtime can
 * load directly, so we point at the source file. In compiled binaries
 * it returns a `.src` path the runtime cannot load — those deps are
 * transformed and cached on the fly via {@link transformAndCacheFallbackDep}
 * and the import is rewritten to the resulting cache URL. Imports that
 * fail to resolve are left untouched and a warning is logged.
 */
async function rewriteFallbackRelativeImports(
  code: string,
  sourcePath: string,
  ctx: TransformContext,
  visited: Set<string> = new Set(),
): Promise<string> {
  visited.add(sourcePath);

  // Note: we do not early-return when there are no relative imports, because
  // react/react-dom specifiers still need rewriting below.
  const relativeImports = await findRelativeImports(code);

  // Built once and reused for both the relative-import loop (React re-export
  // rewriting) and the final specifier pass below.
  const reactImportMap = getReactImportMap(ctx.reactVersion);

  const replacements = new Map<string, string>();
  for (const specifier of relativeImports) {
    // Skip non-code imports the runtime cannot load this way.
    if (/\.(json|css|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|eot)$/.test(specifier)) {
      continue;
    }
    const resolvedPath = await resolveRelativeFrameworkImport(specifier, sourcePath, ctx.fs);
    if (!resolvedPath) {
      logger.warn(
        `${LOG_PREFIX} Depth-limit fallback could not resolve relative import "${specifier}"`,
        { sourcePath: sourcePath.slice(-60) },
      );
      continue;
    }

    // Same React-instance fix as the main path: route React re-exports to the
    // esm.sh bundle instead of linking veryfront's project-React bridge.
    const reactUrl = reactReExportToEsmUrl(resolvedPath, ctx.reactVersion, reactImportMap);
    if (reactUrl) {
      replacements.set(specifier, reactUrl);
      continue;
    }

    // Embedded sources (.tsx.src / .ts.src / .jsx.src / .js.src) used by
    // compiled binaries are not loadable by the runtime. Materialize a
    // cache file the runtime can import instead of linking at the .src
    // source. Regular .ts/.tsx/.js/.jsx/.mjs paths are pointed at
    // directly — the runtime handles them natively.
    if (resolvedPath.endsWith(".src")) {
      const cacheUrlPath = await transformAndCacheFallbackDep(resolvedPath, ctx, visited);
      if (!cacheUrlPath) continue;
      replacements.set(specifier, `file://${cacheUrlPath}`);
    } else {
      replacements.set(specifier, `file://${resolvedPath}`);
    }
  }

  // React imports must be rewritten even when there are no relative imports,
  // so SSR links against the single esm.sh React bundle (see
  // resolveReactSpecifier).
  const rewritten = await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return replacements.get(specifier) ?? null;
    }
    return resolveReactSpecifier(specifier, ctx.reactVersion, reactImportMap);
  });

  // Materialize any `https://esm.sh/...` React imports as local file:// bundles
  // (same pass the main path runs). The cached fallback module is later loaded
  // from file://, and Node rejects `import ... from "https:"`
  // (ERR_UNSUPPORTED_ESM_URL_SCHEME); leaving the remote specifier in would
  // break SSR under Node whenever a deep framework file hits this fallback.
  const importMap = await loadImportMap(ctx.projectDir);
  const cacheResult = await cacheHttpImportsToLocal(rewritten, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
    reactVersion: ctx.reactVersion,
  });
  return cacheResult.code;
}

/**
 * Core transformation logic for framework TypeScript/TSX files.
 * Compiles to JavaScript and recursively resolves all imports:
 * - #veryfront/ imports (internal framework imports)
 * - Relative imports (./foo, ../bar) within framework files
 */
export async function transformFrameworkCode(
  content: string,
  sourcePath: string,
  ctx: TransformContext,
  throwOnMissingImport = false,
  depth = 0,
): Promise<string> {
  const transformKey = buildFrameworkTransformCacheKey(
    sourcePath,
    ctx.reactVersion,
    ctx.projectDir,
    content,
  );
  const ancestry = ctx.transformAncestry ?? new Set<string>();

  if (ancestry.has(transformKey)) {
    logger.debug(`${LOG_PREFIX} Detected cycle, skipping`, {
      sourcePath: sourcePath.slice(-60),
    });
    return `/* Cycle detected: ${sourcePath} ${CYCLE_PLACEHOLDER_MARKER} */\nexport {};`;
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(transformKey);
  const transformContext: TransformContext = {
    ...ctx,
    transformAncestry: nextAncestry,
  };
  const operation = () =>
    transformFrameworkCodeUncoalesced(
      content,
      sourcePath,
      transformContext,
      throwOnMissingImport,
      depth,
    );

  // Root calls with the same transform key share one promise. Recursive calls
  // deliberately stay within their own traversal: joining another root's
  // dependency flight can deadlock when two roots import each other.
  if (ancestry.size === 0) {
    return await frameworkFileTransformFlight.do(transformKey, operation);
  }
  return await operation();
}

async function transformFrameworkCodeUncoalesced(
  content: string,
  sourcePath: string,
  ctx: TransformContext,
  throwOnMissingImport: boolean,
  depth: number,
): Promise<string> {
  // Check depth limit
  if (depth > MAX_RELATIVE_IMPORT_DEPTH) {
    logger.warn(`${LOG_PREFIX} Max relative import depth exceeded`, {
      sourcePath: sourcePath.slice(-60),
      depth,
    });
    // Compile the file, then rewrite its relative imports so the cached
    // fallback module is loadable from the cache directory. Without this
    // rewriting the fallback emits raw `./foo.js` imports that resolve
    // against the cache dir (where those siblings do not exist), producing
    // a runtime "Module not found".
    const compiled = await compileFallbackSource(content, sourcePath);
    return await rewriteFallbackRelativeImports(compiled, sourcePath, ctx);
  }

  // Reuse a completed transform before doing any more work.
  const transformKey = buildFrameworkTransformCacheKey(
    sourcePath,
    ctx.reactVersion,
    ctx.projectDir,
    content,
  );
  const cached = frameworkFileCache.get(transformKey);
  if (cached) {
    // Validate cached code - reject cycle placeholders and unresolved imports
    if (isCyclePlaceholder(cached)) {
      logger.debug(`${LOG_PREFIX} Cache contains cycle placeholder, invalidating`, {
        sourcePath: sourcePath.slice(-60),
      });
      frameworkFileCache.delete(transformKey);
    } else {
      logger.debug(`${LOG_PREFIX} Framework file cache hit`, { sourcePath: sourcePath.slice(-60) });
      return cached;
    }
  }

  // Track active work for diagnostics and cleanup assertions. Cycle detection
  // uses traversal-local ancestry so independent requests are not mistaken
  // for recursive imports.
  transformingFiles.add(transformKey);

  try {
    const { transform } = await import("veryfront/extensions/bundler");

    const result = await transform(content, {
      loader: pickFrameworkLoader(sourcePath),
      jsx: "automatic",
      jsxImportSource: "react",
      format: "esm",
      target: "es2022",
      supported: ESBUILD_SUPPORTED_FEATURES,
    });

    let transformed = await upgradeImportAssertions(result.code);

    // Collect and recursively resolve all #veryfront/ imports
    const veryfrontReplacements = new Map<string, string>();
    const transformedImports = await parseImports(transformed);
    for (const importSpecifier of transformedImports) {
      const specifier = importSpecifier.n;
      if (!specifier?.startsWith("#veryfront/")) continue;
      if (veryfrontReplacements.has(specifier)) continue;

      const resolved = await resolveAndTransformVeryfrontImport(specifier, ctx);
      if (resolved) {
        veryfrontReplacements.set(specifier, resolved);
      } else if (throwOnMissingImport) {
        throw IMPORT_RESOLUTION_ERROR.create({
          detail:
            `${LOG_PREFIX} Could not resolve framework import "${specifier}" in ${sourcePath}. ` +
            `Expected to find ${
              join(FRAMEWORK_ROOT, "src", specifier.slice("#veryfront/".length))
            }.{ts,tsx,js,jsx} ` +
            `or an index file at that path.`,
        });
      }
    }

    // Collect and transform relative imports (./foo, ../bar) at any depth.
    // Relative imports in framework files must be resolved to absolute file:// paths
    // pointing to cached modules, otherwise they fail at runtime (e.g., markdown.tsx
    // imports ./theme.ts which must also be cached).
    //
    // Safety: MAX_RELATIVE_IMPORT_DEPTH limits recursion, traversal ancestry detects
    // cycles, and frameworkFileCache deduplicates already-transformed files.
    const relativeReplacements = new Map<string, string>();

    // Built once and reused for both the relative-import loop (React
    // re-export rewriting) and the final specifier pass below.
    const reactImportMap = getReactImportMap(ctx.reactVersion);

    // Prefixes for framework source directories - files outside these are
    // already-compiled JS (e.g. dnt shims) that should not be recursively transformed.
    const frameworkSrcDir = join(FRAMEWORK_ROOT, "src") + "/";
    const embeddedSrcDirPrefix = EMBEDDED_SRC_DIR + "/";

    {
      const relativeImports = await findRelativeImports(transformed);

      for (const specifier of relativeImports) {
        // Skip non-code imports (like deno.json, package.json, etc.)
        if (/\.(json|css|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|eot)$/.test(specifier)) {
          continue;
        }

        const resolvedPath = await resolveRelativeFrameworkImport(specifier, sourcePath, ctx.fs);
        if (!resolvedPath) {
          if (throwOnMissingImport) {
            throw IMPORT_RESOLUTION_ERROR.create({
              detail:
                `${LOG_PREFIX} Could not resolve relative import "${specifier}" in ${sourcePath}`,
            });
          }
          logger.warn(
            `${LOG_PREFIX} Could not resolve relative import "${specifier}" in ${sourcePath}`,
          );
          continue;
        }

        // veryfront's own React re-exports bridge to project React, which is a
        // different instance than the esm.sh react-dom bundle during SSR.
        // Point these straight at the esm.sh bundle so SSR shares one React.
        const reactUrl = reactReExportToEsmUrl(resolvedPath, ctx.reactVersion, reactImportMap);
        if (reactUrl) {
          relativeReplacements.set(specifier, reactUrl);
          continue;
        }

        // Files outside framework source directories (e.g. _dnt.shims.js,
        // _dnt.polyfills.js) are already-compiled JS with bare npm imports
        // that Deno resolves natively. Skip recursive transformation and
        // just point to the file directly.
        const isFrameworkSource = resolvedPath.startsWith(frameworkSrcDir) ||
          resolvedPath.startsWith(embeddedSrcDirPrefix);
        if (!isFrameworkSource) {
          relativeReplacements.set(specifier, `file://${resolvedPath}`);
          continue;
        }

        try {
          const depContent = await ctx.fs.readTextFile(resolvedPath);
          const dependencyTransformKey = buildFrameworkTransformCacheKey(
            resolvedPath,
            ctx.reactVersion,
            ctx.projectDir,
            depContent,
          );
          const existingFileUrl = frameworkFileCache.get(dependencyTransformKey);
          if (existingFileUrl) {
            const cachePath = await cacheTransformedCode(existingFileUrl, resolvedPath, ctx.fs);
            relativeReplacements.set(specifier, `file://${cachePath}`);
            continue;
          }

          // Transform the dependency with depth+1 (so its relative imports won't be processed)
          const transformedDep = await transformFrameworkCode(
            depContent,
            resolvedPath,
            ctx,
            false,
            depth + 1,
          );

          // Skip cycle placeholders - don't cache or use them
          if (isCyclePlaceholder(transformedDep)) {
            logger.debug(`${LOG_PREFIX} Skipping relative import cycle placeholder`, {
              specifier,
              resolvedPath: resolvedPath.slice(-60),
            });
            continue;
          }

          // Cache the transformed code
          const cachePath = await cacheTransformedCode(transformedDep, resolvedPath, ctx.fs);
          const fileUrl = `file://${cachePath}`;

          relativeReplacements.set(specifier, fileUrl);
          // Cache by resolved path for reuse
          frameworkFileCache.set(dependencyTransformKey, transformedDep);

          logger.debug(`${LOG_PREFIX} Transformed relative import`, {
            from: sourcePath.slice(-40),
            specifier,
            cachePath: cachePath.slice(-60),
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          logger.warn(`${LOG_PREFIX} Failed to transform relative import: ${specifier}`, {
            from: sourcePath.slice(-40),
            resolvedPath: resolvedPath.slice(-40),
            error: reason,
          });
          // Fail closed. A relative framework dependency that will not transform
          // means the module is genuinely broken — the legitimate server-only
          // skip is already handled upstream by the server-only-packages
          // allowlist (specifier-resolver / bare-strategy), so anything reaching
          // here is a real failure. Surface it as a clear transform error (500
          // at load) rather than shipping a module that returns 200 and only
          // throws when the missing symbol is used at runtime.
          throw error;
        }
      }
    }

    // Handle Deno import-map aliases (e.g. #deno-config) that only exist in
    // the Deno runtime and cannot be resolved by esm.sh or the HTTP cache.
    // We create a cached JS stub module so the transformed code can import it
    // without losing access to imports/exports metadata from deno.json.
    let denoConfigStubUrl: string | null = null;
    if (transformed.includes('"#deno-config"') || transformed.includes("'#deno-config'")) {
      const stubPath = await cacheTransformedCode(
        DENO_CONFIG_STUB_CODE,
        "#deno-config-stub",
        ctx.fs,
      );
      denoConfigStubUrl = `file://${stubPath}`;
    }

    transformed = await replaceSpecifiers(
      transformed,
      createFrameworkSpecifierResolver({
        denoConfigStubUrl,
        veryfrontReplacements,
        relativeReplacements,
        reactVersion: ctx.reactVersion,
        reactImportMap,
      }),
    );

    transformed = await stripJsonAttributesFromModuleImports(transformed);

    // Cache HTTP imports to local filesystem
    const importMap = await loadImportMap(ctx.projectDir);
    const cacheResult = await cacheHttpImportsToLocal(transformed, {
      cacheDir: getHttpBundleCacheDir(),
      importMap,
      reactVersion: ctx.reactVersion,
    });

    // Cache the final transformed code
    frameworkFileCache.set(transformKey, cacheResult.code);

    return cacheResult.code;
  } finally {
    // Always clean up active-transform diagnostics.
    transformingFiles.delete(transformKey);
  }
}

/**
 * Resolve a #veryfront/ import to a file:// path pointing to transformed JavaScript.
 * Recursively transforms dependencies and caches them for reuse.
 */
export async function resolveAndTransformVeryfrontImport(
  specifier: string,
  ctx: TransformContext,
): Promise<string | null> {
  const sourcePath = await resolveVeryfrontSourcePath(specifier);
  if (!sourcePath) return null;

  try {
    const content = await ctx.fs.readTextFile(sourcePath);
    const transformKey = buildFrameworkTransformCacheKey(
      `${specifier}:${sourcePath}`,
      ctx.reactVersion,
      ctx.projectDir,
      content,
    );
    const cached = veryfrontTransformCache.get(transformKey);
    if (cached) return cached;

    // Transform the dependency (recursively handles its own #veryfront/ imports)
    const transformed = await transformFrameworkCode(content, sourcePath, ctx, false);

    // Don't cache cycle placeholders - they should never be persisted to disk.
    // A cycle placeholder indicates the current traversal already visited the
    // module, so it must not be cached.
    if (isCyclePlaceholder(transformed)) {
      logger.debug(`${LOG_PREFIX} Skipping cache for cycle placeholder`, { specifier });
      return null;
    }

    // Cache the transformed code to filesystem
    const cachePath = await cacheTransformedCode(transformed, specifier, ctx.fs);
    const fileUrl = `file://${cachePath}`;

    // Store in memory cache for this session
    veryfrontTransformCache.set(transformKey, fileUrl);

    logger.debug(`${LOG_PREFIX} Transformed #veryfront/ dependency`, {
      specifier,
      sourcePath,
      cachePath,
    });

    return fileUrl;
  } catch (error) {
    logger.warn(`${LOG_PREFIX} Failed to transform #veryfront/ dependency: ${specifier}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // Return null on failure - caller will handle missing imports appropriately.
    // No fallback to raw TypeScript paths as these fail in compiled binaries.
    return null;
  }
}

/**
 * Drop `with { type: "json" }` from imports that now point at a JavaScript
 * module.
 *
 * A framework import of a `.json` file (`#veryfront/server/dev-ui/manifest.json`)
 * is resolved by transforming the JSON into a cached `.mjs` that default-exports
 * the data. The attribute on the importer describes the *original* target, so
 * leaving it in place makes the runtime reject the rewritten import with
 * "Expected a Json module, but identified a Mjs module".
 *
 * The rewrite runs through the module lexer, like every other specifier edit in
 * this stage, so dynamic imports are covered and module source that this file
 * embeds in string literals is not.
 */
export function stripJsonAttributesFromModuleImports(code: string): Promise<string> {
  return stripJsonImportAttributes(code, (specifier) => specifier.endsWith(".mjs"));
}

/**
 * Transform framework source code with React import rewriting.
 * Entry point for top-level framework modules (e.g., Head.tsx, Router.tsx).
 */
export async function transformFrameworkSource(
  content: string,
  sourcePath: string,
  reactVersion: string,
  projectDir: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<string> {
  return transformFrameworkCode(content, sourcePath, { reactVersion, projectDir, fs }, true);
}
