/**
 * JavaScript/TypeScript bundling service.
 */

import { dirname, isAbsolute, resolve } from "#veryfront/compat/path/index.ts";
import { COMPILATION_ERROR, createError, ensureError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { bundlerLogger as logger } from "#veryfront/utils";
import type * as esbuild from "veryfront/extensions/bundler";
import type {
  OnLoadArgs,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
} from "veryfront/extensions/bundler";
import {
  getProjectModuleCandidates,
  isContainedBuildPath,
  isNodeModulesPath,
  resolveProjectModule,
  resolveProjectSourcePath,
} from "../../bundler/project-module-resolver.ts";
import { getEsbuildLoader } from "../../utils/file-types.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";
import { extractImports } from "../utils/import-utils.ts";

const PROJECT_MODULE_NAMESPACE = "veryfront-project-module";
const SCRIPT_LOADERS = new Set<esbuild.Loader>(["js", "jsx", "ts", "tsx"]);

interface ProjectModulePluginData {
  logicalPath: string;
  readPath: string;
}

function isProjectModulePluginData(value: unknown): value is ProjectModulePluginData {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as ProjectModulePluginData).logicalPath === "string" &&
    typeof (value as ProjectModulePluginData).readPath === "string";
}

function normalizeFileCache(
  fileCache: ReadonlyMap<string, string>,
  projectDir: string,
): Map<string, { key: string; content: string }> {
  const normalized = new Map<string, { key: string; content: string }>();
  for (const [key, content] of fileCache) {
    if (typeof content !== "string") {
      throw new TypeError(`Cached module ${JSON.stringify(key)} must contain text`);
    }
    const absolutePath = resolveProjectSourcePath(key, projectDir, "Cached module");
    const previous = normalized.get(absolutePath);
    if (previous && previous.content !== content) {
      throw new TypeError(
        `Cached module paths ${JSON.stringify(previous.key)} and ${
          JSON.stringify(key)
        } resolve to the same file`,
      );
    }
    normalized.set(absolutePath, { key, content });
  }
  return normalized;
}

function createProjectModulePlugin(
  fileCache: ReadonlyMap<string, string>,
  projectDir: string,
  stagedCss: Map<string, BundleResult["outputs"] extends Map<string, infer V> ? V : never>,
): Plugin {
  const fs = createFileSystem();
  const normalizedCache = normalizeFileCache(fileCache, projectDir);

  return {
    name: "veryfront-project-modules",
    setup(build): void {
      build.onResolve({ filter: /.*/ }, async (args: OnResolveArgs) => {
        if (
          args.path.startsWith(".") &&
          isNodeModulesPath(args.resolveDir) &&
          !isContainedBuildPath(projectDir, args.resolveDir)
        ) {
          // A package resolved by the bundler may be hoisted above the project.
          // Its internal relative imports remain owned by package resolution.
          return null;
        }

        const candidates = getProjectModuleCandidates(
          args.path,
          args.resolveDir,
          projectDir,
          "Script bundle",
        );
        if (!candidates) return null;

        for (const candidate of candidates.paths) {
          const cached = normalizedCache.get(resolve(candidate));
          if (!cached) continue;
          return {
            path: resolve(candidate),
            namespace: PROJECT_MODULE_NAMESPACE,
            pluginData: {
              logicalPath: resolve(candidate),
              readPath: resolve(candidate),
            } satisfies ProjectModulePluginData,
            ...(candidates.suffix ? { suffix: candidates.suffix } : {}),
          } as OnResolveResult;
        }

        const resolvedModule = await resolveProjectModule(
          args.path,
          args.resolveDir,
          projectDir,
          fs,
          "Script bundle",
        );
        if (!resolvedModule) return null;
        return {
          path: resolvedModule.path,
          namespace: PROJECT_MODULE_NAMESPACE,
          pluginData: {
            logicalPath: resolvedModule.path,
            readPath: resolvedModule.readPath,
          } satisfies ProjectModulePluginData,
          ...(resolvedModule.suffix ? { suffix: resolvedModule.suffix } : {}),
        } as OnResolveResult;
      });

      build.onLoad(
        { filter: /.*/, namespace: PROJECT_MODULE_NAMESPACE },
        async (args: OnLoadArgs) => {
          if (!isProjectModulePluginData(args.pluginData)) {
            return {
              errors: [{ text: "Project module resolver returned invalid plugin data" }],
            };
          }

          const { logicalPath, readPath } = args.pluginData;
          const cached = normalizedCache.get(resolve(logicalPath));
          const content = cached?.content ?? await fs.readTextFile(readPath);
          const loader = getEsbuildLoader(logicalPath);

          if (loader === "tsx" && /\.mdx?$/i.test(logicalPath)) {
            return {
              errors: [{
                text:
                  "Script bundles cannot compile MDX dependencies; use the MDX bundler for this entry graph",
              }],
            };
          }

          if (loader === "css") {
            stagedCss.set(logicalPath, {
              path: logicalPath,
              content,
              type: "css",
            });
            return {
              contents: `export default ${JSON.stringify(content)}`,
              loader: "js",
              resolveDir: dirname(logicalPath),
            };
          }

          return {
            contents: content,
            loader,
            resolveDir: dirname(logicalPath),
          };
        },
      );
    },
  };
}

