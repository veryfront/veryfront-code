/****
 * Bundle optimization service
 */

import { bundlerLogger as logger } from "#veryfront/utils";
import * as esbuild from "veryfront/extensions/bundler";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";
import { COMPILATION_ERROR, ensureError } from "#veryfront/errors";

export function optimizeBundle(
  result: BundleResult,
  options: BundlerOptions,
): Promise<void> | undefined {
  if (options.mode !== "production") return;

  return withSpan(
    "build.renderer.optimizeBundle",
    async (): Promise<void> => {
      try {
        const staged = new Map<string, {
          code: string;
          warnings: string[];
        }>();

        for (const [path, output] of result.outputs) {
          if (output.type !== "js") continue;

          const transformed = await esbuild.transform(output.content, {
            minify: true,
            target: "es2020",
            loader: "js",
          });

          staged.set(path, {
            code: transformed.code,
            warnings: transformed.warnings,
          });
        }

        for (const path of staged.keys()) {
          if (!result.outputs.has(path)) {
            throw new TypeError(`Bundle output disappeared during optimization: ${path}`);
          }
        }
        for (const [path, transformed] of staged) {
          const output = result.outputs.get(path)!;
          output.content = transformed.code;
          result.warnings.push(...transformed.warnings);
        }

        logger.info("Bundle optimized", {
          files: staged.size,
          mode: options.mode,
        });
      } catch (error) {
        const failure = ensureError(error);
        logger.error("Bundle optimization failed", { error: failure });
        result.errors.push(
          COMPILATION_ERROR.create({
            detail: `Bundle optimization failed: ${failure.message}`,
            cause: failure,
          }),
        );
      }
    },
    {
      "options.mode": options.mode,
      "outputs.count": result.outputs.size,
    },
  );
}
