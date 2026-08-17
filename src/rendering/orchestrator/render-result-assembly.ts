import type { PageBundle, RenderResult } from "#veryfront/types";
import type { ResponseCookie } from "#veryfront/data/types.ts";

interface RenderResultAssemblyCache {
  persistResult(
    result: RenderResult,
    slug: string,
    cacheKey?: string,
    nonce?: string,
  ): Promise<void>;
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
  nonce?: string;
  headers?: Record<string, string>;
  cookies?: ResponseCookie[];
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
    frontmatter: options.pageBundle.frontmatter || {},
    headings: options.pageBundle.headings || [],
    nodeMap: options.pageBundle.nodeMap,
    stream: options.ssrResult.finalStream,
    ssrHash: options.ssrResult.ssrHash,
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.cookies ? { cookies: options.cookies } : {}),
    ...(pageModule ? { pageModule } : {}),
  };

  if (options.shouldCache && !options.skipCachePersist && !options.cookies?.length) {
    void options.cacheCoordinator?.persistResult(
      result,
      options.slug,
      options.cacheKey ?? undefined,
      options.nonce,
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
