import { wrapError } from "@veryfront/errors/index.ts";
import type { MdxBundle } from "@veryfront/types";
import type { MDXCacheAdapter } from "@veryfront/transforms/mdx/index.ts";
import { withSpan } from "@veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "@veryfront/observability/tracing/span-names.ts";

export interface MDXCompilerConfig {
  projectDir: string;
  mode: "development" | "production";
  mdxCacheAdapter: MDXCacheAdapter;
  /** Enable node position injection for Studio Navigator */
  studioEmbed?: boolean;
}

export class MDXCompiler {
  private config: MDXCompilerConfig;

  constructor(config: MDXCompilerConfig) {
    this.config = config;
  }

  async compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<
    MdxBundle & {
      headings?: Array<{ id: string; text: string; level: number }>;
      nodeMap?: Map<number, unknown>;
    }
  > {
    return withSpan(
      SpanNames.MDX_COMPILE,
      async () => {
        const cachedBundle = await withSpan(
          SpanNames.MDX_CACHE_GET,
          () => this.config.mdxCacheAdapter.getCachedBundle(content, frontmatter, filePath),
          { "mdx.file_path": filePath || "inline", "mdx.content_length": content.length },
        );

        if (cachedBundle) {
          return cachedBundle;
        }

        return this.compileAndCache(content, frontmatter, filePath);
      },
      {
        "mdx.file_path": filePath || "inline",
        "mdx.content_length": content.length,
        "mdx.mode": this.config.mode,
      },
    );
  }

  private async compileAndCache(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<
    MdxBundle & {
      headings?: Array<{ id: string; text: string; level: number }>;
      nodeMap?: Map<number, unknown>;
    }
  > {
    const { compileMDXRuntime } = await import("@veryfront/transforms/mdx/compiler/index.ts");

    try {
      // Node positions for Studio Navigator are injected via rehype plugin
      // inside compileMDXRuntime when studioEmbed is true
      const bundle = await compileMDXRuntime(
        this.config.mode,
        this.config.projectDir,
        content,
        frontmatter,
        filePath,
        "server", // SSR target
        undefined, // baseUrl
        { studioEmbed: this.config.studioEmbed },
      );

      await withSpan(
        SpanNames.MDX_CACHE_SET,
        () => this.config.mdxCacheAdapter.setCachedBundle(content, bundle as MdxBundle, filePath),
        { "mdx.file_path": filePath || "inline" },
      );

      return bundle as MdxBundle & {
        headings?: Array<{ id: string; text: string; level: number }>;
        nodeMap?: Map<number, unknown>;
      };
    } catch (error) {
      throw wrapError(error, "MDX compilation failed", { filePath });
    }
  }
}
