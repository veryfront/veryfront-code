/**
 * Parse stage - MDX → JSX compilation.
 *
 * Only runs for .mdx files. Compiles MDX to JSX using the MDX compiler.
 */

import { compileMDXRuntime } from "../../mdx/compiler/mdx-compiler.ts";
import { isMDX, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Parse plugin - compiles MDX to JSX.
 */
export const parsePlugin: TransformPlugin = {
  name: "parse-mdx",
  stage: TransformStage.PARSE,

  condition: isMDX,

  async transform(ctx: TransformContext): Promise<string> {
    // SSR needs "server" target to use file:// paths
    // Browser needs module server URLs
    const mdxTarget = isSSR(ctx) ? "server" : "browser";
    const mdxBaseUrl = isSSR(ctx) ? undefined : ctx.moduleServerUrl;

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

    // Store frontmatter in metadata for later stages
    if (result.frontmatter) {
      ctx.metadata.set("frontmatter", result.frontmatter);
    }

    return result.compiledCode;
  },
};

export default parsePlugin;
