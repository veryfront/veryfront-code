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
  for (const ext of EXTENSIONS) {
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
 * Returns the file:// path if found, null otherwise.
 */
async function resolveVeryfrontImport(specifier: string): Promise<string | null> {
  if (!specifier.startsWith("#veryfront/")) return null;

  const relativePath = specifier.slice("#veryfront/".length);
  const basePath = join(FRAMEWORK_ROOT, "src", relativePath);

  const hasExtension = /\.(tsx?|jsx?|mjs)$/.test(relativePath);

  if (hasExtension) {
    try {
      if (await exists(basePath)) return `file://${basePath}`;
    } catch {
      // Continue
    }
    return null;
  }

  for (const ext of EXTENSIONS) {
    const pathWithExt = basePath + ext;
    try {
      if (await exists(pathWithExt)) return `file://${pathWithExt}`;
    } catch {
      // Continue
    }
  }

  for (const ext of EXTENSIONS) {
    const indexPath = join(basePath, "index" + ext);
    try {
      if (await exists(indexPath)) return `file://${indexPath}`;
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
  _fs: ReturnType<typeof createFileSystem>,
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

  const veryfrontReplacements = new Map<string, string>();
  for (const match of transformed.matchAll(/from\s+["'](#veryfront\/[^"']+)["']/g)) {
    const specifier = match[1]!;
    if (veryfrontReplacements.has(specifier)) continue;

    const resolved = await resolveVeryfrontImport(specifier);
    if (!resolved) {
      throw new Error(
        `${LOG_PREFIX} Could not resolve framework import "${specifier}" in ${sourcePath}. ` +
          `Expected to find ${
            join(FRAMEWORK_ROOT, "src", specifier.slice("#veryfront/".length))
          }.{ts,tsx,js,jsx} ` +
          `or an index file at that path.`,
      );
    }

    veryfrontReplacements.set(specifier, resolved);
  }

  const reactImportMap = getReactImportMap(reactVersion);

  transformed = await replaceSpecifiers(transformed, (specifier) => {
    if (specifier.startsWith("#veryfront/")) {
      return veryfrontReplacements.get(specifier) ?? null;
    }

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
  });

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
  const frameworkCacheDir = join(cacheDir, "framework");
  const cachePath = join(frameworkCacheDir, fileName);

  await fs.mkdir(frameworkCacheDir, { recursive: true });
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
    if (vfModuleImports.length === 0) return ctx.code;

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

    if (replacements.size === 0) return ctx.code;

    return replaceSpecifiers(ctx.code, (specifier) => replacements.get(specifier) ?? null);
  },
};
