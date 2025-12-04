/**
 * ESBuild Plugins
 *
 * Custom esbuild plugins for development file bundling.
 * Handles relative imports and bare module externalization.
 *
 * @module server/handlers/dev/files/esbuild-plugins
 */

import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "esbuild";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import { getDirectory, joinPath } from "@veryfront/utils/path-utils.ts";
import {
  getReactCDNUrl,
  getReactDOMCDNUrl,
  getReactDOMClientCDNUrl,
  getReactJSXDevRuntimeCDNUrl,
  getReactJSXRuntimeCDNUrl,
  REACT_DEFAULT_VERSION,
} from "@veryfront/utils/constants/cdn.ts";

/**
 * Create relative file system plugin
 *
 * Resolves relative imports (./foo, ../bar, /absolute) using the adapter's
 * file system. Tries multiple extensions and index files.
 *
 * Resolution order:
 * 1. Exact path
 * 2. Path + .tsx, .ts, .jsx, .js, .mjs
 * 3. Path/index.tsx, Path/index.ts, etc.
 *
 * @param projectDir - Project root directory
 * @param adapter - Runtime adapter with fs access
 * @returns ESBuild plugin
 *
 * @example
 * ```typescript
 * const plugin = createRelativeFsPlugin('/project', adapter);
 * // Resolves './components/Button' to '/project/components/Button.tsx'
 * ```
 */
export function createRelativeFsPlugin(projectDir: string, adapter: RuntimeAdapter): Plugin {
  return {
    name: "veryfront-rel-fs",
    setup(build: PluginBuild) {
      const exts = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

      build.onResolve({ filter: /^(\.?\.?\/|\/)\/*/ }, async (args: OnResolveArgs) => {
        const basedir = args.importer ? getDirectory(args.importer) : projectDir;
        const candidate = args.path.startsWith("/")
          ? joinPath(projectDir, args.path)
          : joinPath(basedir, args.path);

        const candidates: string[] = [candidate];
        for (const ext of exts) {
          candidates.push(candidate + ext);
        }
        for (const ext of exts) {
          candidates.push(joinPath(candidate, `index${ext}`));
        }

        for (const f of candidates) {
          try {
            const st = await adapter.fs.stat(f);
            if (st.isFile) return { path: f };
          } catch {
            /* next */
          }
        }
        return undefined;
      });

      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, async (args: OnLoadArgs) => {
        try {
          const contents = await adapter.fs.readFile(args.path);
          const loader = args.path.endsWith(".tsx")
            ? "tsx"
            : args.path.endsWith(".ts")
            ? "ts"
            : args.path.endsWith(".jsx")
            ? "jsx"
            : "js";
          return { contents, loader };
        } catch (error) {
          return {
            errors: [
              {
                text: `Failed to read ${args.path}: ${String(error)}`,
                location: null,
              },
            ],
          };
        }
      });
    },
  };
}

/**
 * Map of common packages to their esm.sh versions for browser imports.
 * Uses centralized React version constants from cdn.ts.
 */
const ESM_PACKAGE_MAP: Record<string, string> = {
  "react": getReactCDNUrl(REACT_DEFAULT_VERSION),
  "react-dom": getReactDOMCDNUrl(REACT_DEFAULT_VERSION),
  "react-dom/client": getReactDOMClientCDNUrl(REACT_DEFAULT_VERSION),
  "react/jsx-runtime": getReactJSXRuntimeCDNUrl(REACT_DEFAULT_VERSION),
  "react/jsx-dev-runtime": getReactJSXDevRuntimeCDNUrl(REACT_DEFAULT_VERSION),
};

/**
 * Create bare module external plugin
 *
 * Rewrites bare module imports (npm packages) to esm.sh URLs for browser compatibility.
 * For packages not in the map, marks them as external.
 *
 * Bare modules:
 * - 'react' -> esm.sh React URL (via centralized constants)
 * - 'lodash' -> external (marked for import map)
 * - './relative' ✗ (not handled)
 * - '/absolute' ✗ (not handled)
 * - 'https://...' ✗ (not handled)
 *
 * @param bundle - If true, fetches esm.sh content at build time (for Node.js SSR).
 *                 If false, marks as external for runtime loading (for browser).
 * @returns ESBuild plugin
 *
 * @example
 * ```typescript
 * const plugin = createBareExternalPlugin();
 * // import React from 'react' -> import React from 'https://esm.sh/react@19.1.1'
 * // import './Button' -> bundled normally
 * ```
 */
export function createBareExternalPlugin(bundle = false): Plugin {
  return {
    name: "veryfront-bare-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        const isBare = !args.path.startsWith(".") &&
          !args.path.startsWith("/") &&
          !args.path.startsWith("http://") &&
          !args.path.startsWith("https://");
        if (!isBare) return undefined;
        if (args.kind === "import-statement" || args.kind === "dynamic-import") {
          // Check if we have a known mapping for this package
          const esmUrl = ESM_PACKAGE_MAP[args.path];
          if (esmUrl) {
            if (bundle) {
              // Fetch and bundle at build time - use namespace to trigger onLoad
              return { path: esmUrl, namespace: "https" };
            }
            // Rewrite to esm.sh URL for browser runtime loading
            return { path: esmUrl, external: true };
          }
          // For unknown packages, try esm.sh with the package name
          const fallbackUrl = `https://esm.sh/${args.path}`;
          if (bundle) {
            return { path: fallbackUrl, namespace: "https" };
          }
          return { path: fallbackUrl, external: true };
        }
        return undefined;
      });

      // When bundle=true, fetch https:// URLs at build time
      if (bundle) {
        build.onLoad({ filter: /.*/, namespace: "https" }, async (args: OnLoadArgs) => {
          try {
            const response = await fetch(args.path);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const contents = await response.text();
            return { contents, loader: "js" };
          } catch (error) {
            return {
              errors: [{
                text: `Failed to fetch ${args.path}: ${String(error)}`,
                location: null,
              }],
            };
          }
        });
      }
    },
  };
}
