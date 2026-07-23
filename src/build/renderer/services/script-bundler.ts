/**
 * JavaScript/TypeScript bundling service
 */

import { bundlerLogger as logger } from "#veryfront/utils";
import type * as esbuild from "veryfront/extensions/bundler";
import type { Plugin } from "veryfront/extensions/bundler";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";
import { extractImports } from "../utils/import-utils.ts";
import { getEsbuildLoader } from "../../utils/file-types.ts";
import { COMPILATION_ERROR, createError, ensureError, toError } from "#veryfront/errors";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { dirname, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";

function assertPathWithinProject(path: string, projectDir: string): string {
  const resolvedProjectDir = resolve(projectDir);
  const resolvedPath = resolve(path);
  const relativePath = relative(resolvedProjectDir, resolvedPath).replaceAll("\\", "/");
  if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new TypeError("Script source and imports must stay inside projectDir");
  }
  return resolvedPath;
}

interface CachedValueSnapshot {
  key: string;
  hadValue: boolean;
  value?: string;
}

function stageSourceInCache(
  fileCache: Map<string, string>,
  keys: string[],
  content: string,
): CachedValueSnapshot[] {
  const snapshots: CachedValueSnapshot[] = [];
  for (const key of [...new Set(keys)]) {
    snapshots.push({ key, hadValue: fileCache.has(key), value: fileCache.get(key) });
    fileCache.set(key, content);
  }
  return snapshots;
}

function restoreCache(fileCache: Map<string, string>, snapshots: CachedValueSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.hadValue) fileCache.set(snapshot.key, snapshot.value as string);
    else fileCache.delete(snapshot.key);
  }
}

/**
 * Bundle JavaScript/TypeScript files
 */
export function bundleScript(
  source: { path: string; content: string; type: string },
  options: BundlerOptions,
  result: BundleResult,
  esbuildInstance: typeof esbuild,
  fileCache: Map<string, string>,
): Promise<void> {
  return withSpan(
    "build.renderer.bundleScript",
    async () => {
      const isProduction = options.mode === "production";
      let cacheSnapshots: CachedValueSnapshot[] = [];
      const pendingOutputs = new Map<
        string,
        BundleResult["outputs"] extends Map<string, infer T> ? T
          : never
      >();

      try {
        if (!options.projectDir?.trim()) throw new TypeError("projectDir must not be blank");
        if (typeof source.content !== "string") {
          throw new TypeError("Script content must be a string");
        }
        const sourcePath = isAbsolute(source.path)
          ? source.path
          : resolve(options.projectDir, source.path);
        assertPathWithinProject(sourcePath, options.projectDir);
        const loader = getEsbuildLoader(source.path);
        if (loader === "text") throw new TypeError("Unsupported script source extension");
        cacheSnapshots = stageSourceInCache(
          fileCache,
          [source.path, sourcePath],
          source.content,
        );

        const buildResult = await esbuildInstance.build({
          stdin: {
            contents: source.content,
            sourcefile: source.path,
            resolveDir: dirname(sourcePath),
            loader: loader as esbuild.Loader,
          },
          bundle: true,
          format: options.platform === "node" ? "cjs" : "esm",
          platform: options.platform ?? "browser",
          target: isProduction ? ["es2020"] : ["esnext"],
          minify: isProduction,
          sourcemap: isProduction ? false : "inline",
          treeShaking: isProduction,
          external: options.external ?? [],
          write: false,
          plugins: [
            createResolvePlugin(fileCache, options.projectDir),
            createDynamicImportPlugin(),
            createCSSPlugin(pendingOutputs, options.projectDir),
          ],
          define: {
            "process.env.NODE_ENV": JSON.stringify(options.mode),
          },
          logLevel: "silent",
        });

        const output = buildResult.outputFiles?.[0];
        if (!output?.text) {
          throw toError(
            createError({
              type: "build",
              message: "The script bundler did not produce JavaScript output",
            }),
          );
        }

        const outputPath = source.path.replace(/\.(?:[cm]?[jt]sx?)$/i, ".js");
        const dependencyModule = await esbuildInstance.transform(source.content, {
          loader: loader as esbuild.Loader,
          format: "esm",
          target: "esnext",
          jsx: "automatic",
          jsxImportSource: "react",
          minify: false,
          sourcemap: false,
        });
        const dependencies = await extractImports(dependencyModule.code);
        pendingOutputs.set(outputPath, {
          path: outputPath,
          content: output.text,
          type: "js",
        });
        for (const [path, outputValue] of pendingOutputs) {
          result.outputs.set(path, outputValue);
        }
        result.dependencies.set(source.path, dependencies);

        logger.debug("Bundled script source");

        for (const warning of buildResult.warnings) {
          result.warnings.push(formatEsbuildMessage(warning));
        }
      } catch (error) {
        restoreCache(fileCache, cacheSnapshots);
        logger.error("Failed to bundle script source");

        if (error instanceof Error && "errors" in error) {
          for (const err of (error as esbuild.BuildFailure).errors) {
            result.errors.push(COMPILATION_ERROR.create({ detail: formatEsbuildMessage(err) }));
          }
          return;
        }

        result.errors.push(ensureError(error));
      }
    },
    {
      "source.type": source.type,
      "options.mode": options.mode,
      "options.platform": options.platform ?? "browser",
    },
  );
}

