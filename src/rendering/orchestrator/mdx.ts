import { wrapWithContext } from "#veryfront/errors/index.ts";
import type { MdxBundle } from "#veryfront/types";
import type { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

export interface MDXCompilerConfig {
  projectDir: string;
  mode: "development" | "production";
  mdxCacheAdapter: MDXCacheAdapter;
  /** Enable node position injection for Studio Navigator */
  studioEmbed?: boolean;
}

type MDXCompileResult = MdxBundle & {
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
};

export class MDXCompiler {
  constructor(private config: MDXCompilerConfig) {}

  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MDXCompileResult> {
    const spanAttrs = {
      "mdx.file_path": filePath ?? "inline",
      "mdx.content_length": content.length,
    };

    return withSpan(
      SpanNames.MDX_COMPILE,
      async () => {
        const cachedBundle = await withSpan(
          SpanNames.MDX_CACHE_GET,
          () => this.config.mdxCacheAdapter.getCachedBundle(content, frontmatter, filePath),
          spanAttrs,
        );

        if (cachedBundle) return cachedBundle;

        return this.compileAndCache(content, frontmatter, filePath);
      },
      { ...spanAttrs, "mdx.mode": this.config.mode },
    );
  }

  private async compileAndCache(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MDXCompileResult> {
    const { compileContent } = await import("#veryfront/transforms/mdx/compiler/index.ts");

    try {
      const bundle = (await compileContent(
        this.config.mode,
        this.config.projectDir,
        content,
        frontmatter,
        filePath,
        "server",
      )) as MDXCompileResult;

      await withSpan(
        SpanNames.MDX_CACHE_SET,
        () => this.config.mdxCacheAdapter.setCachedBundle(content, bundle, filePath),
        { "mdx.file_path": filePath ?? "inline" },
      );

      return bundle;
    } catch (error) {
      throw wrapWithContext(error, "MDX compilation failed", { filePath });
    }
  }
}
