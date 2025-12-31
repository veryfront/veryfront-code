import { wrapError } from "@veryfront/errors/index.ts";
import type { MdxBundle } from "@veryfront/types";
import type { MDXCacheAdapter } from "@veryfront/transforms/mdx/index.ts";
import { injectNodePositions } from "../../build/transforms/plugins/babel-node-positions.ts";

export interface MDXCompilerConfig {
  projectDir: string;
  mode: "development" | "production";
  mdxCacheAdapter: MDXCacheAdapter;
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
    const cachedBundle = await this.config.mdxCacheAdapter.getCachedBundle(
      content,
      frontmatter,
      filePath,
    );

    if (cachedBundle) {
      return cachedBundle;
    }

    return await this.compileAndCache(content, frontmatter, filePath);
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
      // Inject source position data attributes for Studio Navigator
      // This adds data-node-line, data-node-column, etc. to JSX elements
      const contentWithPositions = filePath
        ? injectNodePositions(content, { filePath })
        : content;

      const bundle = await compileMDXRuntime(
        this.config.mode,
        this.config.projectDir,
        contentWithPositions,
        frontmatter,
        filePath,
      );

      await this.config.mdxCacheAdapter.setCachedBundle(content, bundle as MdxBundle, filePath);

      return bundle as MdxBundle & {
        headings?: Array<{ id: string; text: string; level: number }>;
        nodeMap?: Map<number, unknown>;
      };
    } catch (error) {
      throw wrapError(error, "MDX compilation failed", { filePath });
    }
  }
}
