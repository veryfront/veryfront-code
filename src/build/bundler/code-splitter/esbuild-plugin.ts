import {
  bundlerLogger as logger,
  getReactImportMap,
  REACT_DEFAULT_VERSION,
} from "#veryfront/utils";
import type {
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  Plugin,
  PluginBuild,
} from "veryfront/extensions/bundler";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { readTextFile, realPath } from "#veryfront/compat/fs.ts";
import { stripServerOnlyExports } from "../../../transforms/pipeline/stages/browser-server-exports-strip.ts";

const JAVASCRIPT_LOADERS = new Map<string, string>([
  [".js", "js"],
  [".jsx", "jsx"],
  [".ts", "ts"],
  [".tsx", "tsx"],
]);

function loaderForPath(path: string): string | null {
  return JAVASCRIPT_LOADERS.get(extname(path)) ?? null;
}

function isNodeModulesPath(path: string): boolean {
  return /(^|[/\\])node_modules([/\\]|$)/.test(path);
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realPath(path);
  } catch {
    return resolve(path);
  }
}

async function isInsideProject(path: string, projectDir: string): Promise<boolean> {
  const relativePath = relative(await canonicalPath(projectDir), await canonicalPath(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function loadStrippedProjectModule(
  args: OnLoadArgs,
  projectDir: string,
): Promise<OnLoadResult | null> {
  const loader = loaderForPath(args.path);
  if (!loader) return null;
  if (isNodeModulesPath(args.path)) return null;
  if (!(await isInsideProject(args.path, projectDir))) return null;

  const contents = await readTextFile(args.path);
  return {
    contents: await stripServerOnlyExports(contents, args.path),
    loader,
    resolveDir: dirname(args.path),
  };
}

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

      build.onResolve({ filter: /\.mdx?$/ }, (args: OnResolveArgs) => ({
        path: join(projectDir, args.path),
        namespace: "mdx",
      }));

      build.onLoad({ filter: /.*/, namespace: "mdx" }, () => ({
        contents: `export default function MDXComponent() { return "MDX Component"; }`,
        loader: "jsx",
      }));

      build.onLoad(
        { filter: /\.[jt]sx?$/ },
        (args: OnLoadArgs) => loadStrippedProjectModule(args, projectDir),
      );

      build.onDispose((): void => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
