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
import { createFileSystem, realPath } from "#veryfront/platform/compat/fs.ts";
import { stripServerOnlyExports } from "#veryfront/transforms/pipeline/stages/browser-server-exports-strip.ts";
import { MAX_CODE_SPLITTER_MODULE_BYTES } from "./constants.ts";

const JAVASCRIPT_LOADERS = new Map<string, string>([
  [".js", "js"],
  [".jsx", "jsx"],
  [".ts", "ts"],
  [".tsx", "tsx"],
]);
const fs = createFileSystem();

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

async function readProjectModule(path: string): Promise<string> {
  const before = fs.lstat ? await fs.lstat(path) : await fs.stat(path);
  if (
    before.isSymlink ||
    !before.isFile ||
    before.isDirectory ||
    !Number.isSafeInteger(before.size) ||
    before.size < 0
  ) {
    throw new TypeError(`Code-splitter module must be a safe regular file: ${path}`);
  }
  if (before.size > MAX_CODE_SPLITTER_MODULE_BYTES) {
    throw new TypeError(
      `Code-splitter module exceeds ${MAX_CODE_SPLITTER_MODULE_BYTES} bytes: ${path}`,
    );
  }

  const bytes = await fs.readFile(path);
  const [canonicalAfter, after] = await Promise.all([
    canonicalPath(path, "code-splitter module after read"),
    fs.lstat ? fs.lstat(path) : fs.stat(path),
  ]);
  if (
    canonicalAfter !== path ||
    after.isSymlink ||
    !after.isFile ||
    after.isDirectory ||
    after.size !== before.size ||
    bytes.byteLength !== before.size ||
    bytes.byteLength > MAX_CODE_SPLITTER_MODULE_BYTES ||
    after.mtime?.getTime() !== before.mtime?.getTime()
  ) {
    throw new TypeError(`Code-splitter module changed while it was being read: ${path}`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(`Code-splitter module must contain valid UTF-8: ${path}`, {
      cause: error,
    });
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

  const contents = await readProjectModule(canonicalModulePath);
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
