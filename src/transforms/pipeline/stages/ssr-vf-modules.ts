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

const LOG_PREFIX = "[SSR-VF-MODULES]";

// Get framework root - this works in both Deno source and compiled binaries
const FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);

// Extensions to try when resolving framework files
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

// Map of _vf_modules prefixes to framework directories
const FRAMEWORK_LOOKUPS: Array<[prefix: string, frameworkDir: string]> = [
  ["_veryfront/", join(FRAMEWORK_ROOT, "src")],
  ["react/", join(FRAMEWORK_ROOT, "src")],
  ["lib/", join(FRAMEWORK_ROOT, "src")],
];

/**
 * Find all /_vf_modules/ imports in the code.
 */
function findVfModuleImports(code: string): string[] {
  const imports: string[] = [];
  const pattern = /from\s+["'](\/\_vf\_modules\/[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    imports.push(match[1]!);
  }
  return [...new Set(imports)];
}

/**
 * Resolve a /_vf_modules/ path to the actual framework source file.
 */
async function resolveFrameworkFile(
  vfModulePath: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<{ sourcePath: string; content: string } | null> {
  // Strip /_vf_modules/ prefix and query params
  const pathWithoutPrefix = vfModulePath
    .replace(/^\/_vf_modules\//, "")
    .replace(/\?.*$/, "")
    .replace(/\.js$/, "");

  for (const [prefix, frameworkDir] of FRAMEWORK_LOOKUPS) {
    if (!pathWithoutPrefix.startsWith(prefix)) continue;

    const relativePath = pathWithoutPrefix.slice(prefix.length);

    for (const ext of EXTENSIONS) {
      const sourcePath = join(frameworkDir, prefix, relativePath + ext);

      try {
        if (await exists(sourcePath)) {
          const content = await fs.readTextFile(sourcePath);
          return { sourcePath, content };
        }
      } catch {
        // Continue trying other extensions
      }
    }

    // Try without the prefix in the path (for _veryfront/ which maps directly)
    if (prefix === "_veryfront/") {
      for (const ext of EXTENSIONS) {
        const sourcePath = join(frameworkDir, relativePath + ext);

        try {
          if (await exists(sourcePath)) {
            const content = await fs.readTextFile(sourcePath);
            return { sourcePath, content };
          }
        } catch {
          // Continue trying other extensions
        }
      }
    }
  }

  return null;
}

/**
 * Resolve a #veryfront/ import to the actual framework source file path.
 * Returns the file:// path if found, null otherwise.
 */
async function resolveVeryfrontImport(
  specifier: string,
  _fs: ReturnType<typeof createFileSystem>,
): Promise<string | null> {
  if (!specifier.startsWith("#veryfront/")) return null;

  // Strip #veryfront/ prefix to get relative path within src/
  const relativePath = specifier.slice("#veryfront/".length);

  // Build the full path: FRAMEWORK_ROOT/src/relativePath
  const basePath = join(FRAMEWORK_ROOT, "src", relativePath);

  // Try with extensions if no extension provided
  if (!relativePath.match(/\.(tsx?|jsx?|mjs)$/)) {
    for (const ext of EXTENSIONS) {
      const pathWithExt = basePath + ext;
      try {
        if (await exists(pathWithExt)) {
          return `file://${pathWithExt}`;
        }
      } catch {
        // Continue
      }
    }
    // Try index files
    for (const ext of EXTENSIONS) {
      const indexPath = join(basePath, "index" + ext);
      try {
        if (await exists(indexPath)) {
          return `file://${indexPath}`;
        }
      } catch {
        // Continue
      }
    }
  } else {
    // Has extension, try directly
    try {
      if (await exists(basePath)) {
        return `file://${basePath}`;
      }
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Transform framework source code with React import rewriting.
 * Uses esbuild to compile TSX/JSX and rewrites React imports to cached esm.sh bundles.
 * Also resolves #veryfront/ imports to file:// paths for runtime compatibility.
 */
async function transformFrameworkSource(
  content: string,
  sourcePath: string,
  reactVersion: string,
  projectDir: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<string> {
  const { transform } = await import("esbuild");

  // Determine loader based on extension
  const ext = sourcePath.match(/\.(tsx?|jsx?)$/)?.[1] ?? "tsx";
  const loader = ext === "tsx" ? "tsx" : ext === "ts" ? "ts" : ext === "jsx" ? "jsx" : "js";

  // Compile with esbuild
  const result = await transform(content, {
    loader,
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: "es2022",
  });

  let transformed = result.code;

  // Collect #veryfront/ imports for resolution
  const veryfrontReplacements = new Map<string, string>();
  const matches = transformed.matchAll(/from\s+["'](#veryfront\/[^"']+)["']/g);
  for (const match of matches) {
    const specifier = match[1]!;
    if (!veryfrontReplacements.has(specifier)) {
      const resolved = await resolveVeryfrontImport(specifier, fs);
      if (resolved) {
        veryfrontReplacements.set(specifier, resolved);
      } else {
        // Fail fast - unresolved #veryfront/ imports will cause runtime errors
        throw new Error(
          `${LOG_PREFIX} Could not resolve framework import "${specifier}" in ${sourcePath}. ` +
            `Expected to find ${
              join(FRAMEWORK_ROOT, "src", specifier.slice("#veryfront/".length))
            }.{ts,tsx,js,jsx} ` +
            `or an index file at that path.`,
        );
      }
    }
  }

  // Get the canonical React import map - this ensures we use the exact same URLs
  // as the rest of the SSR pipeline (with deps=csstype for type consistency)
  const reactImportMap = getReactImportMap(reactVersion);

  // Rewrite React imports to esm.sh URLs AND #veryfront/ imports to file:// paths
  // This ensures framework code uses the same React as user code
  transformed = await replaceSpecifiers(transformed, (specifier) => {
    // Check #veryfront/ first
    if (specifier.startsWith("#veryfront/")) {
      return veryfrontReplacements.get(specifier) ?? null;
    }

    // React imports - use the canonical import map for consistency
    if (reactImportMap[specifier]) {
      return reactImportMap[specifier];
    }

    // Handle react/* subpaths not in the map
    if (specifier.startsWith("react/")) {
      const subpath = "/" + specifier.slice("react/".length);
      return buildReactUrl("react", reactVersion, subpath, true);
    }
    if (specifier.startsWith("react-dom/")) {
      const subpath = "/" + specifier.slice("react-dom/".length);
      return buildReactUrl("react-dom", reactVersion, subpath, true);
    }

    return null;
  });

  // Cache HTTP imports (esm.sh URLs) to local file:// paths
  // This is critical for compiled binaries which can't do HTTP imports at runtime
  const importMap = await loadImportMap(projectDir);
  const cacheResult = await cacheHttpImportsToLocal(transformed, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
    reactVersion,
  });

  return cacheResult.code;
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
  const cachePath = join(cacheDir, "framework", fileName);

  await fs.mkdir(join(cacheDir, "framework"), { recursive: true });
  await fs.writeTextFile(cachePath, transformed);

  return cachePath;
}

// Export internal functions for testing
export const _testExports = {
  findVfModuleImports,
  resolveFrameworkFile,
  resolveVeryfrontImport,
  FRAMEWORK_ROOT,
  EXTENSIONS,
};

export const ssrVfModulesPlugin: TransformPlugin = {
  name: "ssr-vf-modules",
  stage: TransformStage.RESOLVE_ALIASES + 0.5, // Run right after import resolution
  condition: (ctx) => ctx.target === "ssr",

  async transform(ctx) {
    const vfModuleImports = findVfModuleImports(ctx.code);

    if (vfModuleImports.length === 0) {
      return ctx.code;
    }

    logger.debug(`${LOG_PREFIX} Found ${vfModuleImports.length} /_vf_modules/ imports`);

    const fs = createFileSystem();
    const replacements = new Map<string, string>();

    for (const vfModulePath of vfModuleImports) {
      try {
        const resolved = await resolveFrameworkFile(vfModulePath, fs);

        if (!resolved) {
          logger.warn(`${LOG_PREFIX} Could not resolve ${vfModulePath}`);
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

    if (replacements.size === 0) {
      return ctx.code;
    }

    // Replace all /_vf_modules/ imports with file:// paths
    return replaceSpecifiers(ctx.code, (specifier) => {
      return replacements.get(specifier) ?? null;
    });
  },
};
