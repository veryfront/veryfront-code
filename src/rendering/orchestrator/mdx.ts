import { wrapWithContext } from "#veryfront/errors";
import type { MdxBundle } from "#veryfront/types";
import {
  createMDXCacheKey,
  type MDXCacheAdapter,
  type MDXCacheIdentity,
} from "#veryfront/transforms/mdx/index.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";

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

// Module-level so dedup spans compiler instances: the renderer creates an
// MDXCompiler per render context, and the versioned bundle cache key
// is already global, so the flight map can be too.
const compileFlight = new Singleflight<MDXCompileResult>();

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
        const cacheIdentity = this.getCacheIdentity(frontmatter);
        const cachedBundle = await withSpan(
          SpanNames.MDX_CACHE_GET,
          () =>
            this.config.mdxCacheAdapter.getCachedBundle(
              content,
              frontmatter,
              filePath,
              cacheIdentity,
            ),
          spanAttrs,
        );

        if (cachedBundle) return cachedBundle;

        const contentHash = await this.config.mdxCacheAdapter.computeHash(content);
        const flightKey = await createMDXCacheKey({
          mode: this.config.mode,
          contentHash,
          filePath,
          ...cacheIdentity,
        });

        // Unsupported frontmatter cannot be represented safely in a durable
        // key, so it must not share compilation or cache state.
        if (!flightKey) return this.compileAndCache(content, frontmatter, filePath);

        return compileFlight.do(
          flightKey,
          () => this.compileAndCache(content, frontmatter, filePath),
        );
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
        undefined,
        this.config.studioEmbed,
      )) as MDXCompileResult;

      await withSpan(
        SpanNames.MDX_CACHE_SET,
        () =>
          this.config.mdxCacheAdapter.setCachedBundle(
            content,
            bundle,
            filePath,
            this.getCacheIdentity(frontmatter),
          ),
        { "mdx.file_path": filePath ?? "inline" },
      );

      return bundle;
    } catch (error) {
      throw wrapWithContext(error, "MDX compilation failed", { filePath });
    }
  }

  private getCacheIdentity(frontmatter?: Record<string, unknown>): MDXCacheIdentity {
    return {
      projectDir: this.config.projectDir,
      studioEmbed: this.config.studioEmbed,
      frontmatter,
    };
  }
}
