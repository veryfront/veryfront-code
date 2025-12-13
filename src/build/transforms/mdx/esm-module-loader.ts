import { rendererLogger as logger } from "@veryfront/utils";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import * as BundledReact from "react";
import { getCacheNamespace } from "@veryfront/utils/cache/keys/namespace.ts";
import {
  getDefaultImportMap,
  transformImportsWithMap,
} from "@veryfront/modules/import-map/index.ts";
import type { MDXFrontmatter, MDXModule } from "./types.ts";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";
import { isCompiledBinary } from "../../../core/utils/platform.ts";

const IS_TRUE_NODE = isNode && !isDeno;

// Inject the bundled React into globalThis so dynamically loaded MDX modules
// can use the same React instance as the SSR renderer. This prevents
// "objects with keys $$typeof, type, key, ref, props" errors (React #31)
// that occur when elements are created with one React and rendered with another.
declare global {
  // deno-lint-ignore no-var
  var __VERYFRONT_REACT__: typeof BundledReact | undefined;
}
globalThis.__VERYFRONT_REACT__ = BundledReact;
// Also set global React so that any library checking for global React finds ours
// @ts-ignore - intentionally setting global React for library compatibility
(globalThis as Record<string, unknown>).React = BundledReact;

const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";
const JSX_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(jsx|tsx))['"];?/g;
const EXTENSIONLESS_FILE_IMPORT_PATTERN =
  /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+)['"];?/g;
const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;
const HTTP_IMPORT_PATTERN = /['"]https?:\/\/[^'"]+['"]/;
const ESBUILD_JSX_FACTORY = "React.createElement";
const ESBUILD_JSX_FRAGMENT = "React.Fragment";
const HTTP_MODULE_FETCH_TIMEOUT_MS = 30000;
const IMPORT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

const PATH_ALIAS_PATTERN = /from\s+['"]@\/([^'"]+)['"]/g;

/**
 * REACT_VERSION constant for esm.sh React dependency pinning.
 * All third-party React libraries must use this version to prevent
 * "Objects are not valid as React child" errors (React #31).
 *
 * We use ?deps=react@version instead of ?external=react because:
 * - ?external=react generates bare "react" imports which Deno can't resolve
 * - ?deps=react@version pins the React version while still bundling it
 * - Combined with globalThis.__VERYFRONT_REACT__, we ensure all modules
 *   use the same React instance for SSR
 */
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";
const ESM_REACT_DEPS = `react@${REACT_DEFAULT_VERSION},react-dom@${REACT_DEFAULT_VERSION}`;

/**
 * Add ?deps=react@version,react-dom@version to esm.sh URLs for third-party libraries.
 * This tells esm.sh to use a specific React version when bundling, preventing
 * version mismatches. The React imports in the generated code will be replaced
 * with globalThis.__VERYFRONT_REACT__ to ensure all modules use the same instance.
 */
function addReactDepsToEsmSh(code: string): string {
  return code.replace(
    /(["'])https:\/\/esm\.sh\/([^"'?\s]+)(\?[^"'\s]*)?(["'])/g,
    (match, q1, pkg, params, q2) => {
      // Skip react and react-dom themselves
      if (pkg.startsWith("react@") || pkg.startsWith("react-dom@")) return match;
      // Skip react subpaths like react/jsx-runtime
      if (pkg.startsWith("react/") || pkg.startsWith("react-dom/")) return match;

      // If already has deps=react, keep as is
      if (params && params.includes("deps=react")) {
        return match;
      }

      let newParams = params || "";
      // Remove any no-external or external parameter
      newParams = newParams.replace(/[?&]no-external/g, "");
      newParams = newParams.replace(/[?&]external=[^&]*/g, "");
      // Clean up double ampersands or trailing ?
      newParams = newParams.replace(/^\?&/, "?").replace(/&&/g, "&").replace(/\?$/, "").replace(/&$/, "");

      // Add deps=react@version,react-dom@version
      if (!newParams || newParams === "") {
        newParams = `?deps=${ESM_REACT_DEPS}`;
      } else {
        newParams = newParams + `&deps=${ESM_REACT_DEPS}`;
      }

      return `${q1}https://esm.sh/${pkg}${newParams}${q2}`;
    },
  );
}

/**
 * Replace React imports with globalThis.__VERYFRONT_REACT__ to ensure all
 * dynamically loaded modules use the same React instance as the SSR renderer.
 * This prevents React error #31 (element created with different React instance).
 *
 * Third-party libraries are configured with ?deps=react@version to use a
 * consistent React version, then their React imports are replaced with
 * globalThis.__VERYFRONT_REACT__ to share the same instance.
 */
function replaceReactImportsWithGlobal(code: string): string {
  // First, add ?deps=react@version to third-party esm.sh imports
  // This ensures libraries use the correct React version
  let result = addReactDepsToEsmSh(code);

  // Replace jsx-runtime imports from esm.sh with globalThis reference
  // This is critical - MDX uses jsx-runtime to create elements
  // Pattern: import {Fragment as _Fragment, jsxDEV as _jsxDEV} from "https://esm.sh/react@18.3.1/jsx-dev-runtime";
  // Also matches URLs with /es2020/ or other target paths
  const jsxRuntimePattern = /import\s*\{([^}]+)\}\s*from\s*["']https:\/\/esm\.sh\/react@[^"']*jsx(?:-dev)?-runtime[^"']*["'];?/g;
  result = result.replace(jsxRuntimePattern, (_match, namedImports: string) => {
    // Parse the named imports and create assignments from globalThis.__VERYFRONT_REACT__
    const imports = namedImports.split(",").map((imp: string) => imp.trim());
    const assignments = imports.map((imp: string) => {
      const parts = imp.split(/\s+as\s+/);
      const originalName = parts[0]?.trim() || "";
      const alias = parts[1]?.trim() || originalName;
      // Map jsx-runtime exports to React equivalents
      if (originalName === "jsx" || originalName === "jsxs" || originalName === "jsxDEV") {
        return `const ${alias} = (type, props, key) => globalThis.__VERYFRONT_REACT__.createElement(type, { ...props, key });`;
      } else if (originalName === "Fragment") {
        return `const ${alias} = globalThis.__VERYFRONT_REACT__.Fragment;`;
      } else {
        return `const ${alias} = globalThis.__VERYFRONT_REACT__?.${originalName};`;
      }
    });
    return assignments.join("\n");
  });

  // Replace named imports from React (e.g., import { useState, useEffect } from "https://esm.sh/react@...")
  // This is critical for hooks to work with the bundled React
  // Matches URLs like https://esm.sh/react@18.3.1 or https://esm.sh/react@18.3.1/es2020/react.mjs
  const reactNamedImportsPattern = /import\s*\{([^}]+)\}\s*from\s*["']https:\/\/esm\.sh\/react(@[^"'\/]+)?[^"']*["'];?/g;
  result = result.replace(reactNamedImportsPattern, (_match, namedImports: string) => {
    const imports = namedImports.split(",").map((imp: string) => imp.trim());
    const assignments = imports.map((imp: string) => {
      const parts = imp.split(/\s+as\s+/);
      const originalName = parts[0]?.trim() || "";
      const alias = parts[1]?.trim() || originalName;
      return `const ${alias} = globalThis.__VERYFRONT_REACT__.${originalName};`;
    });
    return assignments.join("\n");
  });

  // Pattern to match various React import forms from esm.sh URLs
  // Matches URLs like https://esm.sh/react@18.3.1, https://esm.sh/react@18.3.1/es2020/react.mjs, etc.
  const reactEsmShPattern = /import\s+(\*\s+as\s+)?(\w+)\s+from\s+["']https:\/\/esm\.sh\/react(@[^"'\/]+)?[^"']*["'];?/g;
  const reactDomEsmShPattern = /import\s+(\*\s+as\s+)?(\w+)\s+from\s+["']https:\/\/esm\.sh\/react-dom(@[^"'\/]+)?[^"']*["'];?/g;
  const reactBarePattern = /import\s+(\*\s+as\s+)?(\w+)\s+from\s+["']react["'];?/g;

  // Handle side-effect imports (import "https://esm.sh/react@...") - remove them entirely
  // These are generated by esbuild when a library depends on React but no exports are used
  const reactSideEffectPattern = /import\s+["']https:\/\/esm\.sh\/react(@[^"'\/]+)?[^"']*["'];?/g;
  const reactDomSideEffectPattern = /import\s+["']https:\/\/esm\.sh\/react-dom(@[^"'\/]+)?[^"']*["'];?/g;
  result = result.replace(reactSideEffectPattern, "// React side-effect import removed (using globalThis.__VERYFRONT_REACT__)");
  result = result.replace(reactDomSideEffectPattern, "// ReactDOM side-effect import removed");

  // Replace esm.sh React imports with globalThis reference
  result = result.replace(reactEsmShPattern, (_match, _star, name) => {
    return `const ${name} = globalThis.__VERYFRONT_REACT__;`;
  });

  // Also replace bare react imports (before they get transformed)
  result = result.replace(reactBarePattern, (_match, _star, name) => {
    return `const ${name} = globalThis.__VERYFRONT_REACT__;`;
  });

  // For react-dom, we still need the actual module for client-side hydration,
  // but for SSR we can skip it or use a stub since react-dom/server is used separately
  result = result.replace(reactDomEsmShPattern, (_match, _star, name) => {
    return `const ${name} = { createRoot: () => ({ render: () => {} }), hydrateRoot: () => ({}) };`;
  });

  return result;
}

/**
 * @deprecated Use addReactDepsToEsmSh instead.
 * This function is kept for backwards compatibility but now just delegates
 * to the new deps React approach.
 */
function addNoExternalToEsmSh(code: string): string {
  // Now using deps=react@version for proper React version pinning
  return addReactDepsToEsmSh(code);
}

const _resolvedPaths: Record<string, string | null> = {};

async function resolveNodePackage(packageSpec: string): Promise<string | null> {
  if (!IS_TRUE_NODE) return null;
  if (packageSpec in _resolvedPaths) return _resolvedPaths[packageSpec]!;

  try {
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

  const reactPath = await resolveNodePackage("react");
  const reactJsxPath = await resolveNodePackage("react/jsx-runtime");
  const reactJsxDevPath = await resolveNodePackage("react/jsx-dev-runtime");
  const reactDomPath = await resolveNodePackage("react-dom");

  let result = code;

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

async function resolveNestedImports(
  code: string,
  projectDir: string,
  cacheDir: string,
  // deno-lint-ignore no-explicit-any
  adapter: any,
  // deno-lint-ignore no-explicit-any
  localAdapter: any,
  cachedPaths: Map<string, string> = new Map(),
): Promise<string> {
  const { transform } = await import("esbuild/mod.js");

  let result = code;

  PATH_ALIAS_PATTERN.lastIndex = 0;
  result = result.replace(PATH_ALIAS_PATTERN, (_match, importPath) => {
    return `from "file://${projectDir}/${importPath}"`;
  });

  const importRegex = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+)['"]/g;
  const imports: Array<{ fullMatch: string; importClause: string; filePath: string }> = [];

  let match;
  while ((match = importRegex.exec(result)) !== null) {
    const [fullMatch, importClause, filePath] = match;
    if (!filePath) continue;
    if (IMPORT_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;
    if (!isProjectFilePath(filePath, projectDir)) continue;

    imports.push({ fullMatch, importClause, filePath });
  }

  for (const { fullMatch, importClause, filePath } of imports) {
    const existingCachePath = cachedPaths.get(filePath);
    if (existingCachePath) {
      result = result.replace(
        fullMatch,
        `import ${importClause} from "file://${existingCachePath}"`,
      );
      logger.info(`${LOG_PREFIX_MDX_LOADER} [nested] Using cached: ${filePath} -> ${existingCachePath}`);
      continue;
    }

    const cacheFileName = `nested-${hashString(filePath)}.mjs`;
    const cachePath = join(cacheDir, cacheFileName);

    cachedPaths.set(filePath, cachePath);

    try {
      const resolved = await resolveFileWithExtension(filePath, projectDir, adapter);
      if (!resolved) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} [nested] Could not resolve: ${filePath}`);
        cachedPaths.delete(filePath);
        continue;
      }

      const { extension, content } = resolved;
      let transformedContent: string;

      if (extension === ".tsx" || extension === ".jsx") {
        const esbuildResult = await transform(content, {
          loader: extension === ".tsx" ? "tsx" : "jsx",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        transformedContent = esbuildResult.code;

        if (!REACT_IMPORT_PATTERN.test(transformedContent)) {
          transformedContent = `import React from 'react';\n${transformedContent}`;
        }
      } else if (extension === ".ts") {
        const esbuildResult = await transform(content, {
          loader: "ts",
          format: "esm",
        });
        transformedContent = esbuildResult.code;
      } else {
        transformedContent = content;
      }

      transformedContent = await resolveNestedImports(
        transformedContent,
        projectDir,
        cacheDir,
        adapter,
        localAdapter,
        cachedPaths,
      );

      if (!IS_TRUE_NODE) {
        transformedContent = transformImportsWithMap(
          transformedContent,
          getDefaultImportMap(),
          undefined,
          { resolveBare: true },
        );
      }

      await localAdapter.fs.writeFile(cachePath, transformedContent);

      result = result.replace(
        fullMatch,
        `import ${importClause} from "file://${cachePath}"`,
      );

      logger.info(`${LOG_PREFIX_MDX_LOADER} [nested] Resolved: ${filePath} -> ${cachePath}`);
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} [nested] Failed to resolve: ${filePath}`, error);
      cachedPaths.delete(filePath);
    }
  }

  return result;
}

function transformPathAliasImports(code: string, projectDir: string): string {
  PATH_ALIAS_PATTERN.lastIndex = 0;

  return code.replace(PATH_ALIAS_PATTERN, (_match, importPath) => {
    return `from "file://${projectDir}/${importPath}"`;
  });
}

async function resolveFileWithExtension(
  basePath: string,
  projectDir: string,
  // deno-lint-ignore no-explicit-any
  adapter: any,
): Promise<{ resolvedPath: string; extension: string; content: string } | null> {
  const relativePath = basePath.startsWith(projectDir)
    ? basePath.slice(projectDir.length).replace(/^\
    : basePath;

  logger.info(`${LOG_PREFIX_MDX_LOADER} Trying to resolve extensionless: base=${basePath}, rel=${relativePath}`);

  for (const ext of IMPORT_EXTENSIONS) {
    const pathWithExt = `${relativePath}${ext}`;
    try {
      logger.info(`${LOG_PREFIX_MDX_LOADER} Trying extension: ${pathWithExt}`);
      const content = await adapter.fs.readFile(pathWithExt);
      if (content) {
        logger.info(`${LOG_PREFIX_MDX_LOADER} Resolved extensionless import: ${basePath} -> ${pathWithExt}`);
        return {
          resolvedPath: `${basePath}${ext}`,
          extension: ext,
          content: content as string,
        };
      }
    } catch (err) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Extension ${ext} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

function isProjectFilePath(filePath: string, projectDir: string): boolean {
  return filePath.startsWith(projectDir) || filePath.startsWith("/");
}

export interface ESMLoaderContext {
  esmCacheDir?: string;
  moduleCache: LRUCache<string, MDXModule>;
  projectDir?: string;
  adapter?: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter;
}

/**
 * Track already transpiled files to avoid infinite recursion.
 * Key includes both file path and cache directory to handle different cache dirs.
 */
const transpiledFilesCache = new Map<string, string>();

/**
 * Recursively transpile a TS/TSX/JS/JSX file and all its @/ dependencies.
 * Returns the path to the transpiled file in the cache directory.
 */
async function transpileWithDependencies(
  filePath: string,
  projectDir: string,
  cacheDir: string,
  projectAdapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter,
  localAdapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter,
): Promise<string> {
  // Check if already transpiled - include cacheDir in key to handle different sessions
  const cacheKey = `${cacheDir}:${filePath}`;
  if (transpiledFilesCache.has(cacheKey)) {
    return transpiledFilesCache.get(cacheKey)!;
  }

  // Mark as being processed to avoid circular deps
  const outputFileName = `dep-${hashString(filePath)}.mjs`;
  const outputPath = join(cacheDir, outputFileName);
  transpiledFilesCache.set(cacheKey, outputPath);

  try {
    // Read the source file
    const sourceCode = await projectAdapter.fs.readFile(filePath);
    const ext = filePath.match(/\.(tsx?|jsx?)$/)?.[0] || "";

    let transformed: string;

    // Only transpile TSX/JSX, TS needs light transformation
    if (ext === ".tsx" || ext === ".jsx") {
      const { transform } = await import("esbuild/mod.js");
      const result = await transform(sourceCode as string, {
        loader: ext === ".tsx" ? "tsx" : "jsx",
        jsx: "transform",
        jsxFactory: "React.createElement",
        jsxFragment: "React.Fragment",
        format: "esm",
      });
      transformed = result.code;

      // Add React import if not present
      if (!/import\s+.*React.*\s+from\s+['"]react['"]/.test(transformed)) {
        transformed = `import React from 'react';\n${transformed}`;
      }
    } else if (ext === ".ts") {
      const { transform } = await import("esbuild/mod.js");
      const result = await transform(sourceCode as string, {
        loader: "ts",
        format: "esm",
      });
      transformed = result.code;
    } else {
      transformed = sourceCode as string;
    }

    // Transform bare imports to esm.sh for Deno
    if (!IS_TRUE_NODE) {
      transformed = transformImportsWithMap(
        transformed,
        getDefaultImportMap(),
        undefined,
        { resolveBare: true },
      );
      transformed = addNoExternalToEsmSh(transformed);
      // Replace React imports with globalThis reference for SSR
      transformed = replaceReactImportsWithGlobal(transformed);
    }

    // Process @/ imports recursively
    const aliasImports = extractAliasImports(transformed);
    for (const aliasPath of aliasImports) {
      const extensions = [".tsx", ".ts", ".jsx", ".js", ""];
      let resolvedPath: string | null = null;

      // Try to resolve the file
      for (const tryExt of extensions) {
        const fullPath = join(projectDir, aliasPath + tryExt);
        try {
          const stat = await projectAdapter.fs.stat(fullPath);
          if (stat?.isFile) {
            resolvedPath = fullPath;
            break;
          }
        } catch {
          // File doesn't exist with this extension
        }
      }

      // Try index files
      if (!resolvedPath) {
        for (const tryExt of [".tsx", ".ts", ".jsx", ".js"]) {
          const indexPath = join(projectDir, aliasPath, `index${tryExt}`);
          try {
            const stat = await projectAdapter.fs.stat(indexPath);
            if (stat?.isFile) {
              resolvedPath = indexPath;
              break;
            }
          } catch {
            // File doesn't exist
          }
        }
      }

      if (resolvedPath) {
        // Recursively transpile the dependency
        const depCachePath = await transpileWithDependencies(
          resolvedPath,
          projectDir,
          cacheDir,
          projectAdapter,
          localAdapter,
        );
        // Rewrite the import to use the cached file
        const pattern = new RegExp(`(['"])@\\/${aliasPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
        transformed = transformed.replace(pattern, `$1file://${depCachePath}$1`);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [dep] @/${aliasPath} -> ${depCachePath}`);
      } else {
        // Stub the missing import
        logger.warn(`${LOG_PREFIX_MDX_LOADER} [dep] Missing: @/${aliasPath}`);
        transformed = stubMissingAliasImports(transformed, [aliasPath]);
      }
    }

    // Process relative imports (./something, ../something) recursively
    const relativeImportRegex = /(?:from|import)\s+["'](\.\.?\/[^"']+)["']/g;
    const relativeImports: string[] = [];
    let relMatch;
    while ((relMatch = relativeImportRegex.exec(transformed)) !== null) {
      const relPath = relMatch[1];
      if (relPath && !relativeImports.includes(relPath)) {
        relativeImports.push(relPath);
      }
    }

    // Get the directory of the original source file
    const sourceDir = filePath.replace(/\/[^/]+$/, "");

    for (const relPath of relativeImports) {
      const extensions = [".tsx", ".ts", ".jsx", ".js", ""];
      let resolvedPath: string | null = null;

      // Resolve the relative path from the original source directory
      const basePath = join(sourceDir, relPath);

      // Try to resolve the file with various extensions
      for (const tryExt of extensions) {
        const fullPath = basePath + tryExt;
        try {
          const stat = await projectAdapter.fs.stat(fullPath);
          if (stat?.isFile) {
            resolvedPath = fullPath;
            break;
          }
        } catch {
          // File doesn't exist with this extension
        }
      }

      // Try index files
      if (!resolvedPath) {
        for (const tryExt of [".tsx", ".ts", ".jsx", ".js"]) {
          const indexPath = join(basePath, `index${tryExt}`);
          try {
            const stat = await projectAdapter.fs.stat(indexPath);
            if (stat?.isFile) {
              resolvedPath = indexPath;
              break;
            }
          } catch {
            // File doesn't exist
          }
        }
      }

      if (resolvedPath) {
        // Recursively transpile the dependency
        const depCachePath = await transpileWithDependencies(
          resolvedPath,
          projectDir,
          cacheDir,
          projectAdapter,
          localAdapter,
        );
        // Rewrite the relative import to use the cached file
        const pattern = new RegExp(`(['"])${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
        transformed = transformed.replace(pattern, `$1file://${depCachePath}$1`);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [dep] ${relPath} -> ${depCachePath}`);
      } else {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} [dep] Missing relative: ${relPath}`);
      }
    }

    // Write the transpiled file
    await localAdapter.fs.writeFile(outputPath, transformed);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} [dep] Wrote: ${outputPath}`);

    return outputPath;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_LOADER} [dep] Failed to transpile: ${filePath}`, error);
    transpiledFilesCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Extract @/ alias imports from code
 */
function extractAliasImports(code: string): string[] {
  const imports: string[] = [];
  const importRegex = /(?:from|import)\s+["']@\/([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const capturedPath = match[1];
    if (capturedPath && !imports.includes(capturedPath)) {
      imports.push(capturedPath);
    }
  }
  return imports;
}

/**
 * Framework shims for common @/lib utilities that may not exist in projects.
 * These provide default implementations for usePageContext, useRouter, etc.
 */
const FRAMEWORK_SHIMS: Record<string, Record<string, string>> = {
  "lib/usePageContext": {
    usePageContext: `function usePageContext() {
      const React = arguments[0] || globalThis.React;
      if (!React) return { slug: "", path: "/", params: {}, query: {}, frontmatter: {} };
      const [ctx] = React.useState(() => ({
        slug: "",
        path: typeof window !== "undefined" ? globalThis.location?.pathname || "/" : "/",
        params: {},
        query: typeof window !== "undefined" ? Object.fromEntries(new URLSearchParams(globalThis.location?.search || "")) : {},
        frontmatter: globalThis.__VERYFRONT_PAGE_CONTEXT__?.frontmatter || {},
      }));
      return ctx;
    }`,
  },
  "lib/Router": {
    useRouter: `function useRouter() {
      return {
        pathname: typeof window !== "undefined" ? globalThis.location?.pathname || "/" : "/",
        push: (url) => { if (typeof window !== "undefined") globalThis.location.href = url; },
        replace: (url) => { if (typeof window !== "undefined") globalThis.location.replace(url); },
        back: () => { if (typeof window !== "undefined") globalThis.history?.back(); },
        query: typeof window !== "undefined" ? Object.fromEntries(new URLSearchParams(globalThis.location?.search || "")) : {},
      };
    }`,
  },
};

/**
 * Convert @/ imports to stub imports that throw errors for missing modules.
 * For known framework utilities, provides actual implementations.
 * This allows the module to load and only fails if the missing component is actually used.
 */
function stubMissingAliasImports(code: string, missingPaths: string[]): string {
  let result = code;
  for (const path of missingPaths) {
    // Check if this is a known framework shim
    const shim = FRAMEWORK_SHIMS[path];

    // Replace imports with stub that throws on use OR with framework shim
    const importPattern = new RegExp(
      `import\\s+\\{([^}]+)\\}\\s+from\\s+["']@\\/${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'];?`,
      "g",
    );
    result = result.replace(importPattern, (_match, namedImports: string) => {
      const names = namedImports.split(",").map((n: string) => n.trim().split(/\s+as\s+/)[0]?.trim()).filter((n): n is string => Boolean(n));
      const stubs = names.map((name) => {
        // Use framework shim if available
        if (shim && shim[name]) {
          return `const ${name} = ${shim[name]}`;
        }
        return `const ${name} = () => { throw new Error("Missing module: @/${path}"); };`;
      }).join("\n");
      return stubs;
    });

    // Handle default imports
    const defaultPattern = new RegExp(
      `import\\s+(\\w+)\\s+from\\s+["']@\\/${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'];?`,
      "g",
    );
    result = result.replace(defaultPattern, (_match, name: string) => {
      // Use framework shim if available for default export
      if (shim && shim[name]) {
        return `const ${name} = ${shim[name]}`;
      }
      return `const ${name} = () => { throw new Error("Missing module: @/${path}"); };`;
    });
  }
  return result;
}

export function hashString(input: string): string {
  const HASH_SEED_FNV1A = 2166136261;
  let hash = HASH_SEED_FNV1A >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createHTTPPluginForMDX(): import("esbuild").Plugin {
  return {
    name: "vf-mdx-http-fetch",
    setup(build) {
      // Externalize React and ReactDOM from esm.sh to preserve as imports (will be replaced with globalThis later)
      // This is critical for Deno compiled binaries to avoid bundling multiple React instances
      // Match URLs like: https://esm.sh/react@18.3.1, https://esm.sh/react@18.3.1/jsx-runtime, etc.
      build.onResolve({ filter: /^https:\/\/esm\.sh\/(react|react-dom)/ }, (args) => {
        // Mark as external so it stays as an import statement
        // Note: This will be replaced with globalThis.__VERYFRONT_REACT__ later
        return { path: args.path, external: true };
      });

      // Handle HTTP/HTTPS URLs (non-React)
      build.onResolve({ filter: /^(http|https):\/\// }, (args) => ({
        path: args.path,
        namespace: "http-url",
      }));

      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        // Helper to check if a URL is for React/ReactDOM
        const isReactUrl = (url: string) => /\/esm\.sh\/(react|react-dom)(@|\/|$)/.test(url);

        if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
          // Externalize React imports to prevent bundling multiple instances
          if (isReactUrl(args.path)) {
            return { path: args.path, external: true };
          }
          return { path: args.path, namespace: "http-url" };
        }
        try {
          const resolved = new URL(args.path, args.importer).toString();
          // Externalize React imports to prevent bundling multiple instances
          if (isReactUrl(resolved)) {
            return { path: resolved, external: true };
          }
          return { path: resolved, namespace: "http-url" };
        } catch {
          return undefined;
        }
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;
        try {
          const u = new URL(args.path);
          if (u.hostname === "esm.sh") {
            if (u.pathname.includes("/denonext/")) {
              u.pathname = u.pathname.replace("/denonext/", "/");
            }
            u.searchParams.set("target", "es2020");
            u.searchParams.set("bundle", "true");
            requestUrl = u.toString();
          }
        } catch {
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

      // Handle file:// URLs (for temp files created during JSX transformation)
      // This is needed for Deno compiled binaries where all dependencies must be bundled
      build.onResolve({ filter: /^file:\/\// }, (args) => ({
        path: args.path,
        namespace: "file-url",
      }));

      build.onResolve({ filter: /.*/, namespace: "file-url" }, (args) => {
        if (args.path.startsWith("file://")) {
          return { path: args.path, namespace: "file-url" };
        }
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
          return { path: args.path, namespace: "http-url" };
        }
        // Resolve relative paths against the importer
        try {
          const importerUrl = new URL(args.importer);
          const resolvedUrl = new URL(args.path, importerUrl);
          return { path: resolvedUrl.toString(), namespace: "file-url" };
        } catch {
          return undefined;
        }
      });

      build.onLoad({ filter: /.*/, namespace: "file-url" }, async (args) => {
        try {
          const filePath = args.path.replace(/^file:\/\//, "");
          const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
          const adapter = await getAdapter();
          const contents = await adapter.fs.readFile(filePath);
          return { contents: contents as string, loader: "js" };
        } catch (e) {
          return {
            errors: [{
              text: `Failed to read file ${args.path}: ${e instanceof Error ? e.message : String(e)}`,
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
    // Get the default local adapter for local filesystem operations (temp dirs, writing compiled files)
    const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
    const localAdapter = await getAdapter();

    // Use adapter from context if provided (e.g., for remote FSAdapter) for reading project files
    // Fall back to local adapter if no context adapter
    const projectAdapter = context.adapter || localAdapter;

    if (!context.esmCacheDir) {
      if (IS_TRUE_NODE) {
        const projectCacheDir = join(
          cwd(),
          "node_modules",
          ".cache",
          "veryfront-mdx",
        );
        await localAdapter.fs.mkdir(projectCacheDir, { recursive: true });
        context.esmCacheDir = projectCacheDir;
      } else {
        context.esmCacheDir = await localAdapter.fs.makeTempDir("veryfront-mdx-esm-");
      }
    }

    let rewritten: string;
    if (IS_TRUE_NODE) {
      // This is needed because MDX modules are cached in temp directories
      rewritten = await transformReactImportsToAbsolute(compiledProgramCode);
    } else {
      rewritten = transformImportsWithMap(
        compiledProgramCode,
        getDefaultImportMap(),
        undefined,
        { resolveBare: true },
      );
      // Add ?no-external to esm.sh URLs to bundle React instead of externalizing
      rewritten = addNoExternalToEsmSh(rewritten);
      // Replace React imports from esm.sh with globalThis reference to use bundled React
      // This prevents React version mismatch errors during SSR
      rewritten = replaceReactImportsWithGlobal(rewritten);
    }

    // Handle @/ alias imports - recursively transpile dependencies
    const aliasImports = extractAliasImports(rewritten);
    const projectDir = context.projectDir || cwd();
    for (const aliasPath of aliasImports) {
      // Check if the file exists with various extensions
      const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ""];
      let resolvedPath: string | null = null;

      for (const ext of extensions) {
        const fullPath = join(projectDir, aliasPath + ext);
        try {
          const stat = await projectAdapter.fs.stat(fullPath);
          if (stat?.isFile) {
            resolvedPath = fullPath;
            break;
          }
        } catch {
          // File doesn't exist with this extension
        }
      }

      // Also check for index files
      if (!resolvedPath) {
        for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
          const indexPath = join(projectDir, aliasPath, `index${ext}`);
          try {
            const stat = await projectAdapter.fs.stat(indexPath);
            if (stat?.isFile) {
              resolvedPath = indexPath;
              break;
            }
          } catch {
            // File doesn't exist
          }
        }
      }

      if (resolvedPath) {
        // Recursively transpile the dependency
        const depCachePath = await transpileWithDependencies(
          resolvedPath,
          projectDir,
          context.esmCacheDir!,
          projectAdapter,
          localAdapter,
        );
        const pattern = new RegExp(`(['"])@\\/${aliasPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
        rewritten = rewritten.replace(pattern, `$1file://${depCachePath}$1`);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} @/${aliasPath} -> ${depCachePath}`);
      } else {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Missing @/ import: @/${aliasPath}`);
        rewritten = stubMissingAliasImports(rewritten, [aliasPath]);
      }
    }

    let jsxMatch;
    const jsxTransforms: Array<{ original: string; transformed: string }> = [];

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
        const jsxCode = await projectAdapter.fs.readFile(filePath);

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

        // Transform bare imports (like 'react') to esm.sh URLs for Deno compatibility
        if (!IS_TRUE_NODE) {
          transformed = transformImportsWithMap(
            transformed,
            getDefaultImportMap(),
            undefined,
            { resolveBare: true },
          );
          transformed = addNoExternalToEsmSh(transformed);
          // Replace React imports with globalThis reference for SSR
          transformed = replaceReactImportsWithGlobal(transformed);
        }

        // Also resolve @/ imports in JSX files - recursively transpile dependencies
        const jsxAliasImports = extractAliasImports(transformed);
        for (const aliasPath of jsxAliasImports) {
          const extensions = [".tsx", ".ts", ".jsx", ".js", ""];
          let resolvedPath: string | null = null;

          for (const ext of extensions) {
            const fullPath = join(projectDir, aliasPath + ext);
            try {
              const stat = await projectAdapter.fs.stat(fullPath);
              if (stat?.isFile) {
                resolvedPath = fullPath;
                break;
              }
            } catch {
              // File doesn't exist
            }
          }

          // Also check for index files
          if (!resolvedPath) {
            for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
              const indexPath = join(projectDir, aliasPath, `index${ext}`);
              try {
                const stat = await projectAdapter.fs.stat(indexPath);
                if (stat?.isFile) {
                  resolvedPath = indexPath;
                  break;
                }
              } catch {
                // File doesn't exist
              }
            }
          }

          if (resolvedPath) {
            // Recursively transpile the dependency
            const depCachePath = await transpileWithDependencies(
              resolvedPath,
              projectDir,
              context.esmCacheDir!,
              projectAdapter,
              localAdapter,
            );
            const pattern = new RegExp(`(['"])@\\/${aliasPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
            transformed = transformed.replace(pattern, `$1file://${depCachePath}$1`);
            logger.debug(`${LOG_PREFIX_MDX_LOADER} [JSX] @/${aliasPath} -> ${depCachePath}`);
          } else {
            logger.warn(`${LOG_PREFIX_MDX_LOADER} [JSX] Missing @/ import: @/${aliasPath}`);
            transformed = stubMissingAliasImports(transformed, [aliasPath]);
          }
        }

        const transformedFileName = `jsx-${hashString(filePath)}.mjs`;
        const transformedPath = join(context.esmCacheDir!, transformedFileName);
        await localAdapter.fs.writeFile(transformedPath, transformed);

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

    for (const { original, transformed } of jsxTransforms) {
      rewritten = rewritten.replace(original, transformed);
    }

    let extMatch;
    const extTransforms: Array<{ original: string; transformed: string }> = [];
    const processedPaths = new Set<string>();

    EXTENSIONLESS_FILE_IMPORT_PATTERN.lastIndex = 0;

    while ((extMatch = EXTENSIONLESS_FILE_IMPORT_PATTERN.exec(rewritten)) !== null) {
      const [fullMatch, importClause, filePath] = extMatch;

      if (!filePath) continue;

      if (IMPORT_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;

      if (processedPaths.has(filePath)) continue;
      processedPaths.add(filePath);

      const projectDir = cwd();
      if (!isProjectFilePath(filePath, projectDir)) continue;

      logger.info(`${LOG_PREFIX_MDX_LOADER} Found extensionless import: ${filePath}`);

      try {
        const resolved = await resolveFileWithExtension(filePath, projectDir, adapter);
        if (!resolved) {
          logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve extension for: ${filePath}`);
          continue;
        }

        const { extension, content } = resolved;

        if (extension === ".tsx" || extension === ".jsx") {
          const result = await transform(content, {
            loader: extension === ".tsx" ? "tsx" : "jsx",
            jsx: "transform",
            jsxFactory: ESBUILD_JSX_FACTORY,
            jsxFragment: ESBUILD_JSX_FRAGMENT,
            format: "esm",
          });

          let transformedCode = result.code;

          if (!REACT_IMPORT_PATTERN.test(transformedCode)) {
            transformedCode = `import React from 'react';\n${transformedCode}`;
          }

          transformedCode = await resolveNestedImports(
            transformedCode,
            projectDir,
            context.esmCacheDir!,
            adapter,
            localAdapter,
          );

          if (!IS_TRUE_NODE) {
            transformedCode = transformImportsWithMap(
              transformedCode,
              getDefaultImportMap(),
              undefined,
              { resolveBare: true },
            );
          }

          const transformedFileName = `resolved-${hashString(filePath)}.mjs`;
          const transformedPath = join(context.esmCacheDir!, transformedFileName);
          await localAdapter.fs.writeFile(transformedPath, transformedCode);

          extTransforms.push({
            original: fullMatch,
            transformed: `import ${importClause} from "file://${transformedPath}";`,
          });

          logger.info(
            `${LOG_PREFIX_MDX_LOADER} Resolved and transformed extensionless import: ${filePath} -> ${transformedPath}`,
          );
        } else {
          const resolvedFileName = `resolved-${hashString(filePath)}.mjs`;
          const resolvedPath = join(context.esmCacheDir!, resolvedFileName);

          let transformedCode: string;

          if (extension === ".ts") {
            const result = await transform(content, {
              loader: "ts",
              format: "esm",
            });
            transformedCode = result.code;
          } else {
            transformedCode = content;
          }

          transformedCode = await resolveNestedImports(
            transformedCode,
            projectDir,
            context.esmCacheDir!,
            adapter,
            localAdapter,
          );

          if (!IS_TRUE_NODE) {
            transformedCode = transformImportsWithMap(
              transformedCode,
              getDefaultImportMap(),
              undefined,
              { resolveBare: true },
            );
          }

          await localAdapter.fs.writeFile(resolvedPath, transformedCode);

          extTransforms.push({
            original: fullMatch,
            transformed: `import ${importClause} from "file://${resolvedPath}";`,
          });

          logger.info(
            `${LOG_PREFIX_MDX_LOADER} Resolved extensionless import: ${filePath} -> ${resolvedPath}`,
          );
        }
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to resolve extensionless import: ${filePath}`, error);
      }
    }

    for (const { original, transformed } of extTransforms) {
      rewritten = rewritten.replace(original, transformed);
    }

    if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
      rewritten += "\nexport { MDXLayout as __vfLayout };\n";
    }

    // Bundle HTTP imports for Node.js OR Deno compiled binaries
    // Deno compiled binaries cannot fetch remote URLs at runtime (fundamental Deno limitation)
    // so we must bundle all esm.sh dependencies at build time
    // Also bundle when there are file:// imports, as those temp files may contain HTTP imports
    const FILE_URL_PATTERN = /from\s+["']file:\/\//;
    const hasHttpOrFileImports = HTTP_IMPORT_PATTERN.test(rewritten) || FILE_URL_PATTERN.test(rewritten);
    const needsHttpBundling = (IS_TRUE_NODE || isCompiledBinary()) && hasHttpOrFileImports;
    if (needsHttpBundling) {
      const runtimeContext = IS_TRUE_NODE ? "Node.js" : "Deno compiled binary";
      logger.info(`${LOG_PREFIX_MDX_LOADER} Bundling HTTP imports via esbuild for ${runtimeContext}`);
      const { build } = await import("esbuild/mod.js");

      const tempSourcePath = join(context.esmCacheDir!, `temp-${hashString(rewritten)}.mjs`);
      await localAdapter.fs.writeFile(tempSourcePath, rewritten);

      try {
        // For Node.js, externalize React (resolved via node_modules)
        // For Deno compiled binary, bundle everything from esm.sh
        const externalPackages = IS_TRUE_NODE
          ? ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"]
          : [];

        const result = await build({
          entryPoints: [tempSourcePath],
          bundle: true,
          format: "esm",
          platform: "neutral",
          target: "es2020",
          write: false,
          plugins: [createHTTPPluginForMDX()],
          external: externalPackages,
        });

        const bundledCode = result.outputFiles?.[0]?.text;
        if (bundledCode) {
          rewritten = bundledCode;

          // For Deno compiled binary, replace bundled React imports with globalThis reference
          // This ensures all modules use the same React instance (prevents React #31 errors)
          if (!IS_TRUE_NODE) {
            rewritten = replaceReactImportsWithGlobal(rewritten);
          }

          logger.info(`${LOG_PREFIX_MDX_LOADER} Successfully bundled HTTP imports`);
        }
      } catch (bundleError) {
        logger.warn(
          `${LOG_PREFIX_MDX_LOADER} Failed to bundle HTTP imports, falling back to original code`,
          bundleError,
        );
      } finally {
        try {
          // deno-lint-ignore no-explicit-any
          const fsAny = localAdapter.fs as any;
          if (typeof fsAny.rm === "function") {
            await fsAny.rm(tempSourcePath);
          } else if (typeof fsAny.unlink === "function") {
            await fsAny.unlink(tempSourcePath);
          }
        } catch {
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
      await localAdapter.fs.mkdir(nsDir, { recursive: true });
    } catch (e) {
      logger.debug(
        `${LOG_PREFIX_MDX_RENDERER} mkdir nsDir failed`,
        e instanceof Error ? e : String(e),
      );
    }

    const filePath = join(nsDir, `${codeHash}.mjs`);
    try {
      const stat = await localAdapter.fs.stat(filePath);
      if (!stat?.isFile) {
        await localAdapter.fs.writeFile(filePath, rewritten);
      }
    } catch (error) {
      logger.debug(`${LOG_PREFIX_MDX_RENDERER} Writing temporary MDX module file:`, error);
      await localAdapter.fs.writeFile(filePath, rewritten);
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
