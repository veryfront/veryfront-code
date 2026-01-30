/**
 * Compile stage - esbuild JSX → JS transformation.
 *
 * Uses esbuild to transform JSX/TSX to plain JavaScript with ES modules.
 */

import { getEsbuild } from "../../../platform/compat/esbuild.js";
import { rendererLogger as logger } from "../../../utils/index.js";
import { getErrorCollector } from "../../../cli/mcp/error-collector.js";
import { getLoaderFromPath } from "../../esm/transform-utils.js";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.js";

/**
 * Compile plugin - transforms JSX/TSX to JS using esbuild.
 */
export const compilePlugin: TransformPlugin = {
  name: "esbuild-compile",
  stage: TransformStage.COMPILE,

  async transform(ctx: TransformContext): Promise<string> {
    const loader = getLoaderFromPath(ctx.filePath);
    const esbuild = await getEsbuild();

    try {
      const result = await esbuild.transform(ctx.code, {
        loader,
        format: "esm",
        target: "es2020",
        jsx: "automatic",
        jsxImportSource: ctx.jsxImportSource,
        minify: !ctx.dev,
        sourcemap: ctx.dev ? "inline" : false,
        treeShaking: !ctx.dev, // Disable in dev mode to preserve import errors
        keepNames: true,
      });

      let code = result.code;

      if (
        ctx.filePath.endsWith(".mdx") &&
        /\bconst\s+MDXLayout\b/.test(code) &&
        !/export\s+\{[^}]*MDXLayout/.test(code)
      ) {
        code += "\nexport { MDXLayout };\n";
      }

      return code;
    } catch (transformError) {
      const sourcePreview = ctx.code
        .split("\n")
        .slice(0, 10)
        .map((line, i) => `${String(i + 1).padStart(3, " ")}| ${line}`)
        .join("\n");

      const errorMsg = transformError instanceof Error
        ? transformError.message
        : String(transformError);

      logger.error("[ESM-TRANSFORM] Transform failed", {
        filePath: ctx.filePath,
        loader,
        sourceLength: ctx.code.length,
        isMdx: ctx.filePath.endsWith(".mdx"),
        error: errorMsg,
      });
      logger.error("[ESM-TRANSFORM] Source preview (first 10 lines):\n" + sourcePreview);

      // Capture compile error for MCP flywheel
      getErrorCollector().addCompileError(errorMsg, ctx.filePath);

      throw new Error(`ESM transform failed for ${ctx.filePath} (loader: ${loader}): ${errorMsg}`);
    }
  },
};

export default compilePlugin;
