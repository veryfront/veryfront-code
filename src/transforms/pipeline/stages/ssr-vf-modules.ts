/**
 * SSR VF Modules Stage - resolves /_vf_modules/_veryfront/ paths to framework source.
 *
 * The SSR import map rewrites "veryfront/head" → "/_vf_modules/_veryfront/react/components/Head.js?ssr=true"
 * This stage resolves those paths to actual framework source files, transforms them
 * (including React import rewriting), and rewrites imports to file:// paths.
 *
 * This ensures framework components use the same cached React bundles as user code,
 * preventing the "dual React instances" error that causes hooks to fail.
 */

import type { TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { replaceSpecifiers } from "../../esm/lexer.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { cacheHttpImportsToLocal } from "../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { buildReactUrl, getReactImportMap } from "../../import-rewriter/url-builder.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";

const LOG_PREFIX = "[SSR-VF-MODULES]";

// Singleflight for framework module file writes to prevent race conditions
const frameworkWriteFlight = new Singleflight<string>();

// Get framework root - this works in both Deno source and compiled binaries
const RUNTIME_FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);

// Always use the runtime-detected framework root.
// In compiled binaries, embedded files are extracted to the runtime directory,
// NOT accessible at compile-time paths. The extraction structure mirrors the
// original directory layout, so dist/framework-src is at {extraction_root}/dist/framework-src.
const FRAMEWORK_ROOT = RUNTIME_FRAMEWORK_ROOT;

// Directory containing embedded framework sources for compiled binaries.
// These are .src files created by scripts/prepare-framework-sources.ts.
// In compiled binaries, files are extracted to the runtime directory.
const EMBEDDED_SRC_DIR = join(RUNTIME_FRAMEWORK_ROOT, "dist", "framework-src");

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

// Extensions to try when resolving framework files
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/**
 * Check if a transformed code string is a cycle placeholder.
 * Cycle placeholders are returned when transformFrameworkCode detects a cycle
 * (a file that's already being transformed). These should never be cached
 * to disk as they represent an in-progress state, not the final transform.
 */
function isCyclePlaceholder(code: string): boolean {
  return code.startsWith("/* Cycle detected:") && code.includes("export {};");
}

// Map of _vf_modules prefixes to framework directories
// We try embedded sources first (for compiled binaries), then regular src/
const FRAMEWORK_LOOKUPS: Array<[prefix: string, frameworkDir: string]> = [
  // Embedded sources for compiled binaries (these are .src files)
  ["_veryfront/", EMBEDDED_SRC_DIR],
  // Regular sources for dev mode
  ["_veryfront/", join(FRAMEWORK_ROOT, "src")],
];

/**
 * Find all /_vf_modules/_veryfront/ imports in the code.
 * Only matches framework modules, not user project files.
 */
function findVfModuleImports(code: string): string[] {
  const imports: string[] = [];
  // Note: \s* allows zero whitespace (minified code: from"..." has no space)
  // Only match _veryfront/ framework modules, not user project files
  const pattern = /from\s*["'](\/\_vf\_modules\/_veryfront\/[^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    imports.push(match[1]!);
  }

  return [...new Set(imports)];
}

async function tryReadWithExtensions(
  fs: ReturnType<typeof createFileSystem>,
  basePath: string,
): Promise<{ sourcePath: string; content: string } | null> {
  // Try all extensions, including .src versions for embedded sources
  const allExtensions = [
    ...EXTENSIONS.map((ext) => ext + ".src"), // Embedded sources (.tsx.src, .ts.src, etc.)
    ...EXTENSIONS, // Regular sources (.tsx, .ts, etc.)
  ];

  for (const ext of allExtensions) {
    const sourcePath = basePath + ext;
    try {
      if (await exists(sourcePath)) {
        const content = await fs.readTextFile(sourcePath);
        return { sourcePath, content };
      }
    } catch {
      // Continue trying other extensions
    }
  }
  return null;
}

/**
 * Resolve a /_vf_modules/ path to the actual framework source file.
 */
