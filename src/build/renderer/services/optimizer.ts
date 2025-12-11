
import { bundlerLogger as logger } from "@veryfront/utils";
import * as esbuild from "esbuild";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

export async function optimizeBundle(result: BundleResult, options: BundlerOptions): Promise<void> {
  if (options.mode !== "production") {
    return;
  }

  try {
    for (const [_path, output] of result.outputs) {
      if (output.type !== "js") continue;

      const optimized = await esbuild.transform(output.content, {
        minify: true,
        target: "es2020",
        loader: "js",
      });

      output.content = optimized.code;
    }

    logger.info("Bundle optimized", {
      files: result.outputs.size,
      mode: options.mode,
    });
  } catch (error) {
    logger.error("Bundle optimization failed", { error });
  }
}
