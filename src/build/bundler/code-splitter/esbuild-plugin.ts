/**
 * ESBuild plugin for code splitting with React and MDX support
 * @module code-splitter/esbuild-plugin
 */

import { bundlerLogger as logger } from "@veryfront/utils";
import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "esbuild/mod.js";
import { join } from "std/path/mod.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils";

/**
 * Creates an ESBuild plugin for veryfront code splitting
 *
 * @param projectDir - Project root directory for resolving paths
 * @returns ESBuild plugin configuration
 */
export function createSplitterPlugin(projectDir: string): Plugin {
  return {
    name: "veryfront-splitter",
    setup: (build: PluginBuild) => {
      // Handle React imports as external
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args: OnResolveArgs) => {
        const reactMap = getReactImportMap(REACT_DEFAULT_VERSION);
        if (reactMap[args.path]) {
          return { path: args.path, external: true };
        }
        return undefined;
      });

      // Handle MDX file resolution
      build.onResolve({ filter: /\.mdx$/ }, (args: OnResolveArgs) => {
        return {
          path: join(projectDir, args.path),
          namespace: "mdx",
        };
      });

      // Handle MDX file loading with stub content
      build.onLoad({ filter: /.*/, namespace: "mdx" }, (_args: OnLoadArgs) => {
        return {
          contents: `export default function MDXComponent() { return "MDX Component"; }`,
          loader: "jsx",
        };
      });

      // Clean up resources on dispose
      build.onDispose(() => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