function createResolvePlugin(fileCache: Map<string, string>, projectDir: string): esbuild.Plugin {
  return {
    name: "veryfront-resolve",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const baseDir = args.resolveDir || (args.importer ? dirname(args.importer) : projectDir);
        const isLocal = args.path.startsWith(".") || isAbsolute(args.path);
        if (!isLocal) return undefined;
        const candidate = assertPathWithinProject(resolve(baseDir, args.path), projectDir);
        const cachedPath = findCachedModulePath(fileCache, candidate);
        if (!cachedPath) return undefined;
        return { path: cachedPath, namespace: "veryfront-cache" };
      });

      build.onLoad({ filter: /.*/, namespace: "veryfront-cache" }, (args) => {
        const content = fileCache.get(args.path);
        if (content == null) return undefined;

        return {
          contents: content,
          loader: getEsbuildLoader(args.path) as esbuild.Loader,
          resolveDir: dirname(args.path),
        };
      });
    },
  };
}

const CACHE_RESOLVE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

function findCachedModulePath(fileCache: Map<string, string>, path: string): string | undefined {
  for (const extension of CACHE_RESOLVE_EXTENSIONS) {
    const candidate = `${path}${extension}`;
    if (fileCache.has(candidate)) return candidate;
  }
  return undefined;
}

function createCSSPlugin(
  outputs: BundleResult["outputs"],
  projectDir: string,
): esbuild.Plugin {
  const fs = createFileSystem();

  return {
    name: "veryfront-css",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        try {
          const cssPath = assertPathWithinProject(args.path, projectDir);
          const info = fs.lstat ? await fs.lstat(cssPath) : await fs.stat(cssPath);
          if (!info.isFile || info.isSymlink) {
            throw new TypeError("CSS imports must resolve to regular project files");
          }
          const content = await fs.readTextFile(cssPath);

          outputs.set(cssPath, {
            path: cssPath,
            content,
            type: "css",
          });

          return {
            contents: `export default ${JSON.stringify(content)}`,
            loader: "js",
          };
        } catch {
          return {
            errors: [
              {
                text: "Failed to load a local CSS import",
                location: null,
              },
            ],
          };
        }
      });
    },
  };
}

function createDynamicImportPlugin(): Plugin {
  return {
    name: "veryfront-dynamic-import",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind !== "dynamic-import") return undefined;

        const isBare = !args.path.startsWith(".") &&
          !args.path.startsWith("/") &&
          !args.path.startsWith("http://") &&
          !args.path.startsWith("https://");

        if (!isBare) return undefined;

        return { path: args.path, external: true };
      });
    },
  };
}

function formatEsbuildMessage(msg: esbuild.Message): string {
  if (!msg.location) return msg.text;
  return `${msg.location.line}:${msg.location.column}: ${msg.text}`;
}
