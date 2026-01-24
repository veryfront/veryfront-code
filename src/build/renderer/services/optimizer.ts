/****
 * Bundle optimization service
 */

import { bundlerLogger as logger } from "#veryfront/utils";
import * as esbuild from "esbuild";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

export function optimizeBundle(
  result: BundleResult,
  options: BundlerOptions,
): Promise<void> | undefined {
  if (options.mode !== "production") return;

  return withSpan(
    "build.renderer.optimizeBundle",
    async () => {
      try {
        for (const [, output] of result.outputs) {
          if (output.type !== "js") continue;

          const { code } = await esbuild.transform(output.content, {
            minify: true,
            target: "es2020",
            loader: "js",
          });

          output.content = code;
        }

        logger.info("Bundle optimized", {
          files: result.outputs.size,
          mode: options.mode,
        });
      } catch (error) {
        logger.error("Bundle optimization failed", { error });
      }
    },
    {
      "options.mode": options.mode,
      "outputs.count": result.outputs.size,
    },
  );
}
