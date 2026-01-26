import { compileContent } from "../../mdx/compiler/index.js";
import { isMDX, isSSR } from "../context.js";
import { TransformStage } from "../types.js";
export const parsePlugin = {
    name: "parse-mdx",
    stage: TransformStage.PARSE,
    condition: isMDX,
    async transform(ctx) {
        const ssr = isSSR(ctx);
        const mdxTarget = ssr ? "server" : "browser";
        const mdxBaseUrl = ssr ? undefined : ctx.moduleServerUrl;
        const result = await compileContent(ctx.dev ? "development" : "production", ctx.projectDir, ctx.code, undefined, ctx.filePath, mdxTarget, mdxBaseUrl);
        if (result.frontmatter)
            ctx.metadata.set("frontmatter", result.frontmatter);
        return result.compiledCode;
    },
};
export default parsePlugin;