function createDynamicImportPlugin(): Plugin {
  return {
    name: "veryfront-dynamic-import",
    setup(build): void {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
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
  return `${msg.location.file}:${msg.location.line}:${msg.location.column}: ${msg.text}`;
}

async function extractScriptDependencies(
  esbuildInstance: typeof esbuild,
  source: string,
  loader: esbuild.Loader,
): Promise<string[]> {
  try {
    return await extractImports(source);
  } catch {
    // The module lexer intentionally parses JavaScript, not JSX/TypeScript.
    // Normalize those syntaxes with the same registered compiler that already
    // accepted the build, then parse the resulting JavaScript module.
    const normalized = await esbuildInstance.transform(source, {
      loader,
      format: "esm",
      target: ["esnext"],
    });
    return await extractImports(normalized.code);
  }
}

/**
 * Bundle one JavaScript/TypeScript source. Result maps and the caller-owned
 * source cache are committed only after the complete bundle succeeds.
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
      const hadCachedSource = fileCache.has(source.path);
      const previousCachedSource = fileCache.get(source.path);
      let cacheMutated = false;

      try {
        if (typeof source.content !== "string") {
          throw new TypeError("Script source content must be a string");
        }
        if (
          typeof options.projectDir !== "string" ||
          options.projectDir.length === 0 ||
          !isAbsolute(options.projectDir)
        ) {
          throw new TypeError("Script bundle projectDir must be an absolute path");
        }
        if (options.mode !== "development" && options.mode !== "production") {
          throw new TypeError("Script bundle mode must be development or production");
        }
        const projectDir = resolve(options.projectDir);
        const sourcePath = resolveProjectSourcePath(
          source.path,
          projectDir,
          "Script bundle",
        );
        const sourceLoader = getEsbuildLoader(sourcePath) as esbuild.Loader;
        if (!SCRIPT_LOADERS.has(sourceLoader)) {
          throw new TypeError(`Unsupported script source type: ${source.path}`);
        }
        const isProduction = options.mode === "production";

        fileCache.set(source.path, source.content);
        cacheMutated = true;
        const stagedCss = new Map<
          string,
          BundleResult["outputs"] extends Map<string, infer V> ? V : never
        >();

        const buildResult = await esbuildInstance.build({
          stdin: {
            contents: source.content,
            sourcefile: sourcePath,
            resolveDir: dirname(sourcePath),
            loader: sourceLoader,
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
            createProjectModulePlugin(fileCache, projectDir, stagedCss),
            createDynamicImportPlugin(),
          ],
          define: {
            "process.env.NODE_ENV": JSON.stringify(options.mode),
          },
          logLevel: "silent",
        });

        if (buildResult.errors.length > 0) {
          throw COMPILATION_ERROR.create({
            detail: buildResult.errors.map(formatEsbuildMessage).join("\n"),
          });
        }
        if (buildResult.outputFiles.length !== 1) {
          throw toError(
            createError({
              type: "build",
              message:
                `Expected one JavaScript output for ${source.path}, received ${buildResult.outputFiles.length}`,
            }),
          );
        }

        const output = buildResult.outputFiles[0];
        if (!output?.text) {
          throw toError(
            createError({
              type: "build",
              message: `Build output missing for ${source.path}`,
            }),
          );
        }

        const scriptExtension = /\.(?:[cm]?[jt]sx?)$/i;
        if (!scriptExtension.test(source.path)) {
          throw new TypeError(`Script source path has no supported extension: ${source.path}`);
        }
        const outputPath = source.path.replace(scriptExtension, ".js");
        const dependencies = await extractScriptDependencies(
          esbuildInstance,
          source.content,
          sourceLoader,
        );

        for (const [path, cssOutput] of stagedCss) {
          result.outputs.set(path, cssOutput);
        }
        result.outputs.set(outputPath, {
          path: outputPath,
          content: output.text,
          type: "js",
        });
        result.dependencies.set(source.path, dependencies);
        for (const warning of buildResult.warnings) {
          result.warnings.push(formatEsbuildMessage(warning));
        }

        logger.debug(`Bundled script: ${source.path} -> ${outputPath}`);
      } catch (error) {
        if (cacheMutated) {
          if (hadCachedSource && previousCachedSource !== undefined) {
            fileCache.set(source.path, previousCachedSource);
          } else {
            fileCache.delete(source.path);
          }
        }

        logger.error(`Failed to bundle script ${source.path}`, error);
        if (error instanceof Error && "errors" in error) {
          for (const buildError of (error as esbuild.BuildFailure).errors) {
            result.errors.push(
              COMPILATION_ERROR.create({
                detail: formatEsbuildMessage(buildError),
              }),
            );
          }
          return;
        }
        result.errors.push(ensureError(error));
      }
    },
    {
      "source.path": source.path,
      "source.type": source.type,
      "options.mode": options.mode,
      "options.platform": options.platform ?? "browser",
    },
  );
}
