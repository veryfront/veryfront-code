/**
 * Code transformation logic for the SSR VF Modules stage.
 *
 * Compiles framework TypeScript/TSX files to JavaScript and recursively
 * resolves all imports (#veryfront/, relative, React).
 */

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { replaceSpecifiers } from "../../../esm/lexer.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { cacheHttpImportsToLocal } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { buildReactUrl, getReactImportMap } from "../../../import-rewriter/url-builder.ts";
import { findRelativeImports } from "./import-finder.ts";
import { resolveRelativeFrameworkImport, resolveVeryfrontSourcePath } from "./path-resolver.ts";
import {
  FRAMEWORK_ROOT,
  frameworkFileCache,
  frameworkWriteFlight,
  LOG_PREFIX,
  MAX_RELATIVE_IMPORT_DEPTH,
  type TransformContext,
  transformingFiles,
  veryfrontTransformCache,
} from "./constants.ts";

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
 * Cache key format: vfmod-{VERSION}-{pathHash}-{envKey}-{contentHash}.mjs
 *
 * Cache invalidation is handled by:
 * - VERSION prefix: Auto-invalidates on framework releases
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
  const fileName = `vfmod-${VERSION}-${pathHash}-${envKey}-${contentHash}.mjs`;
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
    // Return minimally transformed code - it will fail at runtime but won't hang
    const { transform } = await import("esbuild");
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
    return result.code;
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
    const { transform } = await import("esbuild");

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
        throw new Error(
          `${LOG_PREFIX} Could not resolve framework import "${specifier}" in ${sourcePath}. ` +
            `Expected to find ${
              join(FRAMEWORK_ROOT, "src", specifier.slice("#veryfront/".length))
            }.{ts,tsx,js,jsx} ` +
            `or an index file at that path.`,
        );
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
            throw new Error(
              `${LOG_PREFIX} Could not resolve relative import "${specifier}" in ${sourcePath}`,
            );
          }
          logger.warn(
            `${LOG_PREFIX} Could not resolve relative import "${specifier}" in ${sourcePath}`,
          );
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

    // Rewrite imports to resolved paths
    const reactImportMap = getReactImportMap(ctx.reactVersion);

    transformed = await replaceSpecifiers(transformed, (specifier) => {
      // Handle #veryfront/ imports
      if (specifier.startsWith("#veryfront/")) {
        return veryfrontReplacements.get(specifier) ?? null;
      }

      // Handle relative imports
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return relativeReplacements.get(specifier) ?? null;
      }

      const mapped = reactImportMap[specifier];
      if (mapped) return mapped;

      if (specifier.startsWith("react/")) {
        return buildReactUrl(
          "react",
          ctx.reactVersion,
          "/" + specifier.slice("react/".length),
          true,
        );
      }

      if (specifier.startsWith("react-dom/")) {
        return buildReactUrl(
          "react-dom",
          ctx.reactVersion,
          "/" + specifier.slice("react-dom/".length),
          true,
        );
      }

      return null;
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
