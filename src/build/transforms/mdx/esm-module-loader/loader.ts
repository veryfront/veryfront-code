/**
 * ESM Module Loader
 *
 * Main coordinator for loading MDX modules as ESM.
 * Handles import transformation, bundling, and module execution.
 *
 * @module build/transforms/mdx/esm-module-loader/loader
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getCacheNamespace } from "@veryfront/utils/cache/keys/namespace.ts";
import { getMdxEsmCacheDir } from "@veryfront/utils/cache-dir.ts";
import {
  getDefaultImportMap,
  transformImportsWithMap,
} from "@veryfront/modules/import-map/index.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import {
  createHTTPPlugin,
  getReactAliases,
  hasHttpImports,
  stripDenoShim,
} from "../../esm/http-bundler.ts";
import { setupSSRGlobals } from "../../../../rendering/ssr-globals.ts";
import type { MDXFrontmatter, MDXModule } from "../types.ts";
import type { ESMLoaderContext, JSXTransform } from "./types.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  IS_TRUE_NODE,
  JSX_IMPORT_PATTERN,
  LOG_PREFIX_MDX_LOADER,
  LOG_PREFIX_MDX_RENDERER,
  REACT_IMPORT_PATTERN,
  UNRESOLVED_VF_MODULES_PATTERN,
} from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { hashString } from "./utils/hash.ts";
import { transformReactImportsToAbsolute } from "./utils/react-transforms.ts";
import { createStubModule } from "./utils/stub-module.ts";
import { createModuleFetcherContext, fetchAndCacheModule } from "./module-fetcher/index.ts";

/**
 * Initialize the ESM cache directory.
 */
