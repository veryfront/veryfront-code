/**
 * Server-Side Rendering Handler
 *
 * Thin orchestration layer for SSR pages and dynamic routes.
 * Delegates business logic to SSRService, handles HTTP concerns.
 *
 * @module server/handlers/request/ssr/ssr-handler
 */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { hasMatchingEtag } from "../../utils/etag.ts";
import { getContentType } from "../../utils/content-types.ts";
import { PRIORITY_LOW } from "#veryfront/utils/constants/index.ts";
import { generateNonce } from "#veryfront/security/http/response/security-handler.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { endRequest, startRequest } from "#veryfront/utils";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";
import { type SSRRenderResult, SSRService } from "../../../services/rendering/ssr.service.ts";
import { ErrorPages } from "../../../utils/error-html.ts";

/**
 * Determine if request should serve production (released) content.
 * Uses resolvedEnvironment (from domain lookup) with fallback to requestContext.mode.
 * Config override (PRODUCTION_MODE) takes precedence.
 */
export function isProductionMode(ctx: HandlerContext, _url?: URL): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) {
    return true;
  }

  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
  return environment === "production";
}

/**
 * SSR Handler - Thin orchestration layer
 *
 * Responsibilities:
 * - Route matching and quick rejections
 * - Multi-project context setup
 * - Response building with headers
 * - Custom fallback handling (not-found, error pages)
 *
 * Business logic is delegated to SSRService.
 */
