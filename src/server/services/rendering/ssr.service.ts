/**
 * SSR Rendering Service
 *
 * Business logic for server-side rendering, extracted from SSRHandler.
 * This service handles rendering logic independent of HTTP concerns.
 *
 * @module server/services/rendering/ssr-service
 */

import type { HandlerContext } from "../../handlers/types.ts";
import {
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "../../shared/renderer-factory.ts";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { timeAsync } from "#veryfront/utils";
import { computeSSRETag } from "../../handlers/request/ssr/etag-handler.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import { getColorSchemeFromRequest } from "#veryfront/security/http/client-hints.ts";
import {
  endRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { VeryfrontAPIError } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";
import { ErrorOverlay } from "../../dev-server/error-overlay/index.ts";
import { ErrorPages } from "../../utils/error-html.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNAVAILABLE,
} from "#veryfront/utils/constants/index.ts";

/**
 * Result of an SSR render operation
 */
export interface SSRRenderResult {
  /** HTTP status code */
  status: number;
  /** HTML content (for non-streaming) */
  html?: string;
  /** Stream content (for streaming) */
  stream?: ReadableStream<Uint8Array>;
  /** Whether this is a true streaming response */
  isStreaming: boolean;
  /** ETag for caching */
  etag?: string;
  /** Cache strategy to use */
  cacheStrategy: "no-cache" | "short";
  /** Error that occurred during rendering */
  error?: Error;
  /** Error type for dev overlay */
  errorType?: "not-found" | "undeployed" | "server-error" | "runtime";
  /** Whether to show dev error overlay */
  showDevOverlay?: boolean;
  /** Original slug that was requested */
  slug: string;
}

/**
 * Options for SSR rendering
 */
export interface SSRRenderOptions {
  /** Request object */
  request: Request;
  /** Parsed URL */
  url: URL;
  /** Page slug */
  slug: string;
  /** Security nonce for inline scripts */
  nonce: string;
  /** Whether this is a studio embed */
  studioEmbed: boolean;
  /** Project ID */
  projectId?: string;
  /** Page ID */
  pageId?: string;
  /** Whether to disable HMR */
  noHmr: boolean;
  /** Whether to use no-cache headers */
  useNoCache: boolean;
}

/**
 * Memory status for render decisions
 */
export interface MemoryStatus {
  shouldReject: boolean;
  heapUsedMB: number;
  heapLimitMB: number;
  heapUsedPercent: number;
}

/**
 * SSR Rendering Service
 *
 * Handles the business logic of server-side rendering:
 * - Memory pressure monitoring
 * - Renderer lifecycle management
 * - Page rendering
 * - Error classification
 */
export class SSRService {
  /**
   * Check if the request should be rejected due to memory pressure
   */
  checkMemoryPressure(): MemoryStatus {
    const shouldReject = shouldRejectDueToMemory();
    const stats = getHeapStats();

    return {
      shouldReject,
      heapUsedMB: stats.usedHeapSizeMB,
      heapLimitMB: stats.heapSizeLimitMB,
      heapUsedPercent: stats.heapUsedPercent,
    };
  }

  /**
   * Get or create a renderer for the given context
   */
  async getRenderer(ctx: HandlerContext): Promise<RendererAdapter> {
    return await timeAsync("renderer-init", () => getRendererForProject(ctx));
  }

  /**
   * Render a page with full context
   */
  async renderPage(
    ctx: HandlerContext,
    options: SSRRenderOptions,
  ): Promise<SSRRenderResult> {
    const { request, url, slug, nonce, studioEmbed, projectId, pageId, noHmr, useNoCache } =
      options;

    const renderSessionId = `${ctx.projectSlug || "default"}-${slug || "index"}-${Date.now()}`;
    const preRenderHeap = getHeapStats();

    // Log pre-render memory if significant
    if (preRenderHeap.heapUsedPercent > 30) {
      logger.debug("[SSRService] Pre-render memory", {
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
      const { scheme: colorScheme, fromParam: colorSchemeFromParam } = getColorSchemeFromRequest(
        request,
        url,
      );

      logger.debug("[SSRService] renderPage START", {
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
          environment: ctx.requestContext?.mode,
          projectSlug: ctx.projectSlug,
          noHmr,
        }));

      logger.debug("[SSRService] renderPage DONE", {
        projectSlug: ctx.projectSlug,
        slug,
        duration: `${(performance.now() - renderStartTime).toFixed(2)}ms`,
        hasHtml: !!result.html,
        hasStream: !!result.stream,
      });

      endRenderSession(renderSessionId);

      // Log post-render memory if significant growth
      const postRenderHeap = getHeapStats();
      const heapGrowthMB = postRenderHeap.usedHeapSizeMB - preRenderHeap.usedHeapSizeMB;
      if (heapGrowthMB > 50 || postRenderHeap.heapUsedPercent > 50) {
        logger.debug("[SSRService] Post-render memory", {
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

  /**
   * Classify and handle render errors
   */
  private handleRenderError(
    error: unknown,
    ctx: HandlerContext,
    slug: string,
    request: Request,
  ): SSRRenderResult {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const isDev = ctx.requestContext?.isLocalDev || ctx.requestContext?.mode === "preview";

    // Handle not found errors
    if (error instanceof VeryfrontError && error.code === ErrorCode.FILE_NOT_FOUND) {
      logger.debug("[SSRService] Page not found", { slug, error: errorObj.message });
      return {
        status: HTTP_NOT_FOUND,
        html: ErrorPages.notFound(slug || "/"),
        isStreaming: false,
        cacheStrategy: "no-cache",
        errorType: "not-found",
        slug,
      };
    }

    // Handle API 404 errors (undeployed project)
    if (error instanceof VeryfrontAPIError && error.status === 404) {
      const errorDetails = error.details as { url?: string } | undefined;
      const apiUrl = errorDetails?.url || "";

      const isFileListRequest = apiUrl.includes("/files") &&
        !apiUrl.includes("/files/") &&
        (apiUrl.includes("/environments/") || apiUrl.includes("/branches/"));

      if (isFileListRequest) {
        logger.debug("[SSRService] Project not deployed", {
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

    // Log the error
    logger.error("[SSRService] Render failed", {
      slug,
      error: errorObj.message,
      stack: errorObj.stack,
      projectSlug: ctx.projectSlug,
    });

    // Capture for MCP flywheel in dev mode
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

    // Production error
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

  /**
   * Create a memory pressure error result
   */
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
