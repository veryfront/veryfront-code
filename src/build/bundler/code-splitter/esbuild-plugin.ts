
import { bundlerLogger as logger } from "@veryfront/utils";
import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "esbuild/mod.js";
import { join } from "std/path/mod.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils";

export function createSplitterPlugin(projectDir: string): Plugin {
  return {
    name: "veryfront-splitter",
    setup: (build: PluginBuild) => {
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args: OnResolveArgs) => {
        const reactMap = getReactImportMap(REACT_DEFAULT_VERSION);
        if (reactMap[args.path]) {
          return { path: args.path, external: true };
        }
        return undefined;
      });

      build.onResolve({ filter: /\.mdx$/ }, (args: OnResolveArgs) => {
        return {
          path: join(projectDir, args.path),
          namespace: "mdx",
        };
      });

      build.onLoad({ filter: /.*/, namespace: "mdx" }, (_args: OnLoadArgs) => {
        return {
          contents: `export default function MDXComponent() { return "MDX Component"; }`,
          loader: "tsx",
        };
      });

      build.onDispose(() => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
