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
import { PRIORITY_LOW } from "#veryfront/utils/constants/index.ts";
import { generateNonce } from "#veryfront/security/http/response/security-handler.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { endRequest, startRequest } from "#veryfront/utils";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";
import { type SSRRenderResult, SSRService } from "../../../services/rendering/ssr.service.ts";
import { ErrorPages } from "../../../utils/error-html.ts";
import { buildSSRResponse } from "./ssr-response-builder.ts";

const logger = serverLogger.component("ssr");

/**
 * Determine if request should serve production (released) content.
 * Uses resolvedEnvironment (from domain lookup) with fallback to requestContext.mode.
 * Config override (PRODUCTION_MODE) takes precedence.
 */
export function isProductionMode(ctx: HandlerContext, _url?: URL): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) return true;

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

    const hasDotSegment = slug.split("/").some((segment) => segment.startsWith("."));
    if (hasDotSegment && isProductionMode(ctx, url)) {
      this.logDebug("Dot path blocked in production", { slug }, ctx);
      return Promise.resolve(this.continue());
    }

    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    return this.setupContextAndRender(req, ctx, slug, requestId, url);
  }

  private setupContextAndRender(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      const fsAdapter = ctx.adapter.fs;
      const isExtended = isExtendedFSAdapter(fsAdapter);

      if (ctx.projectSlug && isExtended && fsAdapter.isMultiProjectMode()) {
        const prodMode = isProductionMode(ctx, url);
        const branch = ctx.parsedDomain?.branch ?? null;
        const effectiveToken = ctx.proxyToken || getEnv("VERYFRONT_API_TOKEN") || "";

        logger.debug("Using multi-project context", {
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

      if (isExtended && fsAdapter.isContextualMode()) {
        try {
          if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
          fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);

          const prodMode = isProductionMode(ctx, url);
          fsAdapter.setProductionMode(prodMode, ctx.releaseId);
        } catch (_) {
          // expected: some fs operations may not be supported in this adapter
        }
      }

      return this.handleWithContext(req, ctx, slug, requestId, url);
    } catch (error) {
      logger.error("Context setup failed — request will fall through to 404", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        releaseId: ctx.releaseId,
        hasToken: !!ctx.proxyToken,
        isLocalProject: ctx.isLocalProject,
        slug,
      });
      return Promise.resolve(this.continue());
    }
  }

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
        const memoryStatus = this.ssrService.checkMemoryPressure();
        if (memoryStatus.shouldReject) {
          this.logDebug("Rejecting due to memory pressure", { slug }, ctx);
          const result = this.ssrService.createMemoryPressureResult(slug);
          return this.buildResponse(req, ctx, result, generateNonce());
        }

        const nonce = generateNonce();
        const studioEmbed = url.searchParams.get("studio_embed") === "true";
        const projectId = ctx.projectId || url.searchParams.get("project_id") ||
          ctx.projectSlug || undefined;
        const pageId = url.searchParams.get("page_id") || undefined;
        const noHmr = url.searchParams.get("noHmr") === "1" ||
          url.searchParams.get("no_hmr") === "1";
        const useNoCache = shouldUseNoCacheHeadersFromHandler(ctx);

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

        if (result.errorType === "not-found") {
          return this.handleNotFound(req, ctx, slug, nonce);
        }

        if (result.errorType === "server-error" && !result.showDevOverlay) {
          const customResponse = await this.tryCustomErrorFallback(req, ctx, result, nonce);
          if (customResponse) return customResponse;
        }

        return this.buildResponse(req, ctx, result, nonce);
      },
      { "ssr.slug": slug, "ssr.projectSlug": ctx.projectSlug || "unknown" },
    );
  }

  private async handleNotFound(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.createResponseBuilder(ctx, nonce);

    const notFoundResponse = await tryNotFoundFallback(req, slug, ctx, builder);
    if (notFoundResponse) return this.respond(notFoundResponse);

    const customResponse = await tryErrorPageFallback(req, ctx, builder, {
      statusCode: 404,
      pathname: slug || "/",
    });
    if (customResponse) return this.respond(customResponse);

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

    return customResponse ? this.respond(customResponse) : null;
  }

  private async buildResponse(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.createResponseBuilder(ctx, nonce);
    const response = await buildSSRResponse(req, ctx, result, builder);
    return this.respond(response);
  }
}
