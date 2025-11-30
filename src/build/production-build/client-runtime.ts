/**
 * Client Runtime Generation for Build
 * Handles generation of client-side router and prefetch scripts
 */

import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fromFileUrl } from "@std/path";
import { serverLogger as logger } from "@veryfront/utils";
import type { OnResolveArgs, Plugin } from "esbuild";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

// Try to import pre-bundled client scripts (available in npm builds)
let CLIENT_ROUTER_BUNDLE: string | undefined;
let CLIENT_PREFETCH_BUNDLE: string | undefined;
try {
  const templates = await import("./templates.ts");
  CLIENT_ROUTER_BUNDLE = (templates as { CLIENT_ROUTER_BUNDLE?: string }).CLIENT_ROUTER_BUNDLE;
  CLIENT_PREFETCH_BUNDLE = (templates as { CLIENT_PREFETCH_BUNDLE?: string }).CLIENT_PREFETCH_BUNDLE;
} catch {
  // Pre-bundled scripts not available (Deno development mode)
}

const IS_DENO = typeof Deno !== "undefined" && "stat" in Deno;

interface FileStatResult {
  isFile: boolean;
}

async function statFile(path: string): Promise<FileStatResult | null> {
  if (IS_DENO) {
    try {
      const stat = await Deno.stat(path);
      return { isFile: stat.isFile };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.PermissionDenied) {
        return null;
      }
      throw error;
    }
  }
  const fs = await import("node:fs/promises");
  try {
    const stat = await fs.stat(path);
    return { isFile: stat.isFile() };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readTextFile(path: string): Promise<string> {
  if (IS_DENO) {
    return await Deno.readTextFile(path);
  }
  const fs = await import("node:fs/promises");
  return await fs.readFile(path, "utf8");
}

const moduleDir = dirname(fromFileUrl(import.meta.url));
const packageRoot = join(moduleDir, "..", "..", "..");
const vfSrcPrefix = "@vf-src/";
const moduleExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"] as const;
const externalSpecifier = /^(std\/|@std\/|node:|deno:|https?:)/;
const relativeSpecifier = /^\.{1,2}(?:\/|$)/;

/**
 * Generate app.js module
 */
export function generateAppModule(): string {
  return `
// Veryfront App Module
(() => {
  console.log('[Veryfront] App module loaded');

  // Export for ES modules
  if (typeof window !== 'undefined') {
    window.__veryfront = window.__veryfront || {};
    window.__veryfront.version = '2.0.0';
    window.__veryfront.initialized = true;
  }

  // Basic hydration support
  window.hydrate = async function(slug, options = {}) {
    console.log('[Veryfront] Hydrating page:', slug, options);

    // Mark as hydrated
    const root = document.getElementById('root');
    if (root) {
      root.setAttribute('data-hydrated', 'true');
    }
  };
})();

export const version = '2.0.0';
export const hydrate = window.hydrate;
`;
}

/**
 * Generate client.js module for hydration
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generateClientModule(): Promise<string> {
  // Use pre-bundled version if available (npm builds)
  if (CLIENT_ROUTER_BUNDLE) {
    logger.debug("Using pre-bundled client router script");
    return CLIENT_ROUTER_BUNDLE;
  }

  // Fall back to bundling from source (Deno development)
  try {
    return await bundleClientEntry("../../rendering/client/router.ts");
  } catch (error) {
    logger.error("Failed to generate client runtime bundle", error);
    throw error;
  }
}

/**
 * Load and transform router script from source
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generateRouterScript(_adapter: RuntimeAdapter): Promise<string> {
  // Use pre-bundled version if available (npm builds)
  if (CLIENT_ROUTER_BUNDLE) {
    logger.debug("Using pre-bundled client router script");
    return CLIENT_ROUTER_BUNDLE;
  }

  return await bundleClientEntry("../../rendering/client/router.ts");
}

/**
 * Generate prefetch script
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generatePrefetchScript(_adapter: RuntimeAdapter): Promise<string> {
  // Use pre-bundled version if available (npm builds)
  if (CLIENT_PREFETCH_BUNDLE) {
    logger.debug("Using pre-bundled client prefetch script");
    return CLIENT_PREFETCH_BUNDLE;
  }

  return await bundleClientEntry("../../rendering/client/prefetch.ts");
}

/**
 * Generate import map for React dependencies
 *
 * Uses centralized React version configuration from cdn.ts
 */
export async function generateImportMap(): Promise<string> {
  const { getReactImportMap, REACT_DEFAULT_VERSION } = await import(
    "@veryfront/utils/constants/cdn.ts"
  );
  const imports = getReactImportMap(REACT_DEFAULT_VERSION);

  return `
  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${JSON.stringify({ imports }, null, 2)}
  </script>
  `;
}

function createClientShimPlugin(shimPath: string): Plugin {
  return {
    name: "veryfront-client-shims",
    setup(build) {
      build.onResolve({ filter: /^@veryfront\/internal$/ }, () => ({ path: shimPath }));
    },
  };
}

function createPathResolverPlugin(): Plugin {
  return {
    name: "veryfront-path-resolver",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const specifier = stripSpecifier(args.path);

        if (externalSpecifier.test(specifier)) {
          return { path: args.path, external: true };
        }

        if (specifier.startsWith(vfSrcPrefix)) {
          const lookupBase = resolve(packageRoot, specifier.slice(vfSrcPrefix.length));
          const resolved = await resolveFromCandidates(lookupBase);
          if (resolved) {
            return { path: resolved };
          }
          return null;
        }

        if (relativeSpecifier.test(specifier)) {
          const importerDir = determineImporterDir(args);
          const lookupBase = resolve(importerDir, specifier);
          const resolved = await resolveFromCandidates(lookupBase);
          if (resolved) {
            return { path: resolved };
          }
          return null;
        }

        return { external: true };
      });
    },
  };
}

