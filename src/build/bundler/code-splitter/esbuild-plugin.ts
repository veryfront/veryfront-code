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
import { dirname, extname, isAbsolute, relative } from "#veryfront/compat/path/index.ts";
import { readTextFile, realPath } from "#veryfront/compat/fs.ts";
import { stripServerOnlyExports } from "#veryfront/transforms/pipeline/stages/browser-server-exports-strip.ts";

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

async function canonicalPath(path: string, description: string): Promise<string> {
  try {
    return await realPath(path);
  } catch (error) {
    throw new TypeError(`Unable to resolve ${description}: ${path}`, { cause: error });
  }
}

async function loadStrippedProjectModule(
  args: OnLoadArgs,
  canonicalProjectDir: string,
  allowedFiles: ReadonlySet<string>,
): Promise<OnLoadResult | null> {
  const loader = loaderForPath(args.path);
  if (!loader) return null;
  if (isNodeModulesPath(args.path)) return null;

  const canonicalModulePath = await canonicalPath(args.path, "code-splitter module");
  if (allowedFiles.has(canonicalModulePath)) return null;

  const relativePath = relative(canonicalProjectDir, canonicalModulePath);
  const isProjectModule = relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  if (!isProjectModule) {
    throw new TypeError(`Code-splitter module is outside the project directory: ${args.path}`);
  }

  const contents = await readTextFile(args.path);
  return {
    contents: await stripServerOnlyExports(contents, args.path),
    loader,
    resolveDir: dirname(args.path),
  };
}

export function createSplitterPlugin(projectDir: string, injectedFiles: string[] = []): Plugin {
  let canonicalProjectDir: Promise<string> | undefined;
  const getCanonicalProjectDir = (): Promise<string> =>
    canonicalProjectDir ??= canonicalPath(projectDir, "code-splitter project directory");
  let canonicalInjectedFiles: Promise<ReadonlySet<string>> | undefined;
  const getCanonicalInjectedFiles = (): Promise<ReadonlySet<string>> =>
    canonicalInjectedFiles ??= Promise.all(
      injectedFiles.map((path) => canonicalPath(path, "code-splitter injected file")),
    ).then((paths) => new Set(paths));

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

      build.onLoad(
        { filter: /\.[jt]sx?$/ },
        async (args: OnLoadArgs) =>
          loadStrippedProjectModule(
            args,
            await getCanonicalProjectDir(),
            await getCanonicalInjectedFiles(),
          ),
      );

      build.onDispose((): void => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