export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW as HandlerPriority,
    patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
  };

  private ssrService = new SSRService();

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Quick rejections
    if (pathname.startsWith("/_veryfront/")) {
      return Promise.resolve(this.continue());
    }

    const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname) &&
      !pathname.includes("/.veryfront/") &&
      !pathname.startsWith("/.veryfront");
    if (hasFileExtension) {
      return Promise.resolve(this.continue());
    }

    const slug = pathname === "/" ? "" : pathname.replace(/^\//, "").replace(/\/$/, "");
    const requestId = `${slug || "index"}-${Date.now()}`;
    startRequest(requestId);

    // Block dot segments in production
    const hasDotSegment = slug.split("/").some((segment) => segment.startsWith("."));
    if (hasDotSegment && isProductionMode(ctx, url)) {
      this.logDebug("Dot path blocked in production", { slug }, ctx);
      return Promise.resolve(this.continue());
    }

    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    // Setup context and delegate to handleWithContext
    return this.setupContextAndRender(req, ctx, slug, requestId, url);
  }

  /**
   * Setup multi-project context if needed, then render
   */
  private setupContextAndRender(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      const fsAdapter = ctx.adapter.fs;
      const hasMultiProjectSupport = isExtendedFSAdapter(fsAdapter) &&
        fsAdapter.isMultiProjectMode();

      if (ctx.projectSlug && hasMultiProjectSupport) {
        const prodMode = isProductionMode(ctx, url);
        const branch = ctx.parsedDomain?.branch ?? null;
        const effectiveToken = ctx.proxyToken || getEnv("VERYFRONT_API_TOKEN") || "";

        logger.debug("[SSR] Using multi-project context", {
          projectSlug: ctx.projectSlug,
          productionMode: prodMode,
          slug,
        });

        return fsAdapter.runWithContext(
          ctx.projectSlug,
          effectiveToken,
          () => this.handleWithContext(req, ctx, slug, requestId, url),
          ctx.projectId,
          {
            productionMode: prodMode,
            releaseId: ctx.releaseId,
            branch,
            environmentName: ctx.environmentName,
          },
        );
      }

      // Setup contextual mode if available
      if (isExtendedFSAdapter(fsAdapter) && fsAdapter.isContextualMode()) {
        try {
          if (ctx.proxyToken) {
            fsAdapter.setRequestToken(ctx.proxyToken);
          }
          fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
          const prodMode = isProductionMode(ctx, url);
          fsAdapter.setProductionMode(prodMode, ctx.releaseId);
        } catch {
          // Some operations may not be supported, continue anyway
        }
      }

      return this.handleWithContext(req, ctx, slug, requestId, url);
    } catch (error) {
      this.logDebug(
        "Unexpected error in context setup",
        { error: this.getErrorMessage(error) },
        ctx,
      );
      return Promise.resolve(this.continue());
    }
  }

  /**
   * Handle SSR rendering with proper context
   */
  private handleWithContext(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    return withSpan(
      "ssr.handleWithContext",
      async () => {
        // Check memory pressure
        const memoryStatus = this.ssrService.checkMemoryPressure();
        if (memoryStatus.shouldReject) {
          this.logDebug("Rejecting due to memory pressure", { slug }, ctx);
          const result = this.ssrService.createMemoryPressureResult(slug);
          return this.buildResponse(req, ctx, result, generateNonce());
        }

        // Prepare render options
        const nonce = generateNonce();
        const studioEmbed = url.searchParams.get("studio_embed") === "true";
        const projectId = ctx.projectId || url.searchParams.get("project_id") ||
          ctx.projectSlug || undefined;
        const pageId = url.searchParams.get("page_id") || undefined;
        const noHmr = url.searchParams.get("noHmr") === "1" ||
          url.searchParams.get("no_hmr") === "1";
        const useNoCache = shouldUseNoCacheHeadersFromHandler(ctx);

        // Render page via service
        const result = await this.ssrService.renderPage(ctx, {
          request: req,
          url,
          slug,
          nonce,
          studioEmbed,
          projectId,
          pageId,
          noHmr,
          useNoCache,
        });

        endRequest(requestId);

        // Handle custom fallbacks for errors
        if (result.errorType === "not-found") {
          return this.handleNotFound(req, ctx, slug, nonce);
        }

        if (result.errorType === "server-error" && !result.showDevOverlay) {
          const customResponse = await this.tryCustomErrorFallback(req, ctx, result, nonce);
          if (customResponse) return customResponse;
        }

        // Build and return response
        return this.buildResponse(req, ctx, result, nonce);
      },
      { "ssr.slug": slug, "ssr.projectSlug": ctx.projectSlug || "unknown" },
    );
  }

  /**
   * Handle not-found with custom fallbacks
   */
  private async handleNotFound(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.createResponseBuilder(ctx, nonce);

    // Try custom not-found page
    const notFoundResponse = await tryNotFoundFallback(req, slug, ctx, builder);
    if (notFoundResponse) {
      return this.respond(notFoundResponse);
    }

    // Try custom error page
    const customResponse = await tryErrorPageFallback(req, ctx, builder, {
      statusCode: 404,
      pathname: slug || "/",
    });
    if (customResponse) {
      return this.respond(customResponse);
    }

    // Use default not-found page
    const result: SSRRenderResult = {
      status: 404,
      html: ErrorPages.notFound(slug || "/"),
      isStreaming: false,
      cacheStrategy: "no-cache",
      errorType: "not-found",
      slug,
    };
    return this.buildResponse(req, ctx, result, nonce);
  }

  /**
   * Try custom error page fallback
   */
  private async tryCustomErrorFallback(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): Promise<HandlerResult | null> {
    const builder = this.createResponseBuilder(ctx, nonce);
    const customResponse = await tryErrorPageFallback(req, ctx, builder, {
      statusCode: result.status,
      error: result.error,
      pathname: result.slug || "/",
    });
    if (customResponse) {
      return this.respond(customResponse);
    }
    return null;
  }

  /**
   * Build HTTP response from render result
   */
  private async buildResponse(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.createResponseBuilder(ctx, nonce);
    const isHeadRequest = req.method.toUpperCase() === "HEAD";
    const isDev = ctx.requestContext?.isLocalDev ?? false;

    // Handle streaming response
    if (result.isStreaming && result.stream) {
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withClientHints()
        .withCache("no-cache")
        .withContentType(getContentType(".html"), result.stream, result.status);

      if (isHeadRequest) {
        await response.body?.cancel().catch(() => {});
        return this.respond(
          new Response(null, { status: response.status, headers: response.headers }),
        );
      }
      return this.respond(response);
    }

    // Handle ETag matching (304 Not Modified)
    if (!isDev && result.etag && hasMatchingEtag(req, result.etag)) {
      return this.respond(
        builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withCache(result.cacheStrategy)
          .notModified(result.etag),
      );
    }

    // Build standard response
    // Fallback to error page if neither html nor stream is available
    const content = result.html || result.stream || ErrorPages.serverError();
    const body = isHeadRequest ? null : content;
    let response = builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined)
      .withCache(result.cacheStrategy);

    if (!result.isStreaming) {
      response = response.withClientHints();
    }

    if (result.etag) {
      response = response.withETag(result.etag);
    }

    const finalResponse = response.withContentType(
      getContentType(".html"),
      body,
      result.status,
    );

    if (isHeadRequest && finalResponse.body) {
      await finalResponse.body.cancel().catch(() => {});
      return this.respond(
        new Response(null, { status: finalResponse.status, headers: finalResponse.headers }),
      );
    }

    return this.respond(finalResponse);
  }
}
