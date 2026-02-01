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
import { isDeno, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
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

// Extensions to try when resolving framework files
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

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

  for (const [prefix, frameworkDir] of FRAMEWORK_LOOKUPS) {
    if (!pathWithoutPrefix.startsWith(prefix)) continue;

    const relativePath = pathWithoutPrefix.slice(prefix.length);

    const withPrefix = await tryReadWithExtensions(fs, join(frameworkDir, prefix, relativePath));
    if (withPrefix) return withPrefix;

    if (prefix !== "_veryfront/") continue;

    const withoutPrefix = await tryReadWithExtensions(fs, join(frameworkDir, relativePath));
    if (withoutPrefix) return withoutPrefix;
  }

  return null;
}

/**
 * Resolve a #veryfront/ import to the actual framework source file path.
 * Returns the resolved path if found, null otherwise.
 */
async function resolveVeryfrontSourcePath(specifier: string): Promise<string | null> {
  if (!specifier.startsWith("#veryfront/")) return null;

  const relativePath = specifier.slice("#veryfront/".length);
  const basePath = join(FRAMEWORK_ROOT, "src", relativePath);

  const hasExtension = /\.(tsx?|jsx?|mjs)$/.test(relativePath);

  if (hasExtension) {
    try {
      if (await exists(basePath)) return basePath;
    } catch {
      // Continue
    }
    return null;
  }

  for (const ext of EXTENSIONS) {
    const pathWithExt = basePath + ext;
    try {
      if (await exists(pathWithExt)) return pathWithExt;
    } catch {
      // Continue
    }
  }

  for (const ext of EXTENSIONS) {
    const indexPath = join(basePath, "index" + ext);
    try {
      if (await exists(indexPath)) return indexPath;
    } catch {
      // Continue
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
 * Core transformation logic for framework TypeScript/TSX files.
 * Compiles to JavaScript and recursively resolves all #veryfront/ imports.
 */
async function transformFrameworkCode(
  content: string,
  sourcePath: string,
  ctx: TransformContext,
  throwOnMissingImport = false,
): Promise<string> {
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

  // Rewrite imports to resolved paths
  const reactImportMap = getReactImportMap(ctx.reactVersion);

  transformed = await replaceSpecifiers(transformed, (specifier) => {
    if (specifier.startsWith("#veryfront/")) {
      return veryfrontReplacements.get(specifier) ?? null;
    }

    const mapped = reactImportMap[specifier];
    if (mapped) return mapped;

    if (specifier.startsWith("react/")) {
      return buildReactUrl("react", ctx.reactVersion, "/" + specifier.slice("react/".length), true);
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

  // Cache HTTP imports to local filesystem for compiled binaries.
  // Native Deno handles HTTP imports directly via https:// URLs.
  if (isDeno && !isDenoCompiled) {
    return transformed;
  }

  const importMap = await loadImportMap(ctx.projectDir);
  const cacheResult = await cacheHttpImportsToLocal(transformed, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
    reactVersion: ctx.reactVersion,
  });

  return cacheResult.code;
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
  resolveFrameworkFile,
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
    const vfModuleImports = findVfModuleImports(ctx.code);
    if (vfModuleImports.length === 0) return ctx.code;

    logger.debug(`${LOG_PREFIX} Found ${vfModuleImports.length} /_vf_modules/ imports`, {
      imports: vfModuleImports,
      frameworkRoot: FRAMEWORK_ROOT,
    });

    const fs = createFileSystem();
    const replacements = new Map<string, string>();

    for (const vfModulePath of vfModuleImports) {
      try {
        const resolved = await resolveFrameworkFile(vfModulePath, fs);
        if (!resolved) {
          logger.warn(`${LOG_PREFIX} Could not resolve ${vfModulePath}`, {
            frameworkRoot: FRAMEWORK_ROOT,
            lookups: FRAMEWORK_LOOKUPS.map(([prefix, dir]) => ({ prefix, dir })),
          });
          continue;
        }

        const transformed = await transformFrameworkSource(
          resolved.content,
          resolved.sourcePath,
          ctx.reactVersion ?? REACT_DEFAULT_VERSION,
          ctx.projectDir,
          fs,
        );

        const cachePath = await cacheTransformedCode(transformed, vfModulePath, fs);
        replacements.set(vfModulePath, `file://${cachePath}`);

        logger.debug(`${LOG_PREFIX} Transformed ${vfModulePath} -> ${cachePath}`);
      } catch (error) {
        logger.error(`${LOG_PREFIX} Failed to transform ${vfModulePath}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (replacements.size === 0) return ctx.code;

    return replaceSpecifiers(ctx.code, (specifier) => replacements.get(specifier) ?? null);
  },
};
