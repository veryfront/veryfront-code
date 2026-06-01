/**
 * Code transformation logic for the SSR VF Modules stage.
 *
 * Compiles framework TypeScript/TSX files to JavaScript and recursively
 * resolves all imports (#veryfront/, relative, React).
 */

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import denoConfig from "#deno-config" with { type: "json" };
import { rendererLogger as logger } from "#veryfront/utils";
import { IMPORT_RESOLUTION_ERROR } from "#veryfront/errors";
import { replaceSpecifiers } from "../../../esm/lexer.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { cacheHttpImportsToLocal } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { buildReactUrl, getReactImportMap } from "../../../import-rewriter/url-builder.ts";
import { findRelativeImports } from "./import-finder.ts";
import { resolveRelativeFrameworkImport, resolveVeryfrontSourcePath } from "./path-resolver.ts";
import {
  EMBEDDED_SRC_DIR,
  FRAMEWORK_ROOT,
  frameworkFileCache,
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
 * Check if a transformed code string is a cycle placeholder.
 * Cycle placeholders are returned when transformFrameworkCode detects a cycle
 * (a file that's already being transformed). These should never be cached
 * to disk as they represent an in-progress state, not the final transform.
 */
export function isCyclePlaceholder(code: string): boolean {
  return code.startsWith("/* Cycle detected:") && code.includes("export {};");
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
// safe to evict/recompute. Override the cap via `FALLBACK_TRANSFORM_CACHE_MAX_ENTRIES`.
const FALLBACK_TRANSFORM_CACHE_MAX_ENTRIES = (() => {
  const raw = (globalThis as {
    Deno?: { env?: { get?: (k: string) => string | undefined } };
  }).Deno?.env?.get?.("FALLBACK_TRANSFORM_CACHE_MAX_ENTRIES");
  const parsed = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 2000 : parsed;
})();
const fallbackTransformCache = new LRUCache<string, string>({
  maxEntries: FALLBACK_TRANSFORM_CACHE_MAX_ENTRIES,
});

/**
 * Resolve a bare `react` / `react-dom` (or subpath) specifier to its esm.sh
 * URL for the given React version. Returns `null` for anything that is not a
 * React specifier.
 *
 * Both the main transform path and the depth-limit fallback use this so a
 * framework module always links against the single esm.sh React bundle used
 * during SSR. Leaving `react` bare would resolve it to the project's own
 * React copy — a second React instance whose dispatcher is null, which makes
 * the first hook throw "Cannot read properties of null (reading 'useEffect')".
 */
function resolveReactSpecifier(
  specifier: string,
  reactVersion: string,
  reactImportMap: Record<string, string> = getReactImportMap(reactVersion),
): string | null {
  const mapped = reactImportMap[specifier];
  if (mapped) return mapped;
  if (specifier.startsWith("react/")) {
    return buildReactUrl("react", reactVersion, "/" + specifier.slice("react/".length), true);
  }
  if (specifier.startsWith("react-dom/")) {
    return buildReactUrl(
      "react-dom",
      reactVersion,
      "/" + specifier.slice("react-dom/".length),
      true,
    );
  }
  return null;
}

/**
 * veryfront's own React re-export modules under `FRAMEWORK_ROOT/react/`
 * mapped to the bare specifier they stand in for. Each re-export bridges to
 * project React via `export * from "react"` (etc.), which during SSR resolves
 * to the project's `node_modules` copy — a *different* React instance than
 * the esm.sh react-dom bundle uses. The dnt build rewrites framework
 * `import ... from "react"` to a relative import of these files, so a
 * framework module that does `useEffect` ends up reading a null dispatcher.
 * Rewriting these imports straight to the esm.sh bundle keeps every SSR
 * module on a single React instance.
 *
 * Keys must match the compiled re-export filenames under
 * `FRAMEWORK_ROOT/react/`, which the build emits from the `react/*.ts` source
 * modules (`react.ts`, `react-dom.ts`, `react-dom-client.ts`,
 * `react-dom-server.ts`, `jsx-runtime.ts`, `jsx-dev-runtime.ts`). If one is
 * renamed or added, update this map too: a stale key silently reintroduces
 * the dual-React-instance bug.
 */
const REACT_REEXPORT_SPECIFIERS: Record<string, string> = {
  "react.js": "react",
  "react-dom.js": "react-dom",
  "react-dom-client.js": "react-dom/client",
  "react-dom-server.js": "react-dom/server",
  "jsx-runtime.js": "react/jsx-runtime",
  "jsx-dev-runtime.js": "react/jsx-dev-runtime",
};

/** `FRAMEWORK_ROOT/react/` prefix, precomputed (invariant per process). */
const REACT_REEXPORT_DIR = join(FRAMEWORK_ROOT, "react") + "/";

/**
 * If `resolvedPath` is one of veryfront's React re-export modules
 * (`FRAMEWORK_ROOT/react/*.js`), return the esm.sh URL it should be rewritten
 * to for the given React version. Returns `null` for anything else.
 */
export function reactReExportToEsmUrl(
  resolvedPath: string,
  reactVersion: string,
  reactImportMap?: Record<string, string>,
): string | null {
  if (!resolvedPath.startsWith(REACT_REEXPORT_DIR)) return null;
  const specifier = REACT_REEXPORT_SPECIFIERS[resolvedPath.slice(REACT_REEXPORT_DIR.length)];
  if (!specifier) return null;
  return resolveReactSpecifier(specifier, reactVersion, reactImportMap);
}

/**
 * Pick an esbuild loader for a file path, honoring the embedded `.src`
 * suffix used in compiled binaries (`foo.ts.src` → `ts`). Recognizes
 * `.mjs`/`.cjs` as plain JS and `.mts`/`.cts` as TypeScript.
 */
function pickFallbackLoader(sourcePath: string): "tsx" | "ts" | "jsx" | "js" {
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
    loader: pickFallbackLoader(sourcePath),
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: "es2022",
  });
  return result.code;
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
  // Prefer the main path's fully-resolved cache entry when present —
  // that output is strictly higher quality than what the fallback
  // produces (no `#veryfront/` / React / HTTP rewriting here). But
  // never propagate a cycle placeholder: the main path stores those
  // mid-transform and treats them as invalid (see `isCyclePlaceholder`
  // / the cache-invalidation branch upstream). If the fallback wrote
  // a placeholder into a cache file, an importer would silently see
  // `export {}` and any named import would be `undefined` at runtime.
  const mainCached = frameworkFileCache.get(resolvedPath);
  if (mainCached && !isCyclePlaceholder(mainCached)) {
    return await cacheTransformedCode(mainCached, resolvedPath, ctx.fs);
  }
  const fallbackCached = fallbackTransformCache.get(resolvedPath);
  if (fallbackCached) {
    return await cacheTransformedCode(fallbackCached, resolvedPath, ctx.fs);
  }

  if (visited.has(resolvedPath)) {
    // Cycle: bail and leave the parent's import bare. Logged so a stuck
    // dev server isn't silently producing un-loadable cache files.
    logger.warn(
      `${LOG_PREFIX} Depth-limit fallback skipping cycle`,
      { resolvedPath: resolvedPath.slice(-60) },
    );
    return null;
  }
  visited.add(resolvedPath);

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
  fallbackTransformCache.set(resolvedPath, rewritten);
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
  const relativeImports = findRelativeImports(code);

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

  // Check if already transformed (before cycle check to handle concurrent requests)
  // This prevents false cycle detection when another request has already completed
  // transforming this file and cached the result.
  const cached = frameworkFileCache.get(sourcePath);
  if (cached) {
    // Validate cached code - reject cycle placeholders and unresolved imports
    if (isCyclePlaceholder(cached)) {
      logger.debug(`${LOG_PREFIX} Cache contains cycle placeholder, invalidating`, {
        sourcePath: sourcePath.slice(-60),
      });
      frameworkFileCache.delete(sourcePath);
    } else {
      logger.debug(`${LOG_PREFIX} Framework file cache hit`, { sourcePath: sourcePath.slice(-60) });
      return cached;
    }
  }

  // Check if we're in a cycle (another request is currently transforming this file)
  if (transformingFiles.has(sourcePath)) {
    logger.debug(`${LOG_PREFIX} Detected cycle, skipping`, { sourcePath: sourcePath.slice(-60) });
    // Return a placeholder that will fail at runtime but won't cause infinite loop
    return `/* Cycle detected: ${sourcePath} */\nexport {};`;
  }

  // Mark as being transformed
  transformingFiles.add(sourcePath);

  try {
    const { transform } = await import("veryfront/extensions/bundler");

    const ext = sourcePath.match(/\.(tsx?|jsx?)$/)?.[1] ?? "tsx";
    let loader: "tsx" | "ts" | "jsx" | "js" = "js";
    if (ext === "tsx") loader = "tsx";
    else if (ext === "ts") loader = "ts";
    else if (ext === "jsx") loader = "jsx";

    const result = await transform(content, {
      loader,
      jsx: "automatic",
      jsxImportSource: "react",
      format: "esm",
      target: "es2022",
    });

    let transformed = result.code;

    // Collect and recursively resolve all #veryfront/ imports
    const veryfrontReplacements = new Map<string, string>();
    for (const match of transformed.matchAll(/from\s+["'](#veryfront\/[^"']+)["']/g)) {
      const specifier = match[1]!;
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
    // Safety: MAX_RELATIVE_IMPORT_DEPTH limits recursion, transformingFiles detects
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
      const relativeImports = findRelativeImports(transformed);

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

        // Check if this dependency was already transformed (by absolute path)
        const existingFileUrl = frameworkFileCache.get(resolvedPath);
        if (existingFileUrl) {
          // Use existing cached file URL
          const cachePath = await cacheTransformedCode(existingFileUrl, resolvedPath, ctx.fs);
          relativeReplacements.set(specifier, `file://${cachePath}`);
          continue;
        }

        try {
          const depContent = await ctx.fs.readTextFile(resolvedPath);

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
          frameworkFileCache.set(resolvedPath, transformedDep);

          logger.debug(`${LOG_PREFIX} Transformed relative import`, {
            from: sourcePath.slice(-40),
            specifier,
            cachePath: cachePath.slice(-60),
          });
        } catch (error) {
          logger.warn(`${LOG_PREFIX} Failed to transform relative import: ${specifier}`, {
            from: sourcePath.slice(-40),
            resolvedPath: resolvedPath.slice(-40),
            error: error instanceof Error ? error.message : String(error),
          });
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

    transformed = await replaceSpecifiers(transformed, (specifier) => {
      // Handle Deno import-map aliases
      if (specifier === "#deno-config") {
        return denoConfigStubUrl;
      }

      // Handle #veryfront/ imports
      if (specifier.startsWith("#veryfront/")) {
        return veryfrontReplacements.get(specifier) ?? null;
      }

      // Handle relative imports
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return relativeReplacements.get(specifier) ?? null;
      }

      return resolveReactSpecifier(specifier, ctx.reactVersion, reactImportMap);
    });

    // Cache HTTP imports to local filesystem
    const importMap = await loadImportMap(ctx.projectDir);
    const cacheResult = await cacheHttpImportsToLocal(transformed, {
      cacheDir: getHttpBundleCacheDir(),
      importMap,
      reactVersion: ctx.reactVersion,
    });

    // Cache the final transformed code
    frameworkFileCache.set(sourcePath, cacheResult.code);

    return cacheResult.code;
  } finally {
    // Always clean up the transformingFiles set to prevent false cycle detection
    transformingFiles.delete(sourcePath);
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
  // Check in-memory cache first (handles cycles and avoids redundant work)
  const cached = veryfrontTransformCache.get(specifier);
  if (cached) return cached;

  const sourcePath = await resolveVeryfrontSourcePath(specifier);
  if (!sourcePath) return null;

  try {
    const content = await ctx.fs.readTextFile(sourcePath);

    // Transform the dependency (recursively handles its own #veryfront/ imports)
    const transformed = await transformFrameworkCode(content, sourcePath, ctx, false);

    // Don't cache cycle placeholders - they should never be persisted to disk.
    // A cycle placeholder indicates the module is currently being transformed
    // by another call in the same stack, so we should not cache it.
    if (isCyclePlaceholder(transformed)) {
      logger.debug(`${LOG_PREFIX} Skipping cache for cycle placeholder`, { specifier });
      return null;
    }

    // Cache the transformed code to filesystem
    const cachePath = await cacheTransformedCode(transformed, specifier, ctx.fs);
    const fileUrl = `file://${cachePath}`;

    // Store in memory cache for this session
    veryfrontTransformCache.set(specifier, fileUrl);

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