async function initializeCacheDir(context: ESMLoaderContext): Promise<string> {
  if (context.esmCacheDir) {
    return context.esmCacheDir;
  }

  // Use persistent cache directory that survives server restarts
  const persistentCacheDir = getMdxEsmCacheDir();
  const localFs = getLocalFs();

  try {
    await localFs.mkdir(persistentCacheDir, { recursive: true });
    context.esmCacheDir = persistentCacheDir;
    logger.info(`${LOG_PREFIX_MDX_LOADER} Using persistent cache dir: ${persistentCacheDir}`);
    return persistentCacheDir;
  } catch {
    // Fallback to temp dir if persistent cache fails
    const tempDir = await localFs.makeTempDir({ prefix: "veryfront-mdx-esm-" });
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
 * Transform imports based on runtime.
 */
async function transformImports(code: string): Promise<string> {
  if (IS_TRUE_NODE) {
    // On Node.js, transform react imports to absolute file:// paths
    return await transformReactImportsToAbsolute(code);
  }

  // On Deno/browser, transform to esm.sh URLs
  return transformImportsWithMap(
    code,
    getDefaultImportMap(),
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
    "default",
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
  logger.info(`${LOG_PREFIX_MDX_LOADER} Module fetch phase completed`, {
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
 */
async function transformJsxImports(
  code: string,
  adapter: ESMLoaderContext["adapter"],
  esmCacheDir: string,
): Promise<string> {
  const { transform } = await import("esbuild/mod.js");
  const jsxTransforms: JSXTransform[] = [];

  let jsxMatch;
  while ((jsxMatch = JSX_IMPORT_PATTERN.exec(code)) !== null) {
    const [fullMatch, importClause, filePath, ext] = jsxMatch;

    if (!filePath) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping JSX import with undefined file path`, {
        fullMatch,
      });
      continue;
    }

    try {
      const jsxCode = await adapter!.fs.readFile(filePath);
      const result = await transform(jsxCode as string, {
        loader: ext === "tsx" ? "tsx" : "jsx",
        jsx: "transform",
        jsxFactory: ESBUILD_JSX_FACTORY,
        jsxFragment: ESBUILD_JSX_FRAGMENT,
        format: "esm",
      });

      let transformed = result.code;
      if (!REACT_IMPORT_PATTERN.test(transformed)) {
        transformed = `import React from 'react';\n${transformed}`;
      }

      const transformedFileName = `jsx-${hashString(filePath)}.mjs`;
      const transformedPath = join(esmCacheDir, transformedFileName);
      await getLocalFs().writeTextFile(transformedPath, transformed);

      jsxTransforms.push({
        original: fullMatch,
        transformed: `import ${importClause} from "file://${transformedPath}";`,
      });

      logger.info(
        `${LOG_PREFIX_MDX_LOADER} Transformed JSX import using esbuild: ${filePath} -> ${transformedPath}`,
      );
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
    }
  }

  let result = code;
  for (const { original, transformed } of jsxTransforms) {
    result = result.replace(original, transformed);
  }

  return result;
}

/**
 * Bundle HTTP imports via esbuild.
 */
async function bundleHttpImports(
  code: string,
  esmCacheDir: string,
  adapter: ESMLoaderContext["adapter"],
): Promise<string> {
  if (!hasHttpImports(code)) {
    return code;
  }

  logger.info(`${LOG_PREFIX_MDX_LOADER} Bundling HTTP imports via esbuild`);
  const { build } = await import("esbuild/mod.js");

  const tempSourcePath = join(esmCacheDir, `temp-${hashString(code)}.mjs`);
  await getLocalFs().writeTextFile(tempSourcePath, code);

  try {
    const reactAliases = getReactAliases() as Record<string, string>;
    const result = await build({
      entryPoints: [tempSourcePath],
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2020",
      write: false,
      plugins: [createHTTPPlugin()],
      alias: reactAliases,
      external: [
        ...Object.values(reactAliases),
        "file://*",
        "veryfront/*",
      ],
    });

    const bundledCode = result.outputFiles?.[0]?.text;
    if (bundledCode) {
      logger.info(`${LOG_PREFIX_MDX_LOADER} Successfully bundled HTTP imports`);
      return bundledCode;
    }
    return code;
  } catch (bundleError) {
    logger.error(`${LOG_PREFIX_MDX_LOADER} Failed to bundle HTTP imports`, bundleError);
    return code;
  } finally {
    try {
      await adapter?.fs.remove(tempSourcePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Load a compiled MDX program as an ESM module.
 *
 * This function:
 * 1. Transforms @/ aliases to /_vf_modules/ paths
 * 2. Transforms imports using import maps (esm.sh for Deno, file:// for Node)
 * 3. Fetches and caches /_vf_modules/ imports
 * 4. Transforms JSX imports
 * 5. Bundles HTTP imports
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
      const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
      return getAdapter();
    })();
    context.adapter = adapter;

    // Initialize cache directory
    const esmCacheDir = await initializeCacheDir(context);

    // Step 1: Rewrite @/ aliases to /_vf_modules/ paths
    let rewritten = rewriteProjectAliasImports(compiledProgramCode);

    // Step 2: Transform imports based on runtime
    rewritten = await transformImports(rewritten);

    // Step 3: Find and process /_vf_modules/ imports
    const vfModuleImports = findVfModuleImports(rewritten);
    const projectDir = cwd();
    rewritten = await processVfModuleImports(rewritten, vfModuleImports, context, projectDir);

    // Step 4: Transform JSX imports
    rewritten = await transformJsxImports(rewritten, adapter, esmCacheDir);

    // Add MDXLayout export if present
    if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
      rewritten += "\nexport { MDXLayout as __vfLayout };\n";
    }

    // Step 5: Bundle HTTP imports
    logger.info(`${LOG_PREFIX_MDX_LOADER} HTTP imports check`, {
      hasHttpImports: hasHttpImports(rewritten),
      codePreview: rewritten.substring(0, 500),
    });
    rewritten = await bundleHttpImports(rewritten, esmCacheDir, adapter);

    // Strip Deno shim from esm.sh bundled code
    rewritten = stripDenoShim(rewritten);

    // Step 6: Check cache and load module
    const codeHash = hashString(rewritten);
    const namespace = getCacheNamespace() || "default";
    const compositeKey = `${namespace}:${codeHash}`;

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
    const nsDir = join(esmCacheDir, namespace);
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

    logger.info(`${LOG_PREFIX_MDX_RENDERER} Loading MDX module`, {
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
    logger.info(`${LOG_PREFIX_MDX_LOADER} loadModuleESM completed`, {
      durationMs: (loadEnd - loadStart).toFixed(1),
    });

    return result;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_RENDERER} MDX ESM load failed:`, error);
    throw error;
  }
}
