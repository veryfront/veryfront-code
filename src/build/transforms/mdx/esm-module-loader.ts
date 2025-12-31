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
import { transformToESM } from "../esm-transform.ts";
import type { RuntimeAdapter } from "../../../platform/adapters/base.ts";

// True Node.js runtime (not Deno with Node.js compat)
const IS_TRUE_NODE = isNode && !isDeno;

// Constants
const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";
const JSX_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(jsx|tsx))['"];?/g;
const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;
const HTTP_IMPORT_PATTERN = /['"]https?:\/\/[^'"]+['"]/;
// Pattern for @/ aliased imports (project-relative paths)
const PROJECT_ALIAS_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]@\/([^'"]+)['"];?/g;
// Pattern for /_vf_modules/ imports (browser-style module URLs)
const MODULE_SERVER_IMPORT_PATTERN = /from\s+["']\/?_vf_modules\/([^"']+)["']/g;
const ESBUILD_JSX_FACTORY = "React.createElement";
const ESBUILD_JSX_FRAGMENT = "React.Fragment";
const HTTP_MODULE_FETCH_TIMEOUT_MS = 30000;

// Cache for resolved react package paths (Node.js only)
const _resolvedPaths: Record<string, string | null> = {};

// Persistent module path cache - survives across requests
// Maps normalized module paths to their disk cache file paths
let _modulePathCache: Map<string, string> | null = null;
let _modulePathCacheLoaded = false;

async function getModulePathCache(cacheDir: string): Promise<Map<string, string>> {
  if (_modulePathCache && _modulePathCacheLoaded) {
    return _modulePathCache;
  }

  _modulePathCache = new Map();
  const indexPath = join(cacheDir, "_index.json");

  try {
    const content = await Deno.readTextFile(indexPath);
    const index = JSON.parse(content) as Record<string, string>;
    for (const [path, cachePath] of Object.entries(index)) {
      _modulePathCache.set(path, cachePath);
    }
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Loaded module index: ${_modulePathCache.size} entries`);
  } catch {
    // Index doesn't exist yet
  }

  _modulePathCacheLoaded = true;
  return _modulePathCache;
}

async function saveModulePathCache(cacheDir: string): Promise<void> {
  if (!_modulePathCache) return;

  const indexPath = join(cacheDir, "_index.json");
  const index: Record<string, string> = {};
  for (const [path, cachePath] of _modulePathCache.entries()) {
    index[path] = cachePath;
  }

  try {
    await Deno.writeTextFile(indexPath, JSON.stringify(index));
  } catch (error) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to save module index`, error);
  }
}

/**
 * Clear the in-memory module path cache.
 * Called on invalidation to force re-checking disk cache.
 */
export function clearModulePathCache(): void {
  _modulePathCache = null;
  _modulePathCacheLoaded = false;
  logger.info(`${LOG_PREFIX_MDX_LOADER} Cleared module path cache`);
}

/**
 * Invalidate specific module paths from the cache.
 * Called on selective invalidation when specific files are edited.
 * This is much faster than clearing the entire cache.
 */
export function invalidateModulePaths(changedPaths: string[]): void {
  if (!_modulePathCache) return;

  let invalidatedCount = 0;

  for (const changedPath of changedPaths) {
    // Normalize the path for matching
    const normalizedChanged = changedPath.replace(/^\/+/, "").replace(/\.(tsx?|jsx?|mdx)$/, "");

    // Find and remove all cache entries that match or depend on this file
    for (const [cachedPath, _cachePath] of _modulePathCache.entries()) {
      const normalizedCached = cachedPath
        .replace(/^_vf_modules\//, "")
        .replace(/\.js$/, "");

      // Check if the cached module matches the changed file
      if (
        normalizedCached === normalizedChanged ||
        normalizedCached.endsWith(`/${normalizedChanged}`) ||
        normalizedChanged.endsWith(`/${normalizedCached}`)
      ) {
        _modulePathCache.delete(cachedPath);
        invalidatedCount++;
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Invalidated module: ${cachedPath}`);
      }
    }
  }

  logger.info(
    `${LOG_PREFIX_MDX_LOADER} Selective invalidation: ${invalidatedCount} modules for ${changedPaths.length} files`,
  );
}

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

/**
 * Add ?external=react,react-dom to esm.sh URLs for SSR.
 * This prevents esm.sh from bundling its own React copy,
 * ensuring all packages use our npm:react instance.
 */
function addExternalToEsmShUrls(code: string): string {
  if (IS_TRUE_NODE) return code; // Only for Deno

  // Match esm.sh URLs that don't already have external param
  return code.replace(
    /from\s+["'](https:\/\/esm\.sh\/[^"']+)["']/g,
    (match, url) => {
      // Skip if already has external param
      if (url.includes("external=")) {
        return match;
      }
      // Skip React packages - they're normalized separately
      if (url.includes("/react@") || url.includes("/react-dom@")) {
        return match;
      }
      // Add external param
      const separator = url.includes("?") ? "&" : "?";
      return `from "${url}${separator}external=react,react-dom"`;
    },
  );
}

/**
 * Normalize React imports to use consistent npm: specifiers for Deno SSR.
 * Third-party packages like @tanstack/react-query always use npm:react,
 * so we must use npm: everywhere to ensure consistent React instances.
 */
function normalizeReactToNpm(code: string): string {
  if (IS_TRUE_NODE) return code; // Only for Deno

  // Use explicit version to ensure consistent resolution
  const REACT_VERSION = "18.3.1";
  let result = code;

  // IMPORTANT: Process subpath imports FIRST (jsx-runtime, jsx-dev-runtime, server)
  // before processing base imports.

  // 1. Normalize esm.sh URLs WITH subpaths to npm: specifiers
  result = result.replace(
    /from\s+['"]https:\/\/esm\.sh\/react@[^'"\/]+\/jsx-dev-runtime[^'"]*['"]/g,
    `from "npm:react@${REACT_VERSION}/jsx-dev-runtime"`,
  );
  result = result.replace(
    /from\s+['"]https:\/\/esm\.sh\/react@[^'"\/]+\/jsx-runtime[^'"]*['"]/g,
    `from "npm:react@${REACT_VERSION}/jsx-runtime"`,
  );
  result = result.replace(
    /from\s+['"]https:\/\/esm\.sh\/react-dom@[^'"\/]+\/server[^'"]*['"]/g,
    `from "npm:react-dom@${REACT_VERSION}/server"`,
  );

  // 2. Normalize unversioned npm: specifiers WITH subpaths
  result = result.replace(
    /from\s+['"]npm:react\/jsx-dev-runtime['"]/g,
    `from "npm:react@${REACT_VERSION}/jsx-dev-runtime"`,
  );
  result = result.replace(
    /from\s+['"]npm:react\/jsx-runtime['"]/g,
    `from "npm:react@${REACT_VERSION}/jsx-runtime"`,
  );
  result = result.replace(
    /from\s+['"]npm:react-dom\/server['"]/g,
    `from "npm:react-dom@${REACT_VERSION}/server"`,
  );

  // 3. Normalize esm.sh base URLs to npm:
  result = result.replace(
    /from\s+['"]https:\/\/esm\.sh\/react@[^'"\/]+['"]/g,
    `from "npm:react@${REACT_VERSION}"`,
  );
  result = result.replace(
    /from\s+['"]https:\/\/esm\.sh\/react-dom@[^'"\/]+['"]/g,
    `from "npm:react-dom@${REACT_VERSION}"`,
  );

  // 4. Normalize unversioned npm: base specifiers
  result = result.replace(
    /from\s+['"]npm:react['"]/g,
    `from "npm:react@${REACT_VERSION}"`,
  );
  result = result.replace(
    /from\s+['"]npm:react-dom['"]/g,
    `from "npm:react-dom@${REACT_VERSION}"`,
  );

  // 5. Normalize @tanstack/react-query to esm.sh for consistent context sharing
  // All react-query imports must use the same source to share QueryClient context
  result = result.replace(
    /from\s+['"]npm:@tanstack\/react-query(?:@[^'"\/]+)?['"]/g,
    `from "https://esm.sh/@tanstack/react-query?external=react,react-dom"`,
  );

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
 * Clear the persistent ESM disk cache.
 * Called when files are updated via Studio to ensure fresh content is served.
 */
export async function clearESMDiskCache(): Promise<void> {
  const cacheDir = join(cwd(), ".cache", "veryfront-mdx-esm");
  try {
    // Remove all cached module files
    for await (const entry of Deno.readDir(cacheDir)) {
      if (entry.isFile && entry.name.endsWith(".mjs")) {
        await Deno.remove(join(cacheDir, entry.name));
      }
    }
    logger.info(`${LOG_PREFIX_MDX_LOADER} Cleared ESM disk cache`);
  } catch (error) {
    // Cache dir might not exist yet
    if (!(error instanceof Deno.errors.NotFound)) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to clear ESM disk cache`, error);
    }
  }
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

interface FSAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isFile?: boolean } | null>;
  makeTempDir(prefix: string): Promise<string>;
}

/**
 * Transform @/ aliased imports to file:// paths
 * @/ is a project-relative alias that maps to the project root
 */
async function _transformProjectAliasImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
): Promise<string> {
  const imports: Array<{
    original: string;
    importClause: string;
    relativePath: string;
  }> = [];

  // Find all @/ imports
  let match;
  const pattern = new RegExp(PROJECT_ALIAS_IMPORT_PATTERN.source, "g");
  while ((match = pattern.exec(code)) !== null) {
    const [original, importClause, relativePath] = match;
    if (relativePath && importClause) {
      imports.push({ original, importClause, relativePath });
    }
  }

  if (imports.length === 0) {
    return code;
  }

  logger.info(`${LOG_PREFIX_MDX_LOADER} Found ${imports.length} @/ imports to transform`);

  const { transform } = await import("esbuild/mod.js");
  let result = code;

  for (const { original, importClause, relativePath } of imports) {
    // Try common extensions
    const extensions = ["", ".tsx", ".ts", ".jsx", ".js", ".mdx"];
    let fileContent: string | null = null;
    let resolvedPath: string | null = null;
    let ext: string = "";

    for (const tryExt of extensions) {
      const tryPath = relativePath + tryExt;
      try {
        const content = await fs.readFile(tryPath);
        fileContent = typeof content === "string" ? content : new TextDecoder().decode(content);
        resolvedPath = tryPath;
        ext = tryExt || tryPath.split(".").pop() || "";
        break;
      } catch {
        // Try next extension
      }
    }

    // Also try index files
    if (!fileContent) {
      for (const tryExt of [".tsx", ".ts", ".jsx", ".js", ".mdx"]) {
        const tryPath = `${relativePath}/index${tryExt}`;
        try {
          const content = await fs.readFile(tryPath);
          fileContent = typeof content === "string" ? content : new TextDecoder().decode(content);
          resolvedPath = tryPath;
          ext = tryExt;
          break;
        } catch {
          // Try next extension
        }
      }
    }

    if (!fileContent || !resolvedPath) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve @/${relativePath}`);
      continue;
    }

    try {
      let transformed = fileContent;

      // Transform TSX/JSX/TS files with esbuild
      if (ext === ".tsx" || ext === ".jsx" || ext === ".ts") {
        const esbuildResult = await transform(fileContent, {
          loader: ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : "ts",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });
        transformed = esbuildResult.code;

        // Add React import if JSX was used and no React import exists
        if ((ext === ".tsx" || ext === ".jsx") && !REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }
      }

      // Write transformed code to temp file
      const transformedFileName = `alias-${hashString(resolvedPath)}.mjs`;
      const transformedPath = join(esmCacheDir, transformedFileName);
      await fs.writeFile(transformedPath, transformed);

      // Replace import in code
      result = result.replace(
        original,
        `import ${importClause} from "file://${transformedPath}";`,
      );

      logger.info(`${LOG_PREFIX_MDX_LOADER} Transformed @/${relativePath} -> ${transformedPath}`);
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform @/${relativePath}`, error);
    }
  }

  return result;
}

