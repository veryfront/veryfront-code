import { wrapError } from "../../errors/index.js";
import type { MdxBundle } from "../../types/index.js";
import type { MDXCacheAdapter } from "../../transforms/mdx/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";

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
  private config: MDXCompilerConfig;

  constructor(config: MDXCompilerConfig) {
    this.config = config;
  }

  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MDXCompileResult> {
    return withSpan(
      SpanNames.MDX_COMPILE,
      async () => {
        const cachedBundle = await withSpan(
          SpanNames.MDX_CACHE_GET,
          () => this.config.mdxCacheAdapter.getCachedBundle(content, frontmatter, filePath),
          { "mdx.file_path": filePath ?? "inline", "mdx.content_length": content.length },
        );

        if (cachedBundle) return cachedBundle;

        return this.compileAndCache(content, frontmatter, filePath);
      },
      {
        "mdx.file_path": filePath ?? "inline",
        "mdx.content_length": content.length,
        "mdx.mode": this.config.mode,
      },
    );
  }

  private async compileAndCache(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MDXCompileResult> {
    const { compileContent } = await import("../../transforms/mdx/compiler/index.js");

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
      throw wrapError(error, "MDX compilation failed", { filePath });
    }
  }
}
