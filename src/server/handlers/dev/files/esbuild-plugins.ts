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
 * Create bare module external plugin
 *
 * Marks bare module imports (npm packages) as external so they're
 * not bundled. This allows using CDN imports or import maps.
 *
 * Bare modules:
 * - 'react' ✓
 * - 'lodash' ✓
 * - './relative' ✗
 * - '/absolute' ✗
 * - 'https://...' ✗
 *
 * @returns ESBuild plugin
 *
 * @example
 * ```typescript
 * const plugin = createBareExternalPlugin();
 * // import React from 'react' -> marked as external
 * // import './Button' -> bundled normally
 * ```
 */
export function createBareExternalPlugin(): Plugin {
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
          return { path: args.path, external: true };
        }
        return undefined;
      });
    },
  };
}
