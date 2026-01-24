/**
 * JavaScript/TypeScript bundling service
 */

import { bundlerLogger as logger } from "#veryfront/utils";
import type * as esbuild from "esbuild";
import type { Plugin } from "esbuild";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";
import { extractImports } from "../utils/import-utils.ts";
import { getEsbuildLoader } from "../../utils/file-types.ts";
import { createError, ensureError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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

      try {
        fileCache.set(source.path, source.content);

        const buildResult = await esbuildInstance.build({
          stdin: {
            contents: source.content,
            sourcefile: source.path,
            resolveDir: options.projectDir,
            loader: getEsbuildLoader(source.path) as esbuild.Loader,
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
            createCSSPlugin(result),
          ],
          define: {
            "process.env.NODE_ENV": JSON.stringify(options.mode),
          },
          logLevel: "silent",
        });

        const output = buildResult.outputFiles?.[0];
        if (output) {
          const outputPath = source.path.replace(/\.(tsx?|jsx?)$/, ".js");

          if (!output.text) {
            throw toError(
              createError({
                type: "build",
                message: `Build output missing for ${source.path}`,
              }),
            );
          }

          result.outputs.set(outputPath, {
            path: outputPath,
            content: output.text,
            type: "js",
          });

          result.dependencies.set(source.path, extractImports(source.content));

          logger.debug(`Bundled script: ${source.path} -> ${outputPath}`);
        }

        for (const warning of buildResult.warnings) {
          result.warnings.push(formatEsbuildMessage(warning));
        }
      } catch (error) {
        logger.error(`Failed to bundle script ${source.path}`, error);

        if (error instanceof Error && "errors" in error) {
          for (const err of (error as esbuild.BuildFailure).errors) {
            result.errors.push(new Error(formatEsbuildMessage(err)));
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

function createResolvePlugin(fileCache: Map<string, string>, projectDir: string): esbuild.Plugin {
  return {
    name: "veryfront-resolve",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!fileCache.has(args.path)) return undefined;
        return { path: args.path, namespace: "veryfront-cache" };
      });

      build.onLoad({ filter: /.*/, namespace: "veryfront-cache" }, (args) => {
        const content = fileCache.get(args.path);
        if (!content) return undefined;

        return {
          contents: content,
          loader: getEsbuildLoader(args.path) as esbuild.Loader,
          resolveDir: projectDir,
        };
      });
    },
  };
}

function createCSSPlugin(result: BundleResult): esbuild.Plugin {
  const fs = createFileSystem();

  return {
    name: "veryfront-css",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        try {
          const content = await fs.readTextFile(args.path);

          result.outputs.set(args.path, {
            path: args.path,
            content,
            type: "css",
          });

          return {
            contents: `export default ${JSON.stringify(content)}`,
            loader: "js",
          };
        } catch (error) {
          return {
            errors: [
              {
                text: `Failed to load CSS: ${error}`,
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
  return `${msg.location.file}:${msg.location.line}:${msg.location.column}: ${msg.text}`;
}
