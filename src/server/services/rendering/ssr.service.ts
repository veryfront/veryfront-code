import type { HandlerContext } from "../../handlers/types.ts";
import {
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "../../shared/renderer-factory.ts";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { serverLogger, timeAsync } from "#veryfront/utils";
import { computeSSRETag } from "../../handlers/request/ssr/etag-handler.ts";
import { VeryfrontError } from "#veryfront/errors/index.ts";
import { getColorSchemeFromRequest } from "#veryfront/security/http/client-hints.ts";
import {
  endRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { getErrorCollector } from "#veryfront/observability/error-collector.ts";
import { ErrorOverlay } from "../../dev-server/error-overlay/index.ts";
import { ErrorPages } from "../../utils/error-html.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNAVAILABLE,
} from "#veryfront/utils/constants/index.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";

const logger = serverLogger.component("ssr-service");

export interface SSRRenderResult {
  status: number;
  html?: string;
  stream?: ReadableStream<Uint8Array>;
  isStreaming: boolean;
  etag?: string;
  cacheStrategy: "no-cache" | "short";
  error?: Error;
  errorType?: "not-found" | "undeployed" | "server-error" | "runtime";
  showDevOverlay?: boolean;
  slug: string;
}

export interface SSRRenderOptions {
  request: Request;
  url: URL;
  slug: string;
  nonce: string;
  studioEmbed: boolean;
  projectId?: string;
  pageId?: string;
  noHmr: boolean;
  useNoCache: boolean;
}

export interface MemoryStatus {
  shouldReject: boolean;
  heapUsedMB: number;
  heapLimitMB: number;
  heapUsedPercent: number;
}

export class SSRService {
  private readonly cacheRepo?: CacheRepository<string>;

  constructor(options?: { cacheRepo?: CacheRepository<string> }) {
    this.cacheRepo = options?.cacheRepo;
  }

  checkMemoryPressure(): MemoryStatus {
    const stats = getHeapStats();

    return {
      shouldReject: shouldRejectDueToMemory(),
      heapUsedMB: stats.usedHeapSizeMB,
      heapLimitMB: stats.heapSizeLimitMB,
      heapUsedPercent: stats.heapUsedPercent,
    };
  }

  async getRenderer(ctx: HandlerContext): Promise<RendererAdapter> {
    return timeAsync("renderer-init", () => getRendererForProject(ctx));
  }

  async renderPage(ctx: HandlerContext, options: SSRRenderOptions): Promise<SSRRenderResult> {
    const { request, url, slug, nonce, studioEmbed, projectId, pageId, noHmr, useNoCache } =
      options;

    const renderSessionId = `${ctx.projectSlug || "default"}-${slug || "index"}-${Date.now()}`;
    const preRenderHeap = getHeapStats();

    if (preRenderHeap.heapUsedPercent > 30) {
      logger.debug("Pre-render memory", {
        projectSlug: ctx.projectSlug,
        slug,
        heapUsedMB: preRenderHeap.usedHeapSizeMB,
        heapLimitMB: preRenderHeap.heapSizeLimitMB,
        heapUsedPercent: preRenderHeap.heapUsedPercent,
      });
    }

    try {
      startRenderSession(renderSessionId, ctx.projectSlug, slug);

      const renderer = await this.getRenderer(ctx);
      const {
        scheme: colorScheme,
        fromParam: colorSchemeFromParam,
        fromHeader: colorSchemeFromHeader,
      } = getColorSchemeFromRequest(
        request,
        url,
      );

      logger.debug("renderPage START", {
        projectSlug: ctx.projectSlug,
        projectId,
        slug,
      });

      const renderStartTime = performance.now();
      const result = await timeAsync("render-page", () =>
        renderer.renderPage(slug, {
          delivery: "stream",
          request,
          url,
          nonce,
          studioEmbed,
          projectId,
          pageId,
          colorScheme,
          colorSchemeFromParam,
          colorSchemeFromHeader,
          environment: ctx.requestContext?.mode,
          projectSlug: ctx.projectSlug,
          noHmr,
        }));

      logger.debug("renderPage DONE", {
        projectSlug: ctx.projectSlug,
        slug,
        duration: `${(performance.now() - renderStartTime).toFixed(2)}ms`,
        hasHtml: !!result.html,
        hasStream: !!result.stream,
      });

      endRenderSession(renderSessionId);

      const postRenderHeap = getHeapStats();
      const heapGrowthMB = postRenderHeap.usedHeapSizeMB - preRenderHeap.usedHeapSizeMB;

      if (heapGrowthMB > 50 || postRenderHeap.heapUsedPercent > 50) {
        logger.debug("Post-render memory", {
          projectSlug: ctx.projectSlug,
          slug,
          heapUsedMB: postRenderHeap.usedHeapSizeMB,
          heapLimitMB: postRenderHeap.heapSizeLimitMB,
          heapUsedPercent: postRenderHeap.heapUsedPercent,
          heapGrowthMB: Math.round(heapGrowthMB * 100) / 100,
        });
      }

      const isStreaming = !!result.stream && !result.html;
      const cacheStrategy = useNoCache ? "no-cache" : "short";
      const etag = isStreaming ? undefined : computeSSRETag(result.ssrHash, result.html);

      return {
        status: HTTP_OK,
        html: result.html,
        stream: result.stream ?? undefined,
        isStreaming,
        etag,
        cacheStrategy,
        slug,
      };
    } catch (error) {
      endRenderSession(renderSessionId);
      return this.handleRenderError(error, ctx, slug, request);
    }
  }

  private handleRenderError(
    error: unknown,
    ctx: HandlerContext,
    slug: string,
    request: Request,
  ): SSRRenderResult {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const isDev = ctx.isLocalProject || ctx.requestContext?.mode === "preview";

    if (error instanceof VeryfrontError && error.slug === "file-not-found") {
      logger.debug("Page not found", { slug, error: errorObj.message });
      return {
        status: HTTP_NOT_FOUND,
        html: ErrorPages.notFound(slug || "/"),
        isStreaming: false,
        cacheStrategy: "no-cache",
        errorType: "not-found",
        slug,
      };
    }

    if (
      error instanceof VeryfrontError && error.slug === "api-client-error" && error.status === 404
    ) {
      const apiUrl =
        (((error.context as { details?: { url?: string } } | undefined)?.details?.url) ?? "")
          .toString();

      const isFileListRequest = apiUrl.includes("/files") &&
        !apiUrl.includes("/files/") &&
        (apiUrl.includes("/environments/") || apiUrl.includes("/branches/"));

      if (isFileListRequest) {
        logger.debug("Project not deployed", {
          projectSlug: ctx.projectSlug,
          apiUrl,
        });
        return {
          status: HTTP_NOT_FOUND,
          html: ErrorPages.undeployed(),
          isStreaming: false,
          cacheStrategy: "no-cache",
          errorType: "undeployed",
          slug,
        };
      }
    }

    logger.error("Render failed", {
      slug,
      error: errorObj.message,
      stack: errorObj.stack,
      projectSlug: ctx.projectSlug,
    });

    if (isDev) {
      getErrorCollector().addRuntimeError(errorObj.message, errorObj.stack, {
        source: "ssr-service",
        url: request.url,
        slug,
      });

      return {
        status: HTTP_INTERNAL_SERVER_ERROR,
        html: ErrorOverlay.createHTML({ error: errorObj, type: "runtime" }),
        isStreaming: false,
        cacheStrategy: "no-cache",
        error: errorObj,
        errorType: "runtime",
        showDevOverlay: true,
        slug,
      };
    }

    return {
      status: HTTP_INTERNAL_SERVER_ERROR,
      html: ErrorPages.serverError(),
      isStreaming: false,
      cacheStrategy: "no-cache",
      error: errorObj,
      errorType: "server-error",
      slug,
    };
  }

  createMemoryPressureResult(slug: string): SSRRenderResult {
    return {
      status: HTTP_UNAVAILABLE,
      html: ErrorPages.memoryPressure(),
      isStreaming: false,
      cacheStrategy: "no-cache",
      slug,
    };
  }
}
