/****
 * Bundle optimization service
 */

import { bundlerLogger as logger } from "#veryfront/utils";
import * as esbuild from "veryfront/extensions/bundler";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";
import { ensureError } from "#veryfront/errors";

export function optimizeBundle(
  result: BundleResult,
  options: BundlerOptions,
): Promise<void> | undefined {
  if (options.mode !== "production") return;

  return withSpan(
    "build.renderer.optimizeBundle",
    async (): Promise<void> => {
      try {
        const optimized = new Map<string, string>();
        for (const [path, output] of result.outputs) {
          if (output.type !== "js") continue;

          const transformed = await esbuild.transform(output.content, {
            minify: true,
            target: "es2020",
            loader: "js",
          });

          optimized.set(path, transformed.code);
        }

        for (const [path, content] of optimized) {
          const output = result.outputs.get(path);
          if (output) output.content = content;
        }

        logger.info("Bundle optimized", {
          files: result.outputs.size,
          mode: options.mode,
        });
      } catch (error) {
        logger.error("Bundle optimization failed");
        result.errors.push(ensureError(error));
      }
    },
    {
      "options.mode": options.mode,
      "outputs.count": result.outputs.size,
    },
  );
}
