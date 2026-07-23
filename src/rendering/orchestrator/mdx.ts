import { wrapWithContext } from "#veryfront/errors";
import type { MdxBundle } from "#veryfront/types";
import {
  cloneMDXCompilationResult,
  type MDXCacheAdapter,
} from "#veryfront/transforms/mdx/index.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { tryResolve as tryResolveContract } from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";

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

// Module-level so dedup spans compiler instances. Keys come from the cache
// adapter's complete compilation identity, which includes tenant scope and
// every caller-controlled input that can change emitted code.
const compileFlight = new Singleflight<MDXCompileResult>();

function frameFlightPart(value: string): string {
  return `${value.length}:${value}`;
}

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
          () =>
            this.config.mdxCacheAdapter.getCachedBundle(
              content,
              frontmatter,
              filePath,
              this.config.studioEmbed,
            ),
          spanAttrs,
        );

        if (cachedBundle) return cloneMDXCompilationResult(cachedBundle);

        let compilationIdentity: string;
        try {
          compilationIdentity = await this.config.mdxCacheAdapter.computeCompilationIdentity(
            content,
            frontmatter,
            filePath,
            this.config.studioEmbed,
          );
        } catch {
          // Unsupported/cyclic frontmatter must not make compilation fail.
          // It is intentionally compiled without cache or cross-call sharing.
          return this.compileAndCache(content, frontmatter, filePath);
        }

        const flightKey = `mdx:${frameFlightPart(this.config.projectDir)}${
          frameFlightPart(compilationIdentity)
        }`;

        const processor = tryResolveContract<ContentProcessor>("ContentProcessor");
        if (processor?.resultIsolation !== "structured-clone") {
          return this.compileAndCache(content, frontmatter, filePath);
        }

        const sharedResult = await compileFlight.do(
          flightKey,
          () => this.compileAndCache(content, frontmatter, filePath),
        );
        try {
          return cloneMDXCompilationResult(sharedResult);
        } catch {
          // A provider that violates its declared isolation capability must not
          // leak a shared mutable result. Recompile independently for this
          // caller and let cache persistence fail closed for unsupported data.
          return this.compileAndCache(content, frontmatter, filePath);
        }
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
            frontmatter,
            this.config.studioEmbed,
          ),
        { "mdx.file_path": filePath ?? "inline" },
      );

      return bundle;
    } catch (error) {
      throw wrapWithContext(error, "MDX compilation failed", { filePath });
    }
  }
}
