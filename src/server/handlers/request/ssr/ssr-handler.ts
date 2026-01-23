/**
 * Server-Side Rendering Handler
 *
 * Main handler for SSR pages and dynamic routes.
 * Orchestrates renderer, ETag handling, and not-found fallbacks.
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
import {
  getRendererForProject,
  shouldRejectDueToMemory,
} from "../../../shared/renderer-factory.ts";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { serverLogger as _logger } from "#veryfront/utils";
import { endRequest, startRequest, timeAsync } from "#veryfront/utils";
import { computeSSRETag } from "./etag-handler.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_LOW,
} from "#veryfront/utils/constants/index.ts";
import { generateNonce } from "#veryfront/security/http/response/security-handler.ts";
import { getColorSchemeFromRequest } from "#veryfront/security/http/client-hints.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  endRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { VeryfrontAPIError } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import { shouldUseNoCacheHeaders } from "../../../context/request-context.ts";
import { ErrorPages } from "../../../utils/error-html.ts";
import { ErrorOverlay } from "../../../dev-server/error-overlay/index.ts";

/**
 * Determine if request should serve production (released) content.
 * Uses RequestContext.mode which unifies hostname and x-environment header.
 * Config override (PRODUCTION_MODE) takes precedence.
 */
export function isProductionMode(ctx: HandlerContext, _url?: URL): boolean {
  // Config override (PRODUCTION_MODE env var)
  if (ctx.config?.fs?.veryfront?.productionMode === true) {
    return true;
  }

  // Use RequestContext.mode (unified from hostname/header)
  // Default to preview (safer for development) if no context
  return ctx.requestContext?.mode === "production";
}

/**
 * SSR Handler Class
 *
 * Handles server-side rendering for pages and dynamic routes.
 *
 * Features:
 * - Lazy renderer initialization with caching
 * - ETag support for 304 Not Modified responses
 * - App Router not-found.tsx fallback
 * - Streaming and static HTML delivery
 * - CORS and security headers
 * - Short-term caching for rendered pages
 *
 * Priority: 1000 (LOW) - runs after static and API handlers
 * Patterns: All GET/HEAD requests except internal paths
 *
 * @example
 * ```typescript
 * const handler = new SSRHandler();
 * const result = await handler.handle(request, context);
 * ```
 */