function determineImporterDir(args: OnResolveArgs): string {
  if (args.resolveDir) {
    if (isAbsolute(args.resolveDir)) {
      return args.resolveDir;
    }
    return resolve(packageRoot, args.resolveDir);
  }

  if (args.importer) {
    if (args.importer.startsWith("file://")) {
      return dirname(fromFileUrl(new URL(args.importer)));
    }
    if (isAbsolute(args.importer)) {
      return dirname(args.importer);
    }
  }

  return packageRoot;
}

async function resolveFromCandidates(basePath: string): Promise<string | null> {
  const candidates = buildCandidatePaths(basePath);

  for (const candidate of candidates) {
    const stat = await statFile(candidate);
    if (stat && stat.isFile) {
      return candidate;
    }
  }

  return null;
}

function buildCandidatePaths(basePath: string): string[] {
  const normalizedBase = stripTrailingSeparator(basePath);

  // If already has a supported extension, only try that exact file
  if (hasSupportedExtension(normalizedBase)) {
    return [normalizedBase];
  }

  // Try adding each extension to the base path (e.g., ./foo -> ./foo.ts, ./foo.tsx, ...)
  const withExtensions = moduleExtensions.map((extension) => `${normalizedBase}${extension}`);

  // Try index files in the directory (e.g., ./foo -> ./foo/index.ts, ./foo/index.tsx, ...)
  const indexCandidates = moduleExtensions.map((extension) =>
    join(normalizedBase, `index${extension}`)
  );

  // Prioritize direct file matches over index files
  return [...withExtensions, ...indexCandidates];
}

function hasSupportedExtension(filePath: string): boolean {
  const extension = extname(filePath);
  return extension.length > 0 &&
    moduleExtensions.includes(extension as typeof moduleExtensions[number]);
}

function stripTrailingSeparator(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function stripSpecifier(specifier: string): string {
  const queryIndex = specifier.indexOf("?");
  const hashIndex = specifier.indexOf("#");
  const cutIndex = queryIndex === -1
    ? hashIndex
    : hashIndex === -1
    ? queryIndex
    : Math.min(queryIndex, hashIndex);

  return cutIndex === -1 ? specifier : specifier.slice(0, cutIndex);
}

function createFsLoaderPlugin(): Plugin {
  return {
    name: "veryfront-fs-loader",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        try {
          const contents = await readTextFile(args.path);
          const ext = extname(args.path).toLowerCase();
          let loader: "js" | "ts" | "tsx" | "jsx" | "json" = "js";
          if (ext === ".ts") loader = "ts";
          if (ext === ".tsx") loader = "tsx";
          if (ext === ".jsx") loader = "jsx";
          if (ext === ".json") loader = "json";

          return {
            contents,
            loader,
          };
        } catch (_error) {
          return null;
        }
      });
    },
  };
}

async function bundleClientEntry(entryRelative: string): Promise<string> {
  const { build, stop } = await import("esbuild");
  const entryUrl = new URL(entryRelative, import.meta.url);
  const shimUrl = new URL("../../rendering/client/browser-stubs/logger.ts", import.meta.url);

  const entryPath = fromFileUrl(entryUrl);
  const entryDir = dirname(entryPath);
  const shimPath = fromFileUrl(shimUrl);
  const source = await readTextFile(entryPath);
  const loader = entryPath.endsWith(".tsx") ? "tsx" : "ts";

  let result;
  try {
    result = await build({
      absWorkingDir: packageRoot,
      stdin: {
        contents: source,
        loader,
        resolveDir: entryDir,
        sourcefile: entryPath,
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      write: false,
      sourcemap: false,
      packages: "external",
      mainFields: ["module", "browser", "main"],
      resolveExtensions: [...moduleExtensions],
      loader: {
        ".ts": "ts",
        ".tsx": "tsx",
        ".js": "js",
      },
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      plugins: [
        createPathResolverPlugin(),
        createClientShimPlugin(shimPath),
        createFsLoaderPlugin(),
      ],
    });
  } finally {
    try {
      await Promise.resolve(stop());
    } catch (error) {
      logger.warn("Failed to stop esbuild service cleanly", error);
    }
  }

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw toError(createError({
      type: "build",
      message: `Failed to bundle client entry: ${entryRelative}`,
    }));
  }
  return output;
}
