import { wrapError } from "../../errors/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";
export class MDXCompiler {
    config;
    constructor(config) {
        this.config = config;
    }
    compileMDX(content, frontmatter, filePath) {
        return withSpan(SpanNames.MDX_COMPILE, async () => {
            const cachedBundle = await withSpan(SpanNames.MDX_CACHE_GET, () => this.config.mdxCacheAdapter.getCachedBundle(content, frontmatter, filePath), { "mdx.file_path": filePath ?? "inline", "mdx.content_length": content.length });
            if (cachedBundle)
                return cachedBundle;
            return this.compileAndCache(content, frontmatter, filePath);
        }, {
            "mdx.file_path": filePath ?? "inline",
            "mdx.content_length": content.length,
            "mdx.mode": this.config.mode,
        });
    }
    async compileAndCache(content, frontmatter, filePath) {
        const { compileContent } = await import("../../transforms/mdx/compiler/index.js");
        try {
            const bundle = (await compileContent(this.config.mode, this.config.projectDir, content, frontmatter, filePath, "server"));
            await withSpan(SpanNames.MDX_CACHE_SET, () => this.config.mdxCacheAdapter.setCachedBundle(content, bundle, filePath), { "mdx.file_path": filePath ?? "inline" });
            return bundle;
        }
        catch (error) {
            throw wrapError(error, "MDX compilation failed", { filePath });
        }
    }
}
