/**
 * Bundle optimization service
 */

import { bundlerLogger as logger } from "#veryfront/utils";
import * as esbuild from "esbuild"; // Native esbuild
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

/**
 * Optimize the bundle for production
 */
export function optimizeBundle(
  result: BundleResult,
  options: BundlerOptions,
): Promise<void> | undefined {
  if (options.mode !== "production") {
    return; // Only optimize in production
  }

  return withSpan("build.renderer.optimizeBundle", async () => {
    try {
      // Process each JS output file
      for (const [_path, output] of result.outputs) {
        if (output.type !== "js") continue;

        const optimized = await esbuild.transform(output.content, {
          minify: true,
          target: "es2020",
          loader: "js",
        });

        // Update the output with optimized content
        output.content = optimized.code;
      }

      logger.info("Bundle optimized", {
        files: result.outputs.size,
        mode: options.mode,
      });
    } catch (error) {
      logger.error("Bundle optimization failed", { error });
      // Don't fail the build if optimization fails
    }
  }, {
    "options.mode": options.mode,
    "outputs.count": result.outputs.size,
  });
}
