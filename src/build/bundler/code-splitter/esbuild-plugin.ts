import {
  bundlerLogger as logger,
  getReactImportMap,
  REACT_DEFAULT_VERSION,
} from "#veryfront/utils";
import type { OnResolveArgs, Plugin, PluginBuild } from "esbuild";
import { join } from "#veryfront/compat/path/index.ts";

export function createSplitterPlugin(projectDir: string): Plugin {
  return {
    name: "veryfront-splitter",
    setup(build: PluginBuild): void {
      build.onResolve(
        { filter: /^react(-dom)?(\/.*)?$/ },
        (args: OnResolveArgs) => {
          const reactMap = getReactImportMap(REACT_DEFAULT_VERSION);
          if (!reactMap[args.path]) return null;

          return { path: args.path, external: true };
        },
      );

      build.onResolve({ filter: /\.mdx$/ }, (args: OnResolveArgs) => ({
        path: join(projectDir, args.path),
        namespace: "mdx",
      }));

      build.onLoad({ filter: /.*/, namespace: "mdx" }, () => ({
        contents: `export default function MDXComponent() { return "MDX Component"; }`,
        loader: "jsx",
      }));

      build.onDispose((): void => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