async function resolveFrameworkFile(
  vfModulePath: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<{ sourcePath: string; content: string } | null> {
  const pathWithoutPrefix = vfModulePath
    .replace(/^\/_vf_modules\//, "")
    .replace(/\?.*$/, "")
    .replace(/\.js$/, "");

  logger.debug(`${LOG_PREFIX} resolveFrameworkFile`, {
    input: vfModulePath,
    pathWithoutPrefix,
    lookupDirs: FRAMEWORK_LOOKUPS.map(([p, d]) => ({ prefix: p, dir: d })),
  });

  for (const [prefix, frameworkDir] of FRAMEWORK_LOOKUPS) {
    if (!pathWithoutPrefix.startsWith(prefix)) {
      logger.debug(`${LOG_PREFIX} Skipping lookup - path doesn't start with prefix`, {
        prefix,
        pathWithoutPrefix,
      });
      continue;
    }

    const relativePath = pathWithoutPrefix.slice(prefix.length);
    const pathWithPrefixDir = join(frameworkDir, prefix, relativePath);

    logger.debug(`${LOG_PREFIX} Trying path with prefix`, {
      prefix,
      frameworkDir,
      relativePath,
      fullPath: pathWithPrefixDir,
    });

    const withPrefix = await tryReadWithExtensions(fs, pathWithPrefixDir);
    if (withPrefix) {
      logger.debug(`${LOG_PREFIX} Found with prefix`, { sourcePath: withPrefix.sourcePath });
      return withPrefix;
    }

    if (prefix !== "_veryfront/") continue;

    const pathWithoutPrefixDir = join(frameworkDir, relativePath);
    logger.debug(`${LOG_PREFIX} Trying path without prefix`, {
      frameworkDir,
      relativePath,
      fullPath: pathWithoutPrefixDir,
    });

    const withoutPrefix = await tryReadWithExtensions(fs, pathWithoutPrefixDir);
    if (withoutPrefix) {
      logger.debug(`${LOG_PREFIX} Found without prefix`, { sourcePath: withoutPrefix.sourcePath });
      return withoutPrefix;
    }
  }

  logger.warn(`${LOG_PREFIX} resolveFrameworkFile: not found`, {
    vfModulePath,
    pathWithoutPrefix,
    frameworkRoot: FRAMEWORK_ROOT,
    embeddedSrcDir: EMBEDDED_SRC_DIR,
  });

  return null;
}

/**
 * Resolve a #veryfront/ import to the actual framework source file path.
 * Returns the resolved path if found, null otherwise.
 *
 * IMPORTANT: This function checks embedded sources FIRST (for compiled binaries),
 * then falls back to regular src/. This matches resolveFrameworkFile's behavior
 * and ensures consistent path resolution for cycle detection.
 */
async function resolveVeryfrontSourcePath(specifier: string): Promise<string | null> {
  if (!specifier.startsWith("#veryfront/")) return null;

  const relativePath = specifier.slice("#veryfront/".length);
  const hasExtension = /\.(tsx?|jsx?|mjs)$/.test(relativePath);

  // Check embedded sources first (for compiled binaries), then regular src/
  // This order matches FRAMEWORK_LOOKUPS and resolveFrameworkFile to ensure
  // consistent path resolution across the codebase, which is critical for
  // cycle detection in transformingFiles.
  const lookupDirs = [
    EMBEDDED_SRC_DIR, // Embedded sources for compiled binaries (.src files)
    join(FRAMEWORK_ROOT, "src"), // Regular sources for dev mode
  ];

  for (const dir of lookupDirs) {
    const basePath = join(dir, relativePath);

    if (hasExtension) {
      // Try exact path with .src suffix first (for embedded sources)
      try {
        const srcPath = basePath + ".src";
        if (await exists(srcPath)) return srcPath;
      } catch {
        // Continue
      }
      // Try exact path
      try {
        if (await exists(basePath)) return basePath;
      } catch {
        // Continue
      }
      continue;
    }

    // No extension provided - try all extensions
    // For embedded sources, try .src suffixes first
    const allExtensions = [
      ...EXTENSIONS.map((ext) => ext + ".src"),
      ...EXTENSIONS,
    ];

    for (const ext of allExtensions) {
      const pathWithExt = basePath + ext;
      try {
        if (await exists(pathWithExt)) return pathWithExt;
      } catch {
        // Continue
      }
    }

    // Try index file
    for (const ext of allExtensions) {
      const indexPath = join(basePath, "index" + ext);
      try {
        if (await exists(indexPath)) return indexPath;
      } catch {
        // Continue
      }
    }
  }

  return null;
}

// Cache for already-transformed #veryfront/ dependencies to avoid cycles and redundant work
const veryfrontTransformCache = new Map<string, string>();

interface TransformContext {
  reactVersion: string;
  projectDir: string;
  fs: ReturnType<typeof createFileSystem>;
}

/**
 * Find all relative imports (./foo, ../bar) in the code.
 * Returns array of specifiers.
 */
function findRelativeImports(code: string): string[] {
  const imports: string[] = [];
  const pattern = /from\s*["'](\.\.?\/[^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    imports.push(match[1]!);
  }

  return [...new Set(imports)];
}

/**
 * Resolve a relative import path to an absolute framework source path.
 * Given sourcePath=/foo/bar/index.ts and specifier=./Head.tsx, returns /foo/bar/Head.tsx
 *
 * Handles both regular source files (.tsx, .ts) and embedded sources (.tsx.src, .ts.src)
 * for compiled binaries.
 */
async function resolveRelativeFrameworkImport(
  specifier: string,
  fromSourcePath: string,
  _fs: ReturnType<typeof createFileSystem>,
): Promise<string | null> {
  const fromDir = fromSourcePath.substring(0, fromSourcePath.lastIndexOf("/"));
  const parts = fromDir.split("/").filter(Boolean);
  const importParts = specifier.split("/").filter(Boolean);

  for (const part of importParts) {
    if (part === "..") {
      parts.pop();
    } else if (part !== ".") {
      parts.push(part);
    }
  }

  const basePath = "/" + parts.join("/");

  // If specifier already has extension (e.g., ./Head.tsx), we need to try:
  // 1. The exact path (basePath)
  // 2. The path with .src suffix (basePath.src) for embedded sources
  // 3. Fall back to extension probing
  if (/\.(tsx?|jsx?|mjs)$/.test(specifier)) {
    // Try exact path first
    try {
      if (await exists(basePath)) return basePath;
    } catch {
      // Continue
    }

    // Try with .src suffix for embedded sources
    try {
      const srcPath = basePath + ".src";
      if (await exists(srcPath)) return srcPath;
    } catch {
      // Continue
    }

    // Not found with explicit extension
    return null;
  }

  // No extension provided - try all extensions (including .src for embedded sources)
  const allExtensions = [
    ...EXTENSIONS.map((ext) => ext + ".src"),
    ...EXTENSIONS,
  ];

  for (const ext of allExtensions) {
    const pathWithExt = basePath + ext;
    try {
      if (await exists(pathWithExt)) return pathWithExt;
    } catch {
      // Continue
    }
  }

  // Try index file
  for (const ext of allExtensions) {
    const indexPath = join(basePath, "index" + ext);
    try {
      if (await exists(indexPath)) return indexPath;
    } catch {
      // Continue
    }
  }

  return null;
}

// Cache for transformed framework files by absolute path to prevent cycles and redundant work
const frameworkFileCache = new Map<string, string>();

// Track files currently being transformed to detect cycles
const transformingFiles = new Set<string>();

// Maximum recursion depth for relative imports
const MAX_RELATIVE_IMPORT_DEPTH = 10;

/**
 * Core transformation logic for framework TypeScript/TSX files.
 * Compiles to JavaScript and recursively resolves all imports:
 * - #veryfront/ imports (internal framework imports)
 * - Relative imports (./foo, ../bar) within framework files
 */
async function transformFrameworkCode(
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

    // Collect and transform relative imports (./foo, ../bar) at depth 0 only
    // This fixes the bug where relative imports in framework files like index.ts
    // weren't being converted to absolute file:// paths, causing "Module not found" errors
    //
    // We only process relative imports at the top level (depth=0) to avoid exponential
    // explosion. Deeper files will have their #veryfront/ imports resolved by the
    // existing mechanism, and relative imports within them will be handled by their
    // own transformation when used directly.
    const relativeReplacements = new Map<string, string>();

    // Only process relative imports at depth 0 (top-level framework file)
    if (depth === 0) {
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
async function resolveAndTransformVeryfrontImport(
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
async function transformFrameworkSource(
  content: string,
  sourcePath: string,
  reactVersion: string,
  projectDir: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<string> {
  return transformFrameworkCode(content, sourcePath, { reactVersion, projectDir, fs }, true);
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
async function cacheTransformedCode(
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
