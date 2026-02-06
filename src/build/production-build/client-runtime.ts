/**************************
 * Client Runtime Generation for Build
 * Handles generation of client-side router and prefetch scripts
 **************************/

import {
  dirname,
  extname,
  fromFileUrl,
  isAbsolute,
  join,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { serverLogger as logger } from "#veryfront/utils";
import type { OnResolveArgs, Plugin } from "esbuild";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

// Try to import pre-bundled client scripts (available in npm builds)
let CLIENT_ROUTER_BUNDLE: string | undefined;
let CLIENT_PREFETCH_BUNDLE: string | undefined;

try {
  const templates = await import("./templates.ts");
  CLIENT_ROUTER_BUNDLE = (templates as { CLIENT_ROUTER_BUNDLE?: string }).CLIENT_ROUTER_BUNDLE;
  CLIENT_PREFETCH_BUNDLE =
    (templates as { CLIENT_PREFETCH_BUNDLE?: string }).CLIENT_PREFETCH_BUNDLE;
} catch {
  // Pre-bundled scripts not available (Deno development mode)
}

interface FileStatResult {
  isFile: boolean;
}

async function statFile(path: string): Promise<FileStatResult | null> {
  const fs = createFileSystem();
  try {
    const stat = await fs.stat(path);
    return { isFile: stat.isFile };
  } catch {
    return null;
  }
}

async function readTextFile(path: string): Promise<string> {
  const fs = createFileSystem();
  return fs.readTextFile(path);
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
  try {
    return await loadClientScript(
      CLIENT_ROUTER_BUNDLE,
      "router",
      "../../rendering/client/router.ts",
    );
  } catch (error) {
    logger.error("Failed to generate client runtime bundle", error);
    throw error;
  }
}

function loadClientScript(
  preBundledScript: string | undefined,
  scriptName: string,
  sourceEntry: string,
): Promise<string> {
  if (preBundledScript) {
    logger.debug(`Using pre-bundled client ${scriptName} script`);
    return Promise.resolve(preBundledScript);
  }

  return bundleClientEntry(sourceEntry);
}

/**
 * Load and transform router script from source
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generateRouterScript(_adapter: RuntimeAdapter): Promise<string> {
  return loadClientScript(
    CLIENT_ROUTER_BUNDLE,
    "router",
    "../../rendering/client/router.ts",
  );
}

/**
 * Generate prefetch script
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generatePrefetchScript(_adapter: RuntimeAdapter): Promise<string> {
  return loadClientScript(
    CLIENT_PREFETCH_BUNDLE,
    "prefetch",
    "../../rendering/client/prefetch.ts",
  );
}

/**
 * Generate import map for React dependencies
 *
 * Uses centralized React version configuration from cdn.ts
 */
export async function generateImportMap(): Promise<string> {
  const { getReactImportMap, REACT_DEFAULT_VERSION } = await import(
    "#veryfront/utils/constants/cdn.ts"
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
      build.onResolve({ filter: /^#veryfront\/utils$/ }, () => ({ path: shimPath }));
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
          return resolved ? { path: resolved } : null;
        }

        if (relativeSpecifier.test(specifier)) {
          const importerDir = determineImporterDir(args);
          const lookupBase = resolve(importerDir, specifier);
          const resolved = await resolveFromCandidates(lookupBase);
          return resolved ? { path: resolved } : null;
        }

        return { external: true };
      });
    },
  };
}

function determineImporterDir(args: OnResolveArgs): string {
  if (args.resolveDir) {
    return isAbsolute(args.resolveDir) ? args.resolveDir : resolve(packageRoot, args.resolveDir);
  }

  if (args.importer?.startsWith("file://")) {
    return dirname(fromFileUrl(new URL(args.importer)));
  }

  if (args.importer && isAbsolute(args.importer)) {
    return dirname(args.importer);
  }

  return packageRoot;
}

async function resolveFromCandidates(basePath: string): Promise<string | null> {
  for (const candidate of buildCandidatePaths(basePath)) {
    const stat = await statFile(candidate);
    if (stat?.isFile) return candidate;
  }
  return null;
}

function buildCandidatePaths(basePath: string): string[] {
  const normalizedBase = stripTrailingSeparator(basePath);

  if (hasSupportedExtension(normalizedBase)) return [normalizedBase];

  const withExtensions = moduleExtensions.map((extension) => `${normalizedBase}${extension}`);
  const indexCandidates = moduleExtensions.map((extension) =>
    join(normalizedBase, `index${extension}`)
  );

  return [...withExtensions, ...indexCandidates];
}

function hasSupportedExtension(filePath: string): boolean {
  const extension = extname(filePath);
  return extension.length > 0 &&
    moduleExtensions.includes(extension as (typeof moduleExtensions)[number]);
}

function stripTrailingSeparator(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function stripSpecifier(specifier: string): string {
  const queryIndex = specifier.indexOf("?");
  const hashIndex = specifier.indexOf("#");

  if (queryIndex === -1 && hashIndex === -1) return specifier;
  if (queryIndex === -1) return specifier.slice(0, hashIndex);
  if (hashIndex === -1) return specifier.slice(0, queryIndex);

  return specifier.slice(0, Math.min(queryIndex, hashIndex));
}

const extensionToLoader: Record<string, "js" | "ts" | "tsx" | "jsx" | "json"> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".jsx": "jsx",
  ".json": "json",
};

function createFsLoaderPlugin(): Plugin {
  return {
    name: "veryfront-fs-loader",
    setup(build) {
      build.onLoad({ filter: /.*/ }, async (args) => {
        try {
          const contents = await readTextFile(args.path);
          const ext = extname(args.path).toLowerCase();
          const loader = extensionToLoader[ext] ?? "js";
          return { contents, loader };
        } catch {
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
    if (!(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
      try {
        await Promise.resolve(stop());
      } catch (error) {
        logger.warn("Failed to stop esbuild service cleanly", error);
      }
    }
  }

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw toError(
      createError({
        type: "build",
        message: `Failed to bundle client entry: ${entryRelative}`,
      }),
    );
  }

  return output;
}
