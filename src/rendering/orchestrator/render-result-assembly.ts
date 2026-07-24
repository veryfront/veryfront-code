import type { PageBundle, RenderResult } from "#veryfront/types";
import { toMDXFrontmatter } from "../frontmatter.ts";

interface RenderResultAssemblyCache {
  persistResult(result: RenderResult, slug: string, cacheKey?: string): Promise<void>;
}

interface RenderResultAssemblyLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
}

interface SSRResult {
  fullHtml: string;
  finalStream?: ReadableStream | null;
  ssrHash?: string;
}

export interface AssembleRenderResultOptions {
  slug: string;
  cacheKey?: string | null;
  ssrResult: SSRResult;
  pageBundle: PageBundle;
  clientModuleCode?: string;
  pageModuleType?: "mdx" | "component";
  shouldCache: boolean;
  skipCachePersist?: boolean;
  cacheCoordinator?: RenderResultAssemblyCache;
  logger?: RenderResultAssemblyLogger;
}

export function assembleRenderResult(options: AssembleRenderResultOptions): RenderResult {
  const pageModule = options.clientModuleCode && options.pageModuleType
    ? {
      slug: options.slug,
      code: options.clientModuleCode,
      type: options.pageModuleType,
    }
    : undefined;

  const result: RenderResult = {
    html: options.ssrResult.fullHtml,
    frontmatter: toMDXFrontmatter(options.pageBundle.frontmatter),
    headings: options.pageBundle.headings || [],
    nodeMap: options.pageBundle.nodeMap,
    stream: options.ssrResult.finalStream,
    ssrHash: options.ssrResult.ssrHash,
    ...(pageModule ? { pageModule } : {}),
  };

  if (options.shouldCache && !options.skipCachePersist) {
    void options.cacheCoordinator?.persistResult(
      result,
      options.slug,
      options.cacheKey ?? undefined,
    ).catch(
      (error) => {
        options.logger?.error("Cache persist failed", {
          slug: options.slug,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      },
    );
  }

  return result;
}
