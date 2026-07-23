import {
  bundlerLogger as logger,
  getReactImportMap,
  REACT_DEFAULT_VERSION,
} from "#veryfront/utils";
import type { OnResolveArgs, Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { dirname, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

const fs = createFileSystem();

function resolveProjectPath(projectDir: string, importPath: string, resolveDir?: string): string {
  const projectRoot = resolve(projectDir);
  const sourcePath = isAbsolute(importPath)
    ? resolve(importPath)
    : resolve(resolveDir || projectRoot, importPath);
  const projectRelativePath = relative(projectRoot, sourcePath);

  if (
    projectRelativePath === "" ||
    projectRelativePath.split(/[\\/]/)[0] === ".." ||
    isAbsolute(projectRelativePath)
  ) {
    throw new TypeError(`MDX source path is outside projectDir: ${importPath}`);
  }

  return sourcePath;
}

async function validateProjectSourceFile(projectDir: string, sourcePath: string): Promise<void> {
  const projectRoot = resolve(projectDir);
  const info = fs.lstat ? await fs.lstat(sourcePath) : await fs.stat(sourcePath);
  if (!info.isFile || info.isSymlink) {
    throw new TypeError("MDX sources must be regular project files");
  }
  if (!fs.realPath) return;

  const [canonicalProjectRoot, canonicalSourcePath] = await Promise.all([
    fs.realPath(projectRoot),
    fs.realPath(sourcePath),
  ]);
  const canonicalRelativePath = relative(canonicalProjectRoot, canonicalSourcePath);
  if (
    canonicalRelativePath === "" || canonicalRelativePath.split(/[\\/]/)[0] === ".." ||
    isAbsolute(canonicalRelativePath)
  ) {
    throw new TypeError("MDX source resolves outside the project directory");
  }
}

export function createSplitterPlugin(
  projectDir: string,
  mode: "development" | "production" = "production",
): Plugin {
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

      build.onResolve({ filter: /\.mdx?$/ }, (args: OnResolveArgs) => {
        const path = resolveProjectPath(projectDir, args.path, args.resolveDir);
        return { path, namespace: "mdx" };
      });

      build.onLoad({ filter: /.*/, namespace: "mdx" }, async (args) => {
        const sourcePath = resolveProjectPath(projectDir, args.path);
        await validateProjectSourceFile(projectDir, sourcePath);
        const content = await fs.readTextFile(sourcePath);
        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        const compile = sourcePath.toLowerCase().endsWith(".mdx")
          ? processor.compileMdx.bind(processor)
          : processor.compileMarkdown.bind(processor);
        const compiled = await compile({
          projectDir: resolve(projectDir),
          content,
          filePath: sourcePath,
          mode,
          target: "browser",
          outputFormat: "program",
        });

        return {
          contents: compiled.compiledCode,
          loader: "js",
          resolveDir: dirname(sourcePath),
        };
      });

      build.onDispose((): void => {
        logger.debug("CodeSplitter build disposed, cleaning up resources");
      });
    },
  };
}
