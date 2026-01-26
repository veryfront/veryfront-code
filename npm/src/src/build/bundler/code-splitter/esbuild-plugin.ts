import {
  bundlerLogger as logger,
  getReactImportMap,
  REACT_DEFAULT_VERSION,
} from "../../../utils/index.js";
import type { OnResolveArgs, Plugin, PluginBuild } from "esbuild";
import { join } from "../../../platform/compat/path/index.js";

export function createSplitterPlugin(projectDir: string): Plugin {
  return {
    name: "veryfront-splitter",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args: OnResolveArgs) => {
        const reactMap = getReactImportMap(REACT_DEFAULT_VERSION);
        if (!reactMap[args.path]) return;

        return { path: args.path, external: true };
      });

      build.onResolve({ filter: /\.mdx$/ }, (args: OnResolveArgs) => ({
        path: join(projectDir, args.path),
        namespace: "mdx",
      }));

      build.onLoad({ filter: /.*/, namespace: "mdx" }, () => ({
        contents: `export default function MDXComponent() { return "MDX Component"; }`,
        loader: "jsx",
      }));

      build.onDispose(() => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