/**
 * Transform /_vf_modules/ imports to file:// paths
 * These are browser-style module URLs that need to be resolved for server-side execution
 */
async function _transformModuleServerImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
): Promise<string> {
  const imports: Array<{
    original: string;
    modulePath: string;
  }> = [];

  // Find all /_vf_modules/ imports
  let match;
  const pattern = new RegExp(MODULE_SERVER_IMPORT_PATTERN.source, "g");
  while ((match = pattern.exec(code)) !== null) {
    const [original, modulePath] = match;
    if (modulePath) {
      imports.push({ original, modulePath });
    }
  }

  if (imports.length === 0) {
    return code;
  }

  logger.info(
    `${LOG_PREFIX_MDX_LOADER} Found ${imports.length} /_vf_modules/ imports to transform`,
  );

  const { transform } = await import("esbuild/mod.js");
  let result = code;

  for (const { original, modulePath } of imports) {
    // Remove .js extension if present
    const pathWithoutExt = modulePath.replace(/\.js$/, "");

    // Try common extensions
    const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ""];
    let fileContent: string | null = null;
    let resolvedPath: string | null = null;
    let ext: string = "";

    for (const tryExt of extensions) {
      const tryPath = pathWithoutExt + tryExt;
      try {
        const content = await fs.readFile(tryPath);
        fileContent = typeof content === "string" ? content : new TextDecoder().decode(content);
        resolvedPath = tryPath;
        ext = tryExt || tryPath.split(".").pop() || "";
        break;
      } catch {
        // Try next extension
      }
    }

    // Also try index files
    if (!fileContent) {
      for (const tryExt of [".tsx", ".ts", ".jsx", ".js", ".mdx"]) {
        const tryPath = `${pathWithoutExt}/index${tryExt}`;
        try {
          const content = await fs.readFile(tryPath);
          fileContent = typeof content === "string" ? content : new TextDecoder().decode(content);
          resolvedPath = tryPath;
          ext = tryExt;
          break;
        } catch {
          // Try next extension
        }
      }
    }

    if (!fileContent || !resolvedPath) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve /_vf_modules/${modulePath}`);
      continue;
    }

    try {
      let transformed = fileContent;

      // Transform TSX/JSX/TS files with esbuild
      if (ext === ".tsx" || ext === ".jsx" || ext === ".ts") {
        const esbuildResult = await transform(fileContent, {
          loader: ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : "ts",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });
        transformed = esbuildResult.code;

        // Add React import if JSX was used and no React import exists
        if ((ext === ".tsx" || ext === ".jsx") && !REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }
      }

      // Write transformed code to temp file
      const transformedFileName = `vfmod-${hashString(resolvedPath)}.mjs`;
      const transformedPath = join(esmCacheDir, transformedFileName);
      await fs.writeFile(transformedPath, transformed);

      // Replace import in code
      const newFrom = `from "file://${transformedPath}"`;
      result = result.replace(original, newFrom);

      logger.info(
        `${LOG_PREFIX_MDX_LOADER} Transformed /_vf_modules/${modulePath} -> ${transformedPath}`,
      );
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform /_vf_modules/${modulePath}`, error);
    }
  }

  return result;
}

