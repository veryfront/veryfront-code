import { compileMDXRuntime } from "../../mdx/compiler/mdx-compiler.ts";
import { isMDX, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

export const parsePlugin: TransformPlugin = {
  name: "parse-mdx",
  stage: TransformStage.PARSE,
  condition: isMDX,

  async transform(ctx: TransformContext): Promise<string> {
    const ssr = isSSR(ctx);
    const mdxTarget = ssr ? "server" : "browser";
    const mdxBaseUrl = ssr ? undefined : ctx.moduleServerUrl;

    const result = await compileMDXRuntime(
      ctx.dev ? "development" : "production",
      ctx.projectDir,
      ctx.code,
      undefined,
      ctx.filePath,
      mdxTarget,
      mdxBaseUrl,
      { studioEmbed: ctx.studioEmbed },
    );

    if (result.frontmatter) ctx.metadata.set("frontmatter", result.frontmatter);

    return result.compiledCode;
  },
};

export default parsePlugin;
