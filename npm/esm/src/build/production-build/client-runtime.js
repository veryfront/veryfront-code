/**************************
 * Client Runtime Generation for Build
 * Handles generation of client-side router and prefetch scripts
 **************************/
import * as dntShim from "../../../_dnt.shims.js";
import { dirname, extname, fromFileUrl, isAbsolute, join, resolve, } from "../../platform/compat/path/index.js";
import { serverLogger as logger } from "../../utils/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { createFileSystem } from "../../platform/compat/fs.js";
// Try to import pre-bundled client scripts (available in npm builds)
let CLIENT_ROUTER_BUNDLE;
let CLIENT_PREFETCH_BUNDLE;
try {
    const templates = await import("./templates.js");
    CLIENT_ROUTER_BUNDLE = templates.CLIENT_ROUTER_BUNDLE;
    CLIENT_PREFETCH_BUNDLE =
        templates.CLIENT_PREFETCH_BUNDLE;
}
catch {
    // Pre-bundled scripts not available (Deno development mode)
}
async function statFile(path) {
    const fs = createFileSystem();
    try {
        const stat = await fs.stat(path);
        return { isFile: stat.isFile };
    }
    catch (error) {
        throw error;
    }
}
async function readTextFile(path) {
    const fs = createFileSystem();
    return await fs.readTextFile(path);
}
const moduleDir = dirname(fromFileUrl(globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url));
const packageRoot = join(moduleDir, "..", "..", "..");
const vfSrcPrefix = "@vf-src/";
const moduleExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"];
const externalSpecifier = /^(std\/|@std\/|node:|deno:|https?:)/;
const relativeSpecifier = /^\.{1,2}(?:\/|$)/;
/**
 * Generate app.js module
 */
export function generateAppModule() {
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
export async function generateClientModule() {
    if (CLIENT_ROUTER_BUNDLE) {
        logger.debug("Using pre-bundled client router script");
        return CLIENT_ROUTER_BUNDLE;
    }
    try {
        return await bundleClientEntry("../../rendering/client/router.ts");
    }
    catch (error) {
        logger.error("Failed to generate client runtime bundle", error);
        throw error;
    }
}
/**
 * Load and transform router script from source
 * Uses pre-bundled version for npm builds, or bundles from source for Deno
 */
export async function generateRouterScript(_adapter) {
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
export async function generatePrefetchScript(_adapter) {
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
export async function generateImportMap() {
    const { getReactImportMap, REACT_DEFAULT_VERSION } = await import("../../utils/constants/cdn.js");
    const imports = getReactImportMap(REACT_DEFAULT_VERSION);
    return `
  <!-- Import map for React dependencies -->
  <script type="importmap">
  ${JSON.stringify({ imports }, null, 2)}
  </script>
  `;
}
function createClientShimPlugin(shimPath) {
    return {
        name: "veryfront-client-shims",
        setup(build) {
            build.onResolve({ filter: /^@veryfront\/internal$/ }, () => ({ path: shimPath }));
        },
    };
}
function createPathResolverPlugin() {
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
function determineImporterDir(args) {
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
async function resolveFromCandidates(basePath) {
    for (const candidate of buildCandidatePaths(basePath)) {
        const stat = await statFile(candidate);
        if (stat?.isFile) {
            return candidate;
        }
    }
    return null;
}
function buildCandidatePaths(basePath) {
    const normalizedBase = stripTrailingSeparator(basePath);
    if (hasSupportedExtension(normalizedBase)) {
        return [normalizedBase];
    }
    const withExtensions = moduleExtensions.map((extension) => `${normalizedBase}${extension}`);
    const indexCandidates = moduleExtensions.map((extension) => join(normalizedBase, `index${extension}`));
    return [...withExtensions, ...indexCandidates];
}
function hasSupportedExtension(filePath) {
    const extension = extname(filePath);
    return extension.length > 0 &&
        moduleExtensions.includes(extension);
}
function stripTrailingSeparator(path) {
    return path.replace(/[\\/]+$/, "");
}
function stripSpecifier(specifier) {
    const queryIndex = specifier.indexOf("?");
    const hashIndex = specifier.indexOf("#");
    if (queryIndex === -1 && hashIndex === -1) {
        return specifier;
    }
    if (queryIndex === -1) {
        return specifier.slice(0, hashIndex);
    }
    if (hashIndex === -1) {
        return specifier.slice(0, queryIndex);
    }
    return specifier.slice(0, Math.min(queryIndex, hashIndex));
}
const extensionToLoader = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".json": "json",
};
function createFsLoaderPlugin() {
    return {
        name: "veryfront-fs-loader",
        setup(build) {
            build.onLoad({ filter: /.*/ }, async (args) => {
                try {
                    const contents = await readTextFile(args.path);
                    const ext = extname(args.path).toLowerCase();
                    const loader = extensionToLoader[ext] ?? "js";
                    return { contents, loader };
                }
                catch {
                    return null;
                }
            });
        },
    };
}
async function bundleClientEntry(entryRelative) {
    const { build, stop } = await import("esbuild");
    const entryUrl = new URL(entryRelative, globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url);
    const shimUrl = new URL("../../rendering/client/browser-stubs/logger.ts", globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url);
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
    }
    finally {
        if (!dntShim.dntGlobalThis.__vfTestPreserveEsbuild) {
            try {
                await Promise.resolve(stop());
            }
            catch (error) {
                logger.warn("Failed to stop esbuild service cleanly", error);
            }
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