export async function loadModuleESM(
  compiledProgramCode: string,
  context: ESMLoaderContext,
): Promise<MDXModule> {
  const loadStart = performance.now();
  try {
    const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
    const adapter = await getAdapter();

    if (!context.esmCacheDir) {
      // Use persistent cache directory that survives server restarts
      // This dramatically improves first-request performance after initial warm-up
      const persistentCacheDir = join(cwd(), ".cache", "veryfront-mdx-esm");
      try {
        await Deno.mkdir(persistentCacheDir, { recursive: true });
        context.esmCacheDir = persistentCacheDir;
        logger.info(`${LOG_PREFIX_MDX_LOADER} Using persistent cache dir: ${persistentCacheDir}`);
      } catch {
        // Fallback to temp dir if persistent cache fails
        if (IS_TRUE_NODE) {
          const projectCacheDir = join(cwd(), "node_modules", ".cache", "veryfront-mdx");
          await adapter.fs.mkdir(projectCacheDir, { recursive: true });
          context.esmCacheDir = projectCacheDir;
        } else {
          context.esmCacheDir = await adapter.fs.makeTempDir("veryfront-mdx-esm-");
        }
      }
    }

    // Transform @/ aliased imports to /_vf_modules/ paths FIRST
    // This must happen before transformImportsWithMap to prevent @/ from being treated as bare npm imports
    // These will then be converted to HTTP URLs by the MODULE_SERVER_IMPORT_PATTERN handling below
    let rewritten = compiledProgramCode.replace(
      /from\s+["']@\/([^"']+)["']/g,
      (_match, path) => {
        const jsPath = path.endsWith(".js") ? path : `${path}.js`;
        return `from "/_vf_modules/${jsPath}"`;
      },
    );

    // Transform imports with import map
    if (IS_TRUE_NODE) {
      // On Node.js, transform react imports to absolute file:// paths
      // This is needed because MDX modules are cached in temp directories
      // where Node.js cannot resolve bare imports
      rewritten = await transformReactImportsToAbsolute(rewritten);
    } else {
      // On Deno/browser, transform to esm.sh URLs
      rewritten = transformImportsWithMap(
        rewritten,
        getDefaultImportMap(),
        undefined,
        { resolveBare: true },
      );
    }

    // Transform /_vf_modules/ imports to file:// paths
    // We directly transform modules (bypassing HTTP) and cache as file:// modules
    // to ensure all modules share the same npm: resolution context.

    // Find all /_vf_modules/ imports and transform them
    const vfModulePattern = /from\s+["'](\/?)(_vf_modules\/[^"']+)["']/g;
    const vfModuleImports: Array<{ original: string; path: string }> = [];
    let vfMatch;
    while ((vfMatch = vfModulePattern.exec(rewritten)) !== null) {
      const [original, , path] = vfMatch;
      if (path) {
        vfModuleImports.push({ original, path });
      }
    }

    // Get projectDir from cwd
    const projectDir = cwd();
    const projectId = "default";

    // In-flight tracking to prevent duplicate parallel fetches
    const inFlight = new Map<string, Promise<string | null>>();

    // Recursive function to fetch and cache a module
    // deno-lint-ignore no-inner-declarations
    async function fetchAndCacheModule(
      modulePath: string,
      parentModulePath?: string,
    ): Promise<string | null> {
      // Normalize the module path (remove leading slash, resolve relative paths)
      let normalizedPath = modulePath.replace(/^\//, "");

      // If it's a relative import and we have a parent, resolve it relative to parent
      if (parentModulePath && (modulePath.startsWith("./") || modulePath.startsWith("../"))) {
        // Get the directory of the parent module
        const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
        // Resolve the relative path
        if (modulePath.startsWith("./")) {
          normalizedPath = `${parentDir}/${modulePath.slice(2)}`;
        } else if (modulePath.startsWith("../")) {
          // Handle ../ by going up one directory level
          const parentParts = parentDir.split("/");
          parentParts.pop();
          normalizedPath = `${parentParts.join("/")}/${modulePath.slice(3)}`;
        }
        // Ensure it has _vf_modules prefix
        if (!normalizedPath.startsWith("_vf_modules/")) {
          normalizedPath = `_vf_modules/${normalizedPath}`;
        }
      }

      // Check if this module is already being fetched (prevent race conditions)
      const existingFetch = inFlight.get(normalizedPath);
      if (existingFetch) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Waiting for in-flight fetch: ${normalizedPath}`);
        return existingFetch;
      }

      // Create a deferred promise to track this fetch
      let resolveDeferred: (value: string | null) => void;
      const fetchPromise = new Promise<string | null>((resolve) => {
        resolveDeferred = resolve;
      });

      // Register BEFORE starting fetch to prevent race conditions
      inFlight.set(normalizedPath, fetchPromise);

      // Now do the actual fetch
      const result = await (async (): Promise<string | null> => {
        // Check persistent module path cache first
        const pathCache = await getModulePathCache(context.esmCacheDir!);
        const cachedPath = pathCache.get(normalizedPath);
        if (cachedPath) {
          // Verify the file still exists
          try {
            const stat = await adapter.fs.stat(cachedPath);
            if (stat?.isFile) {
              return cachedPath;
            }
          } catch {
            // Cache entry is stale, remove it
            pathCache.delete(normalizedPath);
          }
        }

        // DIRECT TRANSFORM: Skip HTTP round-trip by calling transformToESM directly
        // This saves ~50-100ms per module
        try {
          // Extract file path from module path (remove _vf_modules/ prefix)
          const filePathWithoutJs = normalizedPath
            .replace(/^_vf_modules\//, "")
            .replace(/\.js$/, "");

          // Try to find and read the source file
          const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
          // Also try common directory prefixes
          const prefixes = ["", "src/"];
          let sourceCode: string | null = null;
          let actualFilePath: string | null = null;

          // Check if path already has a known extension (e.g., DocsLayout.mdx from DocsLayout.mdx.js)
          const hasKnownExt = extensions.some((ext) => filePathWithoutJs.endsWith(ext));

          // If path already has extension, try it directly first
          if (hasKnownExt) {
            for (const prefix of prefixes) {
              const tryPath = prefix + filePathWithoutJs;
              try {
                const content = await adapter.fs.readFile(tryPath);
                sourceCode = typeof content === "string"
                  ? content
                  : new TextDecoder().decode(content as Uint8Array);
                actualFilePath = tryPath;
                break;
              } catch {
                // Try next prefix
              }
            }
          }

          // If not found yet, try adding extensions
          if (!sourceCode) {
            // Strip any existing extension before adding new ones
            const filePathWithoutExt = hasKnownExt
              ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
              : filePathWithoutJs;

            outer: for (const prefix of prefixes) {
              for (const ext of extensions) {
                const tryPath = prefix + filePathWithoutExt + ext;
                try {
                  const content = await adapter.fs.readFile(tryPath);
                  sourceCode = typeof content === "string"
                    ? content
                    : new TextDecoder().decode(content as Uint8Array);
                  actualFilePath = tryPath;
                  break outer;
                } catch {
                  // Try next extension
                }
              }
            }
          }

          // If not found, try index files
          if (!sourceCode) {
            // Use base path without extension for index lookup
            const basePath = hasKnownExt
              ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
              : filePathWithoutJs;

            outer: for (const prefix of prefixes) {
              for (const ext of extensions) {
                const tryPath = `${prefix}${basePath}/index${ext}`;
                try {
                  const content = await adapter.fs.readFile(tryPath);
                  sourceCode = typeof content === "string"
                    ? content
                    : new TextDecoder().decode(content as Uint8Array);
                  actualFilePath = tryPath;
                  break outer;
                } catch {
                  // Try next extension
                }
              }
            }
          }

          if (!sourceCode || !actualFilePath) {
            // Fallback to HTTP fetch if direct file read fails
            // This handles cases where files are in remote storage (Veryfront API)
            logger.debug(
              `${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${filePathWithoutJs}`,
            );
            const port =
              (globalThis as { Deno?: { env: { get(key: string): string | undefined } } })
                .Deno?.env?.get("PORT") || "3001";
            const moduleUrl = `http://localhost:${port}/${normalizedPath}?ssr=true`;
            const response = await fetch(moduleUrl);
            if (!response.ok) {
              logger.warn(
                `${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrl} (${response.status})`,
              );
              return null;
            }
            let moduleCode = await response.text();
            // Add external param to esm.sh URLs to prevent React bundling
            moduleCode = addExternalToEsmShUrls(moduleCode);
            // Normalize React imports to npm:
            moduleCode = normalizeReactToNpm(moduleCode);

            // Find and recursively process any /_vf_modules/ imports
            const vfModuleImportPattern = /from\s+["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;
            const nestedImports: Array<{ original: string; path: string }> = [];
            let match;
            while ((match = vfModuleImportPattern.exec(moduleCode)) !== null) {
              if (match[1]) {
                nestedImports.push({ original: match[0], path: match[1].replace(/^\//, "") });
              }
            }

            // Also handle relative imports
            const relativeImportPattern = /from\s+["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;
            const relativeImports: Array<{ original: string; path: string }> = [];
            let relMatch;
            while ((relMatch = relativeImportPattern.exec(moduleCode)) !== null) {
              if (relMatch[1]) {
                relativeImports.push({ original: relMatch[0], path: relMatch[1] });
              }
            }

            // Process nested imports IN PARALLEL
            const nestedResults = await Promise.all(
              nestedImports.map(async ({ original, path: nestedPath }) => {
                const nestedFilePath = await fetchAndCacheModule(nestedPath, normalizedPath);
                return { original, nestedFilePath };
              }),
            );
            for (const { original, nestedFilePath } of nestedResults) {
              if (nestedFilePath) {
                moduleCode = moduleCode.replace(original, `from "file://${nestedFilePath}"`);
              }
            }

            // Process relative imports IN PARALLEL
            const relativeResults = await Promise.all(
              relativeImports.map(async ({ original, path: relativePath }) => {
                const nestedFilePath = await fetchAndCacheModule(relativePath, normalizedPath);
                return { original, nestedFilePath };
              }),
            );
            for (const { original, nestedFilePath } of relativeResults) {
              if (nestedFilePath) {
                moduleCode = moduleCode.replace(original, `from "file://${nestedFilePath}"`);
              }
            }

            // Check for any unresolved /_vf_modules/ imports - don't cache broken modules
            const unresolvedPattern = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;
            const unresolvedMatches = [...moduleCode.matchAll(unresolvedPattern)];
            if (unresolvedMatches.length > 0) {
              const unresolvedPaths = unresolvedMatches.map((m) => m[1]).slice(0, 3);
              logger.warn(
                `${LOG_PREFIX_MDX_LOADER} Module has ${unresolvedMatches.length} unresolved imports, skipping cache`,
                { path: normalizedPath, unresolved: unresolvedPaths },
              );
              // Return null so caller retries or uses different strategy
              return null;
            }

            // Use content-based cache key so unchanged files stay cached
            const contentHash = hashString(normalizedPath + moduleCode);
            const cachePath = join(context.esmCacheDir!, `vfmod-${contentHash}.mjs`);

            // Check if this exact content is already cached
            try {
              const stat = await adapter.fs.stat(cachePath);
              if (stat?.isFile) {
                pathCache.set(normalizedPath, cachePath);
                logger.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
                return cachePath;
              }
            } catch {
              // Not cached, write it
            }

            // Ensure cache directory exists before writing
            await Deno.mkdir(context.esmCacheDir!, { recursive: true });
            await adapter.fs.writeFile(cachePath, moduleCode);
            pathCache.set(normalizedPath, cachePath);
            await saveModulePathCache(context.esmCacheDir!);
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached: ${normalizedPath} -> ${cachePath}`);
            return cachePath;
          }

          // Transform the source code directly (SSR mode)
          let moduleCode = await transformToESM(
            sourceCode,
            actualFilePath,
            projectDir,
            adapter as RuntimeAdapter,
            { projectId, dev: true, ssr: true },
          );

          // Add external param to esm.sh URLs to prevent React bundling
          moduleCode = addExternalToEsmShUrls(moduleCode);
          // Normalize React imports to npm:
          moduleCode = normalizeReactToNpm(moduleCode);

          // Find and recursively process any /_vf_modules/ imports
          const vfModuleImportPattern = /from\s+["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;
          const nestedImports: Array<{ original: string; path: string }> = [];
          let match;
          while ((match = vfModuleImportPattern.exec(moduleCode)) !== null) {
            if (match[1]) {
              nestedImports.push({ original: match[0], path: match[1].replace(/^\//, "") });
            }
          }

          // Also handle relative imports with ?ssr=true query params
          // These are created by the module server and need to be resolved
          const relativeImportPattern = /from\s+["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;
          const relativeImports: Array<{ original: string; path: string }> = [];
          let relMatch;
          while ((relMatch = relativeImportPattern.exec(moduleCode)) !== null) {
            if (relMatch[1]) {
              relativeImports.push({ original: relMatch[0], path: relMatch[1] });
            }
          }

          // Process nested /_vf_modules/ imports recursively IN PARALLEL
          const nestedResults = await Promise.all(
            nestedImports.map(async ({ original, path: nestedPath }) => {
              const nestedFilePath = await fetchAndCacheModule(nestedPath, normalizedPath);
              return { original, nestedFilePath };
            }),
          );
          for (const { original, nestedFilePath } of nestedResults) {
            if (nestedFilePath) {
              moduleCode = moduleCode.replace(original, `from "file://${nestedFilePath}"`);
            }
          }

          // Process relative imports by resolving them IN PARALLEL
          const relativeResults = await Promise.all(
            relativeImports.map(async ({ original, path: relativePath }) => {
              const nestedFilePath = await fetchAndCacheModule(relativePath, normalizedPath);
              return { original, nestedFilePath };
            }),
          );
          for (const { original, nestedFilePath } of relativeResults) {
            if (nestedFilePath) {
              moduleCode = moduleCode.replace(original, `from "file://${nestedFilePath}"`);
            }
          }

          // Check for any unresolved /_vf_modules/ imports - don't cache broken modules
          const unresolvedPattern = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;
          const unresolvedMatches = [...moduleCode.matchAll(unresolvedPattern)];
          if (unresolvedMatches.length > 0) {
            const unresolvedPaths = unresolvedMatches.map((m) => m[1]).slice(0, 3);
            logger.warn(
              `${LOG_PREFIX_MDX_LOADER} Module has ${unresolvedMatches.length} unresolved imports, skipping cache`,
              { path: normalizedPath, unresolved: unresolvedPaths },
            );
            // Return null so caller retries or uses different strategy
            return null;
          }

          // Use content-based cache key so unchanged files stay cached
          const contentHash = hashString(normalizedPath + moduleCode);
          const cachePath = join(context.esmCacheDir!, `vfmod-${contentHash}.mjs`);

          // Check if this exact content is already cached
          try {
            const stat = await adapter.fs.stat(cachePath);
            if (stat?.isFile) {
              pathCache.set(normalizedPath, cachePath);
              logger.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
              return cachePath;
            }
          } catch {
            // Not cached, write it
          }

          // Ensure cache directory exists before writing
          await Deno.mkdir(context.esmCacheDir!, { recursive: true });
          await adapter.fs.writeFile(cachePath, moduleCode);
          pathCache.set(normalizedPath, cachePath);
          await saveModulePathCache(context.esmCacheDir!);
          logger.debug(
            `${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`,
          );
          return cachePath;
        } catch (error) {
          logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to process ${normalizedPath}`, error);
          return null;
        }
      })();

      // Resolve the deferred promise and clean up
      resolveDeferred!(result);
      inFlight.delete(normalizedPath);
      return result;
    }

    // Process each vf_modules import IN PARALLEL
    const fetchStart = performance.now();
    const vfModuleResults = await Promise.all(
      vfModuleImports.map(async ({ original, path }) => {
        const filePath = await fetchAndCacheModule(path);
        return { original, filePath };
      }),
    );
    const fetchEnd = performance.now();
    logger.info(`${LOG_PREFIX_MDX_LOADER} Module fetch phase completed`, {
      moduleCount: vfModuleImports.length,
      durationMs: (fetchEnd - fetchStart).toFixed(1),
    });
    for (const { original, filePath } of vfModuleResults) {
      if (filePath) {
        rewritten = rewritten.replace(original, `from "file://${filePath}"`);
      }
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

    // Add external param to esm.sh URLs to prevent React bundling
    rewritten = addExternalToEsmShUrls(rewritten);
    // Normalize React imports to use consistent npm: specifiers
    // This ensures MDX modules use the same React as third-party npm packages
    rewritten = normalizeReactToNpm(rewritten);

    const codeHash = hashString(rewritten);
    const namespace = getCacheNamespace() || "default";
    const compositeKey = `${namespace}:${codeHash}`;

    const cached = context.moduleCache.get(compositeKey);
    if (cached) return cached as MDXModule;

    // Check for unresolved /_vf_modules/ imports - these will fail at runtime
    const unresolvedPattern = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;
    const unresolvedMatches = [...rewritten.matchAll(unresolvedPattern)];
    if (unresolvedMatches.length > 0) {
      const unresolvedPaths = unresolvedMatches.map((m) => m[1]).slice(0, 5);
      const errorMsg = `MDX has ${unresolvedMatches.length} unresolved module imports: ${
        unresolvedPaths.join(", ")
      }`;
      logger.error(`${LOG_PREFIX_MDX_RENDERER} ${errorMsg}`);
      throw new Error(errorMsg);
    }

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
