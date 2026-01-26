import { rendererLogger as logger } from "../../../utils/index.js";
import { getRehypePlugins, getRemarkPlugins } from "../../plugins/plugin-loader.js";
import { extractFrontmatter } from "./frontmatter-extractor.js";
import { rewriteBodyImports, rewriteCompiledImports } from "./import-rewriter.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
export function compileMDXRuntime(_mode, projectDir, content, frontmatter, filePath, target = "server", baseUrl) {
    return withSpan("transforms.compileMDXRuntime", async () => {
        try {
            const { compile } = await import("@mdx-js/mdx");
            const remarkPlugins = (await getRemarkPlugins());
            const rehypePlugins = (await getRehypePlugins());
            const { body: extractedBody, frontmatter: extractedFrontmatter } = extractFrontmatter(content, frontmatter);
            const bodyBeforeLength = extractedBody.length;
            const shouldRewriteImports = !!filePath && (target === "browser" || target === "server");
            const body = shouldRewriteImports
                ? rewriteBodyImports(extractedBody, { filePath, target, baseUrl, projectDir })
                : extractedBody;
            logger.debug("[MDX Compiler] Body metrics:", {
                filePath,
                target,
                contentLength: content.length,
                bodyBeforeLength,
                bodyAfterLength: body.length,
                hasImport: body.includes("import"),
                importMatch: body.match(/^import\s+/m)?.[0] ?? "none",
            });
            const compiled = await compile(body, {
                outputFormat: "program",
                development: false,
                remarkPlugins,
                rehypePlugins,
                providerImportSource: undefined,
                jsxImportSource: "react",
            });
            const headings = compiled.data?.headings ??
                [];
            logger.debug("MDX compiled output preview:", String(compiled).substring(0, 200));
            logger.debug("Extracted frontmatter:", extractedFrontmatter);
            logger.debug("Extracted headings count:", headings.length);
            const compiledCode = shouldRewriteImports
                ? rewriteCompiledImports(String(compiled), { filePath, target, baseUrl, projectDir })
                : String(compiled);
            return {
                compiledCode,
                frontmatter: extractedFrontmatter,
                globals: {},
                headings,
                nodeMap: new Map(),
            };
        }
        catch (error) {
            logger.error("[MDX Compiler] Compilation failed:", {
                filePath,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            throw toError(createError({
                type: "build",
                message: `MDX compilation error: ${error instanceof Error ? error.message : String(error)} | file: ${filePath ?? "<memory>"}`,
            }));
        }
    }, {
        "mdx.filePath": filePath ?? "memory",
        "mdx.target": target,
        "mdx.contentLength": content.length,
    });
}
