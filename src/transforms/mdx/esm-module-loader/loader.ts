/**
 * ESM Module Loader
 *
 * Main coordinator for loading MDX modules as ESM.
 * Handles import transformation, caching, and module execution.
 *
 * @module build/transforms/mdx/esm-module-loader/loader
 */

import { join } from "#std/path.ts";
import React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { getCacheNamespace } from "#veryfront/utils/cache/keys/namespace.ts";
import { getHttpBundleCacheDir, getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { loadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { cacheHttpImportsToLocal } from "../../esm/http-cache.ts";
import { replaceSpecifiers } from "../../esm/lexer.ts";
import { setupSSRGlobals } from "../../../rendering/ssr-globals.ts";
import type { MDXFrontmatter, MDXModule } from "../types.ts";
import type { ESMLoaderContext } from "./types.ts";
import { getLocalReactPaths, isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  FRAMEWORK_ROOT,
  JSX_IMPORT_PATTERN,
  LOG_PREFIX_MDX_LOADER,
  LOG_PREFIX_MDX_RENDERER,
  REACT_IMPORT_PATTERN,
  UNRESOLVED_VF_MODULES_PATTERN,
} from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { hashString } from "./utils/hash.ts";
import { createStubModule } from "./utils/stub-module.ts";
import { createModuleFetcherContext, fetchAndCacheModule } from "./module-fetcher/index.ts";

function resolveProjectDir(context: ESMLoaderContext): string {
  if (context.projectDir) return context.projectDir;
  const envProjectDir = context.adapter?.env.get("VERYFRONT_PROJECT_DIR") ??
    context.adapter?.env.get("VF_PROJECT_DIR");
  if (envProjectDir) return envProjectDir;
  throw new Error(
    "[MDX] projectDir is required for import map resolution. Pass it explicitly to loadModuleESM.",
  );
}

/**
 * Initialize the ESM cache directory.
 */
async function initializeCacheDir(context: ESMLoaderContext): Promise<string> {
  if (context.esmCacheDir) {
    return context.esmCacheDir;
  }

  const localFs = getLocalFs();
  const baseCacheDir = getMdxEsmCacheDir();
  const projectKey = context.projectId ? encodeURIComponent(context.projectId) : "default";
  const persistentCacheDir = join(baseCacheDir, projectKey);

  try {
    await localFs.mkdir(persistentCacheDir, { recursive: true });
    context.esmCacheDir = persistentCacheDir;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Using persistent cache dir: ${persistentCacheDir}`);
    return persistentCacheDir;
  } catch {
    // Fallback to temp dir if persistent cache fails
    const tempDir = await localFs.makeTempDir({ prefix: `veryfront-mdx-esm-${projectKey}-` });
    context.esmCacheDir = tempDir;
    return tempDir;
  }
}

/**
 * Rewrite @/ aliased imports to /_vf_modules/ paths.
 */
function rewriteProjectAliasImports(code: string): string {
  return code.replace(
    /from\s+["']@\/([^"']+)["']/g,
    (_match, path) => {
      const jsPath = path.endsWith(".js") ? path : `${path}.js`;
      return `from "/_vf_modules/${jsPath}"`;
    },
  );
}

/**
 * Transform bare React specifiers to local file:// paths for Bun/Node.
 * This ensures the same React instance as react-dom-server.
 * For Deno, getLocalReactPaths() returns an empty object, so this is a no-op.
 */
async function transformReactToLocalPaths(code: string): Promise<string> {
  const localPaths = getLocalReactPaths();
  if (Object.keys(localPaths).length === 0) return code;

  return await replaceSpecifiers(code, (specifier) => {
    return localPaths[specifier] || null;
  });
}

function stripReactFromImportMap(importMap: ImportMapConfig): ImportMapConfig {
  const imports = importMap.imports ? { ...importMap.imports } : undefined;
  if (imports) {
    for (const key of Object.keys(imports)) {
      if (isReactSpecifier(key)) {
        delete imports[key];
      }
    }
  }

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => {
        const filtered = { ...mappings };
        for (const key of Object.keys(filtered)) {
          if (isReactSpecifier(key)) {
            delete filtered[key];
          }
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
function transformImports(code: string, importMap: ImportMapConfig): string {
  const sanitized = stripReactFromImportMap(importMap);
  return transformImportsWithMap(
    code,
    sanitized,
    undefined,
    { resolveBare: true },
  );
}

/**
 * Find /_vf_modules/ imports in code.
 */
function findVfModuleImports(code: string): Array<{ original: string; path: string }> {
  const imports: Array<{ original: string; path: string }> = [];
  const pattern = /from\s+["'](\/?)(_vf_modules\/[^"']+)["']/g;
  let match;

  while ((match = pattern.exec(code)) !== null) {
    const [original, , path] = match;
    if (path) {
      imports.push({ original, path });
    }
  }

  return imports;
}

/**
 * Process /_vf_modules/ imports and replace them with file:// paths.
 */
async function processVfModuleImports(
  code: string,
  imports: Array<{ original: string; path: string }>,
  context: ESMLoaderContext,
  projectDir: string,
): Promise<string> {
  const { adapter } = context;
  if (!adapter) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} No adapter available for module fetching`);
    return code;
  }

  const fetcherContext = createModuleFetcherContext(
    context.esmCacheDir!,
    adapter,
    projectDir,
    context.projectId ?? "default",
  );

  const fetchStart = performance.now();

  // Fetch all modules in parallel
  const results = await Promise.all(
    imports.map(async ({ original, path }) => {
      const filePath = await fetchAndCacheModule(path, fetcherContext);
      return { original, filePath, path };
    }),
  );

  const fetchEnd = performance.now();
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Module fetch phase completed`, {
    moduleCount: imports.length,
    durationMs: (fetchEnd - fetchStart).toFixed(1),
  });

  let result = code;
  for (const { original, filePath, path } of results) {
    if (filePath) {
      result = result.replace(original, `from "file://${filePath}"`);
    } else {
      // Create stub module for missing top-level imports
      const stubPath = await createStubModule(path, result, original, context.esmCacheDir!);
      if (stubPath) {
        result = result.replace(original, `from "file://${stubPath}"`);
      }
    }
  }

  return result;
}

/**
 * Transform JSX/TSX imports using esbuild.
 * Optimized to process all imports in parallel batches for better performance.
 */
async function transformJsxImports(
  code: string,
  adapter: ESMLoaderContext["adapter"],
  esmCacheDir: string,
): Promise<string> {
  const { transform } = await import("esbuild");

  // First, collect all JSX imports to process
  const importsToProcess: Array<{
    fullMatch: string;
    importClause: string;
    filePath: string;
    ext: string;
  }> = [];

  let jsxMatch;
  while ((jsxMatch = JSX_IMPORT_PATTERN.exec(code)) !== null) {
    const [fullMatch, importClause, filePath, ext] = jsxMatch;

    if (!filePath || !importClause || !ext) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping JSX import with undefined fields`, {
        fullMatch,
        hasFilePath: !!filePath,
        hasImportClause: !!importClause,
        hasExt: !!ext,
      });
      continue;
    }

    importsToProcess.push({ fullMatch, importClause, filePath, ext });
  }

  if (importsToProcess.length === 0) {
    return code;
  }

  const transformStart = performance.now();
  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Transforming ${importsToProcess.length} JSX imports in parallel`,
  );

  // Process all imports in parallel
  const transformResults = await Promise.all(
    importsToProcess.map(async ({ fullMatch, importClause, filePath, ext }) => {
      try {
        // Check if already cached
        const transformedFileName = `jsx-${hashString(filePath)}.mjs`;
        const transformedPath = join(esmCacheDir, transformedFileName);

        // Try to use cached version first
        try {
          const localFs = getLocalFs();
          const stat = await localFs.stat(transformedPath);
          if (stat?.isFile) {
            return {
              original: fullMatch,
              transformed: `import ${importClause} from "file://${transformedPath}";`,
              cached: true,
            };
          }
        } catch {
          // Not cached, proceed with transform
        }

        // Read and transform - use local fs for framework files, adapter for project files
        const isFrameworkFile = filePath.startsWith(FRAMEWORK_ROOT);
        const jsxCode = isFrameworkFile
          ? await getLocalFs().readTextFile(filePath)
          : await adapter!.fs.readFile(filePath);
        // Determine the correct loader based on file extension
        const loaderMap: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
          tsx: "tsx",
          ts: "ts",
          jsx: "jsx",
          js: "js",
        };
        const loader = loaderMap[ext] ?? "tsx";
        const result = await transform(jsxCode as string, {
          loader,
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        let transformed = result.code;
        if (!REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }

        // Write to cache
        await getLocalFs().writeTextFile(transformedPath, transformed);

        return {
          original: fullMatch,
          transformed: `import ${importClause} from "file://${transformedPath}";`,
          cached: false,
        };
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
        return null;
      }
    }),
  );

  const transformEnd = performance.now();
  const successCount = transformResults.filter((r) => r !== null).length;
  const cachedCount = transformResults.filter((r) => r?.cached).length;

  logger.debug(`${LOG_PREFIX_MDX_LOADER} JSX transform phase completed`, {
    total: importsToProcess.length,
    success: successCount,
    cached: cachedCount,
    durationMs: (transformEnd - transformStart).toFixed(1),
  });

  // Apply all transformations
  let result = code;
  for (const transform of transformResults) {
    if (transform) {
      result = result.replace(transform.original, transform.transformed);
    }
  }

  return result;
}

/**
 * Cache HTTP imports to local file:// paths for runtime-agnostic SSR.
 */
async function cacheHttpImports(
  code: string,
  importMap: ImportMapConfig,
): Promise<string> {
  const cacheDir = getHttpBundleCacheDir();
  return await cacheHttpImportsToLocal(code, { cacheDir, importMap });
}

/**
 * Load a compiled MDX program as an ESM module.
 *
 * This function:
 * 1. Transforms @/ aliases to /_vf_modules/ paths
 * 2. Transforms imports using project import maps (React left bare)
 * 3. Fetches and caches /_vf_modules/ imports
 * 4. Transforms JSX imports
 * 5. Caches HTTP imports to local file:// paths
 * 5.5. Transforms React imports to local file:// paths (Bun/Node only)
 * 6. Caches and loads the final module
 */
export async function loadModuleESM(
  compiledProgramCode: string,
  context: ESMLoaderContext,
): Promise<MDXModule> {
  const loadStart = performance.now();

  try {
    // Get or detect adapter
    const adapter = context.adapter ?? await (async () => {
      const { getAdapter } = await import("#veryfront/platform/adapters/detect.ts");
      return getAdapter();
    })();
    context.adapter = adapter;

    // Initialize cache directory
    const esmCacheDir = await initializeCacheDir(context);

    // Step 1: Rewrite @/ aliases to /_vf_modules/ paths
    let rewritten = rewriteProjectAliasImports(compiledProgramCode);

    const projectDir = resolveProjectDir(context);
    const importMap = await loadImportMap(projectDir, adapter);

    // Step 2: Transform imports using project import map
    rewritten = transformImports(rewritten, importMap);

    // Step 3: Find and process /_vf_modules/ imports
    const vfModuleImports = findVfModuleImports(rewritten);
    rewritten = await processVfModuleImports(rewritten, vfModuleImports, context, projectDir);

    // Step 4: Transform JSX imports
    rewritten = await transformJsxImports(rewritten, adapter, esmCacheDir);

    // Add MDXLayout export if present
    if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
      rewritten += "\nexport { MDXLayout as __vfLayout };\n";
    }

    // Step 5: Cache HTTP imports to local file:// paths
    rewritten = await cacheHttpImports(rewritten, importMap);

    // Step 5.5: Transform React imports to local file:// paths for Bun/Node
    // This ensures the same React instance as react-dom-server
    rewritten = await transformReactToLocalPaths(rewritten);

    // Step 6: Check cache and load module
    const codeHash = hashString(rewritten);
    const namespace = context.projectId || getCacheNamespace() || "default";
    const namespaceKey = encodeURIComponent(namespace);
    const compositeKey = `${namespaceKey}:${codeHash}`;

    const cached = context.moduleCache.get(compositeKey);
    if (cached) return cached as MDXModule;

    // Check for unresolved imports
    const unresolvedPattern = new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g");
    const unresolvedMatches = [...rewritten.matchAll(unresolvedPattern)];
    if (unresolvedMatches.length > 0) {
      const unresolvedPaths = unresolvedMatches.map((m) => m[1]).slice(0, 5);
      const errorMsg = `MDX has ${unresolvedMatches.length} unresolved module imports: ${
        unresolvedPaths.join(", ")
      }`;
      logger.error(`${LOG_PREFIX_MDX_RENDERER} ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Write module to disk and import
    const nsDir = join(esmCacheDir, namespaceKey);
    const localFs = getLocalFs();

    try {
      await localFs.mkdir(nsDir, { recursive: true });
    } catch (e) {
      logger.debug(
        `${LOG_PREFIX_MDX_RENDERER} mkdir nsDir failed`,
        e instanceof Error ? e : String(e),
      );
    }

    const filePath = join(nsDir, `${codeHash}.mjs`);
    try {
      const stat = await localFs.stat(filePath);
      if (!stat?.isFile) {
        await localFs.writeTextFile(filePath, rewritten);
      }
    } catch {
      await localFs.writeTextFile(filePath, rewritten);
    }

    logger.debug(`${LOG_PREFIX_MDX_RENDERER} Loading MDX module`, {
      filePath,
      codePreview: rewritten.substring(0, 300),
    });

    // Set up browser globals before importing
    setupSSRGlobals();

    const mod = await import(`file://${filePath}?v=${codeHash}`) as Record<string, unknown> & {
      __vfLayout?: React.ComponentType;
    };

    const result: MDXModule = {
      ...mod,
      default: mod?.default as React.ComponentType<unknown> | undefined,
      MDXContent: mod?.MDXContent as React.ComponentType<unknown> | undefined,
      frontmatter: mod?.frontmatter as MDXFrontmatter | undefined,
      headings: mod?.headings as Array<{ text: string; level: number }> | undefined,
      title: mod?.title as string | undefined,
      description: mod?.description as string | undefined,
      layout: mod?.layout as string | boolean | React.ComponentType | undefined,
      MDXLayout: (mod?.MDXLayout || mod?.__vfLayout) as React.ComponentType<unknown> | undefined,
      MainLayout: mod?.MainLayout as React.ComponentType<unknown> | undefined,
    };

    context.moduleCache.set(compositeKey, result);

    const loadEnd = performance.now();
    logger.debug(`${LOG_PREFIX_MDX_LOADER} loadModuleESM completed`, {
      durationMs: (loadEnd - loadStart).toFixed(1),
    });

    return result;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_RENDERER} MDX ESM load failed:`, error);
    throw error;
  }
}
