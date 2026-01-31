import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";
import { getLoaderFromPath } from "../../esm/transform-utils.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

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

      const isMdx = ctx.filePath.endsWith(".mdx");
      if (
        isMdx &&
        /\bconst\s+MDXLayout\b/.test(code) &&
        !/export\s+\{[^}]*MDXLayout/.test(code)
      ) {
        code += "\nexport { MDXLayout };\n";
      }

      return code;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isMdx = ctx.filePath.endsWith(".mdx");

      const sourcePreview = ctx.code
        .split("\n")
        .slice(0, 10)
        .map((line, i) => `${String(i + 1).padStart(3, " ")}| ${line}`)
        .join("\n");

      logger.error("[ESM-TRANSFORM] Transform failed", {
        filePath: ctx.filePath,
        loader,
        sourceLength: ctx.code.length,
        isMdx,
        error: errorMsg,
      });
      logger.error("[ESM-TRANSFORM] Source preview (first 10 lines):\n" + sourcePreview);

      getErrorCollector().addCompileError(errorMsg, ctx.filePath);

      throw new Error(`ESM transform failed for ${ctx.filePath} (loader: ${loader}): ${errorMsg}`);
    }
  },
};

export default compilePlugin;
