import { rendererLogger as logger } from "@veryfront/utils";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import React from "react";
import { getCacheNamespace } from "@veryfront/utils/cache/keys/namespace.ts";
import {
  getDefaultImportMap,
  transformImportsWithMap,
} from "@veryfront/modules/import-map/index.ts";
import type { MDXFrontmatter, MDXModule } from "./types.ts";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";

// True Node.js runtime (not Deno with Node.js compat)
const IS_TRUE_NODE = isNode && !isDeno;

// Constants
const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";
const JSX_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(jsx|tsx))['"];?/g;
const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;
const HTTP_IMPORT_PATTERN = /['"]https?:\/\/[^'"]+['"]/;
const ESBUILD_JSX_FACTORY = "React.createElement";
const ESBUILD_JSX_FRAGMENT = "React.Fragment";
const HTTP_MODULE_FETCH_TIMEOUT_MS = 30000;

// Cache for resolved react package paths (Node.js only)
const _resolvedPaths: Record<string, string | null> = {};

/**
 * Resolve a Node.js package path using require.resolve
 * Returns null if resolution fails
 */
async function resolveNodePackage(packageSpec: string): Promise<string | null> {
  if (!IS_TRUE_NODE) return null;
  if (packageSpec in _resolvedPaths) return _resolvedPaths[packageSpec]!;

  try {
    // Use Node.js createRequire to resolve the package from THIS file's location
    // This ensures react is found from veryfront's node_modules, not the project's
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(packageSpec);
    _resolvedPaths[packageSpec] = resolved;
    return resolved;
  } catch {
    _resolvedPaths[packageSpec] = null;
    return null;
  }
}

/**
 * Transform react imports to absolute file:// paths for Node.js.
 * This is needed because MDX modules are cached in arbitrary directories
 * (like temp dirs) where Node.js cannot resolve bare 'react' imports.
 */
async function transformReactImportsToAbsolute(code: string): Promise<string> {
  if (!IS_TRUE_NODE) return code;

  // Resolve the actual react package paths
  const reactPath = await resolveNodePackage("react");
  const reactJsxPath = await resolveNodePackage("react/jsx-runtime");
  const reactJsxDevPath = await resolveNodePackage("react/jsx-dev-runtime");
  const reactDomPath = await resolveNodePackage("react-dom");

  let result = code;

  // Replace bare react imports with absolute file:// paths
  if (reactJsxPath) {
    result = result.replace(
      /from\s+['"]react\/jsx-runtime['"]/g,
      `from "file://${reactJsxPath}"`,
    );
  }
  if (reactJsxDevPath) {
    result = result.replace(
      /from\s+['"]react\/jsx-dev-runtime['"]/g,
      `from "file://${reactJsxDevPath}"`,
    );
  }
  if (reactDomPath) {
    result = result.replace(
      /from\s+['"]react-dom['"]/g,
      `from "file://${reactDomPath}"`,
    );
  }
  if (reactPath) {
    result = result.replace(
      /from\s+['"]react['"]/g,
      `from "file://${reactPath}"`,
    );
  }

  return result;
}

export interface ESMLoaderContext {
  esmCacheDir?: string;
  moduleCache: LRUCache<string, MDXModule>;
}

export function hashString(input: string): string {
  const HASH_SEED_FNV1A = 2166136261;
  let hash = HASH_SEED_FNV1A >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Creates an esbuild plugin to fetch and bundle HTTP/HTTPS imports.
 * This allows Node.js to use remote imports via esbuild bundling.
 */
function createHTTPPluginForMDX(): import("esbuild").Plugin {
  return {
    name: "vf-mdx-http-fetch",
    setup(build) {
      // Intercept HTTP/HTTPS imports
      build.onResolve({ filter: /^(http|https):\/\// }, (args) => ({
        path: args.path,
        namespace: "http-url",
      }));

      // Resolve relative imports within HTTP modules
      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
          return { path: args.path, namespace: "http-url" };
        }
        try {
          const resolved = new URL(args.path, args.importer).toString();
          return { path: resolved, namespace: "http-url" };
        } catch {
          return undefined;
        }
      });

      // Fetch and return HTTP module contents
      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;
        try {
          const u = new URL(args.path);
          // Optimize esm.sh URLs
          if (u.hostname === "esm.sh") {
            if (u.pathname.includes("/denonext/")) {
              u.pathname = u.pathname.replace("/denonext/", "/");
            }
            u.searchParams.set("target", "es2020");
            u.searchParams.set("bundle", "true");
            requestUrl = u.toString();
          }
        } catch {
          // Use original URL if parsing fails
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HTTP_MODULE_FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(requestUrl, {
            headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!res.ok) {
            return {
              errors: [{ text: `Failed to fetch ${args.path}: ${res.status}` }],
            };
          }

          const text = await res.text();
          return { contents: text, loader: "js" };
        } catch (e) {
          clearTimeout(timeout);
          return {
            errors: [{
              text: `Failed to fetch ${args.path}: ${e instanceof Error ? e.message : String(e)}`,
            }],
          };
        }
      });
    },
  };
}

export async function loadModuleESM(
  compiledProgramCode: string,
  context: ESMLoaderContext,
): Promise<MDXModule> {
  try {
    const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
    const adapter = await getAdapter();

    if (!context.esmCacheDir) {
      if (IS_TRUE_NODE) {
        // On Node.js, use a cache dir inside the project so module resolution works
        // Node.js resolves bare imports relative to the file location
        const projectCacheDir = join(
          cwd(),
          "node_modules",
          ".cache",
          "veryfront-mdx",
        );
        await adapter.fs.mkdir(projectCacheDir, { recursive: true });
        context.esmCacheDir = projectCacheDir;
      } else {
        // On Deno, system temp dir is fine
        context.esmCacheDir = await adapter.fs.makeTempDir("veryfront-mdx-esm-");
      }
    }

    // Transform imports with import map
    let rewritten: string;
    if (IS_TRUE_NODE) {
      // On Node.js, transform react imports to absolute file:// paths
      // This is needed because MDX modules are cached in temp directories
      // where Node.js cannot resolve bare imports
      rewritten = await transformReactImportsToAbsolute(compiledProgramCode);
    } else {
      // On Deno/browser, transform to esm.sh URLs
      rewritten = transformImportsWithMap(
        compiledProgramCode,
        getDefaultImportMap(),
        undefined,
        { resolveBare: true },
      );
    }

    // Transform JSX/TSX imports using esbuild
    // This handles user components that use JSX syntax
    let jsxMatch;
    const jsxTransforms: Array<{ original: string; transformed: string }> = [];

    // Import esbuild once outside the loop for better performance
    const { transform } = await import("esbuild/mod.js");

    while ((jsxMatch = JSX_IMPORT_PATTERN.exec(rewritten)) !== null) {
      const [fullMatch, importClause, filePath, ext] = jsxMatch;

      if (!filePath) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping JSX import with undefined file path`, {
          fullMatch,
        });
        continue;
      }

      try {
        // Read the JSX file (filePath already includes full path)
        const jsxCode = await adapter.fs.readFile(filePath);

        // Use esbuild to transform JSX to JavaScript
        const result = await transform(jsxCode as string, {
          loader: ext === "tsx" ? "tsx" : "jsx",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        let transformed = result.code;

        // Add React import if not present
        if (!REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }

        // Write transformed code to temp file
        const transformedFileName = `jsx-${hashString(filePath)}.mjs`;
        const transformedPath = join(context.esmCacheDir!, transformedFileName);
        await adapter.fs.writeFile(transformedPath, transformed);

        jsxTransforms.push({
          original: fullMatch,
          transformed: `import ${importClause} from "file://${transformedPath}";`,
        });

        logger.info(
          `${LOG_PREFIX_MDX_LOADER} Transformed JSX import using esbuild: ${filePath} -> ${transformedPath}`,
        );
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
        // Keep original import if transformation fails
      }
    }

    // Apply all JSX transformations
    for (const { original, transformed } of jsxTransforms) {
      rewritten = rewritten.replace(original, transformed);
    }

    if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
      rewritten += "\nexport { MDXLayout as __vfLayout };\n";
    }

    // On Node.js, bundle HTTP imports via esbuild instead of trying to import them directly
    if (IS_TRUE_NODE && HTTP_IMPORT_PATTERN.test(rewritten)) {
      logger.info(`${LOG_PREFIX_MDX_LOADER} Bundling HTTP imports via esbuild for Node.js`);
      const { build } = await import("esbuild/mod.js");

      // Write temp source file for esbuild to process
      const tempSourcePath = join(context.esmCacheDir!, `temp-${hashString(rewritten)}.mjs`);
      await adapter.fs.writeFile(tempSourcePath, rewritten);

      try {
        const result = await build({
          entryPoints: [tempSourcePath],
          bundle: true,
          format: "esm",
          platform: "neutral",
          target: "es2020",
          write: false,
          plugins: [createHTTPPluginForMDX()],
          // Mark npm packages as external so they're not bundled
          external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        });

        const bundledCode = result.outputFiles?.[0]?.text;
        if (bundledCode) {
          rewritten = bundledCode;
          logger.info(`${LOG_PREFIX_MDX_LOADER} Successfully bundled HTTP imports`);
        }
      } catch (bundleError) {
        logger.warn(
          `${LOG_PREFIX_MDX_LOADER} Failed to bundle HTTP imports, falling back to original code`,
          bundleError,
        );
        // Keep original code if bundling fails
      } finally {
        // Clean up temp file (use unlink since rm may not exist on all adapters)
        try {
          // deno-lint-ignore no-explicit-any
          const fsAny = adapter.fs as any;
          if (typeof fsAny.rm === "function") {
            await fsAny.rm(tempSourcePath);
          } else if (typeof fsAny.unlink === "function") {
            await fsAny.unlink(tempSourcePath);
          }
          // If neither exists, just leave the temp file (it's in a cache dir anyway)
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    const codeHash = hashString(rewritten);
    const namespace = getCacheNamespace() || "default";
    const compositeKey = `${namespace}:${codeHash}`;

    const cached = context.moduleCache.get(compositeKey);
    if (cached) return cached as MDXModule;

    const nsDir = join(context.esmCacheDir, namespace);
    try {
      await adapter.fs.mkdir(nsDir, { recursive: true });
    } catch (e) {
      logger.debug(
        `${LOG_PREFIX_MDX_RENDERER} mkdir nsDir failed`,
        e instanceof Error ? e : String(e),
      );
    }

    const filePath = join(nsDir, `${codeHash}.mjs`);
    try {
      const stat = await adapter.fs.stat(filePath);
      if (!stat?.isFile) {
        await adapter.fs.writeFile(filePath, rewritten);
      }
    } catch (error) {
      logger.debug(`${LOG_PREFIX_MDX_RENDERER} Writing temporary MDX module file:`, error);
      await adapter.fs.writeFile(filePath, rewritten);
    }

    logger.info(`${LOG_PREFIX_MDX_RENDERER} Loading MDX module`, {
      filePath,
      codePreview: rewritten.substring(0, 300),
    });
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
    return result;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_RENDERER} MDX ESM load failed:`, error);
    throw error;
  }
}