export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW as HandlerPriority, // LOW priority - runs after static and API
    patterns: [
      // Match all paths except internal ones
      { pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] },
    ],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Skip internal paths and file extensions (likely static files)
    // Allow .veryfront paths but skip other paths with file extensions
    if (pathname.startsWith("/_veryfront/")) {
      return Promise.resolve(this.continue());
    }
    // Check for file extensions (dot followed by extension at end or before query)
    // but allow .veryfront directory paths
    const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname) &&
      !pathname.includes("/.veryfront/") && !pathname.startsWith("/.veryfront");
    if (hasFileExtension) {
      return Promise.resolve(this.continue());
    }

    const slug = pathname === "/" ? "" : pathname.replace(/^\//, "").replace(/\/$/, "");
    const requestId = `${slug || "index"}-${Date.now()}`;
    startRequest(requestId);

    // Block dotfile/dotfolder routes in production (e.g., .veryfront, .env, .git)
    // These are framework/dev-only paths that should never be served in production
    const hasDotSegment = slug.split("/").some((segment) => segment.startsWith("."));
    if (hasDotSegment) {
      const prodMode = isProductionMode(ctx, url);
      if (prodMode) {
        this.logDebug("Dot path blocked in production", { slug }, ctx);
        return Promise.resolve(this.continue()); // Let it 404
      }
    }

    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    try {
      const fsAdapter = ctx.adapter.fs;

      // For multi-project mode, use runWithContext (required for MultiProjectFSAdapter)
      const hasMultiProjectSupport = isExtendedFSAdapter(fsAdapter) &&
        fsAdapter.isMultiProjectMode();

      if (ctx.projectSlug && hasMultiProjectSupport) {
        const prodMode = isProductionMode(ctx, url);
        const branch = ctx.parsedDomain?.branch ?? null;

        // Get effective token: proxy token (from x-token header) or env token (direct mode)
        const effectiveToken = ctx.proxyToken || getEnv("VERYFRONT_API_TOKEN") || "";

        _logger.debug("[SSR] Using multi-project context - entering runWithContext", {
          projectSlug: ctx.projectSlug,
          productionMode: prodMode,
          releaseId: prodMode ? ctx.releaseId : undefined,
          branch: !prodMode ? branch : undefined,
          environmentName: ctx.environmentName,
          slug,
          hasProxyToken: !!ctx.proxyToken,
          hasEnvToken: !!getEnv("VERYFRONT_API_TOKEN"),
        });

        const runWithContextStartTime = performance.now();
        return fsAdapter.runWithContext(
          ctx.projectSlug,
          effectiveToken,
          () => {
            _logger.debug("[SSR] runWithContext callback started", {
              projectSlug: ctx.projectSlug,
              slug,
              duration: `${(performance.now() - runWithContextStartTime).toFixed(2)}ms`,
            });
            return this.handleWithContext(req, ctx, slug, requestId, url);
          },
          ctx.projectId,
          {
            productionMode: prodMode,
            releaseId: ctx.releaseId,
            branch,
            environmentName: ctx.environmentName,
          },
        );
      }

      // Single-project mode: set per-request context if available
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
      // Unexpected error in context setup - log and continue to 404
      this.logDebug("Unexpected error in context setup", {
        error: this.getErrorMessage(error),
      }, ctx);
      return Promise.resolve(this.continue());
    }
  }

  private async handleWithContext(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    const handleWithContextStartTime = performance.now();
    _logger.debug("[SSR] handleWithContext START", {
      projectSlug: ctx.projectSlug,
      projectId: ctx.projectId,
      slug,
    });

    // Extract studio_embed for Studio-specific features (bridge script, element selectors)
    const studioEmbed = url.searchParams.get("studio_embed") === "true";

    // Pre-render memory check - reject if memory is critically high to prevent OOM
    if (shouldRejectDueToMemory()) {
      const nonce = generateNonce();
      const builder = this.createResponseBuilder(ctx, nonce);
      this.logDebug("Rejecting request due to memory pressure", { slug }, ctx);

      return this.respond(
        builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withCache("no-cache")
          .withContentType(
            getContentType(".html"),
            ErrorPages.memoryPressure(),
            503,
          ),
      );
    }

    try {
      // Use centralized renderer factory with per-project LRU caching
      // This prevents memory growth in multi-project mode
      _logger.debug("[SSR] getRendererForProject START", {
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        slug,
        elapsedInHandler: `${(performance.now() - handleWithContextStartTime).toFixed(2)}ms`,
      });
      const _getRendererStartTime = performance.now();
      const renderer = await timeAsync("renderer-init", () => getRendererForProject(ctx));
      this.logDebug(
        "renderer obtained",
        { isDev: ctx.requestContext?.isLocalDev ?? false, projectSlug: ctx.projectSlug },
        ctx,
      );

      // Route params are extracted by the render pipeline after page resolution,
      // avoiding redundant filesystem walks. We don't pre-extract here.

      // Generate nonce for CSP before rendering
      const nonce = generateNonce();
      this.logDebug(`[NONCE-TRACE] Generated nonce for SSR: ${nonce}`, { slug }, ctx);

      const projectId = ctx.projectId || url.searchParams.get("project_id") || ctx.projectSlug ||
        undefined;
      const pageId = url.searchParams.get("page_id") || undefined;

      // Extract color scheme from client hints or color_mode query parameter
      const { scheme: colorScheme, fromParam: colorSchemeFromParam } = getColorSchemeFromRequest(
        req,
        url,
      );

      // Memory profiling: log heap before render for debugging large projects
      const preRenderHeap = getHeapStats();
      if (preRenderHeap.heapUsedPercent > 30) {
        _logger.debug("[SSR] Pre-render memory", {
          projectSlug: ctx.projectSlug,
          slug,
          heapUsedMB: preRenderHeap.usedHeapSizeMB,
          heapLimitMB: preRenderHeap.heapSizeLimitMB,
          heapUsedPercent: preRenderHeap.heapUsedPercent,
        });
      }

      // Start tracking modules for manifest (used for expanded modulepreload hints)
      const renderSessionId = `${ctx.projectSlug || "default"}-${slug || "index"}-${Date.now()}`;
      startRenderSession(renderSessionId, ctx.projectSlug, slug);

      _logger.debug("[SSR] renderer.renderPage START", {
        projectSlug: ctx.projectSlug,
        projectId,
        slug,
        elapsedInHandler: `${(performance.now() - handleWithContextStartTime).toFixed(2)}ms`,
      });
      const renderPageStartTime = performance.now();
      const result = await timeAsync("render-page", () =>
        renderer.renderPage(slug, {
          delivery: "stream",
          // params extracted by pipeline after page resolution
          request: req,
          url,
          nonce,
          studioEmbed,
          projectId,
          pageId,
          colorScheme,
          colorSchemeFromParam,
          environment: ctx.requestContext?.mode,
          projectSlug: ctx.projectSlug,
        }));
      _logger.debug("[SSR] renderer.renderPage DONE", {
        projectSlug: ctx.projectSlug,
        slug,
        duration: `${(performance.now() - renderPageStartTime).toFixed(2)}ms`,
        hasHtml: !!result.html,
        hasStream: !!result.stream,
      });

      // End tracking and record to manifest for future requests
      endRenderSession(renderSessionId);

      this.logDebug("SSR successful", { slug }, ctx);
      endRequest(requestId);

      // Memory profiling: log heap after render for debugging large projects
      const postRenderHeap = getHeapStats();
      const heapGrowthMB = postRenderHeap.usedHeapSizeMB - preRenderHeap.usedHeapSizeMB;
      if (heapGrowthMB > 50 || postRenderHeap.heapUsedPercent > 50) {
        _logger.debug("[SSR] Post-render memory", {
          projectSlug: ctx.projectSlug,
          slug,
          heapUsedMB: postRenderHeap.usedHeapSizeMB,
          heapLimitMB: postRenderHeap.heapSizeLimitMB,
          heapUsedPercent: postRenderHeap.heapUsedPercent,
          heapGrowthMB: Math.round(heapGrowthMB * 100) / 100,
        });
      }

      // TRUE STREAMING: If we have a stream but no buffered HTML, this is true streaming mode
      // Skip ETag/304 checks since we don't have the content to hash
      const isTrueStreaming = result.stream && !result.html;

      // Disable caching in development to prevent nonce mismatches
      // (cached HTML has old nonces, but each request generates a fresh nonce for CSP)
      // Preview URLs use short cache - poke mechanism triggers hard refresh on content changes
      // HTTP cache headers: no-cache for development and preview, short for production
      // Preview uses no-cache HTTP headers because browser must fetch fresh content
      // Server-side memory caches handle performance in preview mode (Phase 7)
      const cacheStrategy = shouldUseNoCacheHeaders(ctx.requestContext) ? "no-cache" : "short";
      const isHeadRequest = req.method.toUpperCase() === "HEAD";
      const builder = this.createResponseBuilder(ctx, nonce);

      // For true streaming, skip ETag and return stream immediately for fast TTFB
      if (isTrueStreaming) {
        this.logDebug("True streaming SSR - returning stream immediately", { slug }, ctx);

        const response = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withClientHints() // Enable Sec-CH-Prefers-Color-Scheme for theme detection
          .withCache("no-cache") // Don't cache streaming responses
          .withContentType(
            getContentType(".html"),
            result.stream!, // Non-null: isTrueStreaming already verified stream exists
            HTTP_OK,
          );

        if (isHeadRequest) {
          await response.body?.cancel().catch(() => {/* ignore */});
          return this.respond(
            new Response(null, { status: response.status, headers: response.headers }),
          );
        }

        return this.respond(response);
      }

      // Buffered mode: compute ETag and support 304 responses
      const etag = computeSSRETag(result.ssrHash, result.html);

      // Check if-none-match for 304 response
      // IMPORTANT: Skip 304 in dev mode to prevent CSP nonce mismatch
      // (304 returns new nonce in CSP but browser uses cached HTML with old nonce)
      const isDev = ctx.requestContext?.isLocalDev ?? false;
      if (!isDev && hasMatchingEtag(req, etag)) {
        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withCache(cacheStrategy)
            .notModified(etag),
        );
      }

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withClientHints() // Enable Sec-CH-Prefers-Color-Scheme for theme detection
        .withCache(cacheStrategy)
        .withETag(etag)
        .withContentType(
          getContentType(".html"),
          result.stream || result.html,
          HTTP_OK,
        );

      if (isHeadRequest) {
        await response.body?.cancel().catch(() => {
          /* ignore */
        });
        return this.respond(
          new Response(null, {
            status: response.status,
            headers: response.headers,
          }),
        );
      }

      return this.respond(response);
    } catch (error) {
      if (error instanceof VeryfrontError && error.code === ErrorCode.FILE_NOT_FOUND) {
        this.logDebug("SSR renderPage not found", {
          slug,
          error: this.getErrorMessage(error),
        }, ctx);

        // Generate nonce for 404 response HTML
        const notFoundNonce = generateNonce();
        const builder = this.createResponseBuilder(ctx, notFoundNonce);

        // Try App Router not-found.tsx first
        const notFoundResponse = await tryNotFoundFallback(req, slug, ctx, builder);
        if (notFoundResponse) {
          return this.respond(notFoundResponse);
        }

        // Try Pages Router custom 404 page
        const customNotFoundResponse = await tryErrorPageFallback(req, ctx, builder, {
          statusCode: HTTP_NOT_FOUND,
          pathname: slug || "/",
        });
        if (customNotFoundResponse) {
          return this.respond(customNotFoundResponse);
        }

        const isHeadRequest = req.method.toUpperCase() === "HEAD";
        const body = isHeadRequest ? null : ErrorPages.notFound(slug || "/");

        const response = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withCache("no-cache")
          .withContentType(getContentType(".html"), body, HTTP_NOT_FOUND);

        return this.respond(response);
      }

      // Check for API 404 errors from file LIST endpoints - means no content exists
      // This handles both:
      // - /environments/{name}/files (production mode, no release)
      // - /branches/{name}/files (preview mode, no draft content)
      // Important: Only match list endpoints, NOT individual file fetches (/files/{path})
      if (error instanceof VeryfrontAPIError && error.status === 404) {
        const errorDetails = error.details as { url?: string; responseText?: string } | undefined;
        const apiUrl = errorDetails?.url || "";

        // Check if this is a file list request (not a specific file fetch)
        // List endpoints end with /files or /files?... (no path after /files/)
        const isFileListRequest = apiUrl.includes("/files") &&
          !apiUrl.includes("/files/") &&
          (apiUrl.includes("/environments/") || apiUrl.includes("/branches/"));

        // Show friendly page when listing files fails (no release or no draft content)
        if (isFileListRequest) {
          this.logDebug("No content found for project", {
            projectSlug: ctx.projectSlug,
            apiUrl,
            error: this.getErrorMessage(error),
          }, ctx);

          const notDeployedNonce = generateNonce();
          const builder = this.createResponseBuilder(ctx, notDeployedNonce);
          const isHeadRequest = req.method.toUpperCase() === "HEAD";

          const body = isHeadRequest ? null : ErrorPages.undeployed();

          const response = builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withCache("no-cache")
            .withContentType(getContentType(".html"), body, HTTP_NOT_FOUND);

          return this.respond(response);
        }
      }

      // Always log SSR errors for debugging (not just in debug mode)
      _logger.error("[SSR] renderPage failed", {
        slug,
        error: this.getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        projectSlug: ctx.projectSlug,
      });
      this.logDebug("SSR renderPage failed with error", {
        slug,
        error: this.getErrorMessage(error),
      }, ctx);

      // Generate nonce for error response HTML
      const errorNonce = generateNonce();
      const builder = this.createResponseBuilder(ctx, errorNonce);
      const isHead = req.method.toUpperCase() === "HEAD";
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // In development or preview mode, show error overlay with full stack trace
      // Preview is a dev environment (branch previews) so developers need detailed errors
      if (!isHead && (ctx.requestContext?.isLocalDev || ctx.requestContext?.mode === "preview")) {
        const body = ErrorOverlay.createHTML({
          error: errorObj,
          type: "runtime",
        });
        const response = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withCache("no-cache")
          .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR);
        return this.respond(response);
      }

      // In production, try custom error pages first
      const customErrorResponse = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: HTTP_INTERNAL_SERVER_ERROR,
        error: errorObj,
        pathname: slug || "/",
      });
      if (customErrorResponse) {
        return this.respond(customErrorResponse);
      }

      // Generic error fallback
      const body = isHead ? null : ErrorPages.serverError();

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR);

      return this.respond(response);
    }
  }
}
