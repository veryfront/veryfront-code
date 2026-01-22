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
import {
  endRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { VeryfrontAPIError } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import { isLocalDev, shouldUseNoCacheHeaders } from "../../../context/request-context.ts";

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

  // Use RequestContext.mode if available (unified from hostname/header)
  if (ctx.requestContext) {
    return ctx.requestContext.mode === "production";
  }

  // Fallback for contexts without RequestContext
  if (ctx.parsedDomain?.isVeryfrontDomain) {
    return ctx.parsedDomain.isDraft === false;
  }
  return ctx.proxyEnvironment === "production";
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

        this.logDebug("Using multi-project context", {
          projectSlug: ctx.projectSlug,
          productionMode: prodMode,
          releaseId: prodMode ? ctx.releaseId : undefined,
          branch: !prodMode ? branch : undefined,
          environmentName: ctx.environmentName,
        }, ctx);

        return fsAdapter.runWithContext(
          ctx.projectSlug,
          ctx.proxyToken || "",
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
            generateStyledErrorHtml(
              503,
              "Service Unavailable",
              "The server is under heavy load. Please try again.",
            ),
            503,
          ),
      );
    }

    try {
      // Use centralized renderer factory with per-project LRU caching
      // This prevents memory growth in multi-project mode
      const renderer = await timeAsync("renderer-init", () => getRendererForProject(ctx));
      this.logDebug("renderer obtained", { mode: ctx.mode, projectSlug: ctx.projectSlug }, ctx);

      // Extract route parameters for both App Router and Pages Router
      // Run both extractions in parallel for better performance
      let params: Record<string, string | string[]> | null | undefined;
      try {
        const { extractAppRouteParams, extractPagesRouteParams } = await import(
          "../../../../rendering/router-detection.ts"
        );

        // Run both extractions in parallel - use the first non-null result
        const [appParams, pagesParams] = await Promise.all([
          timeAsync(
            "extract-app-route-params",
            () => extractAppRouteParams(ctx.projectDir, slug, ctx.adapter),
          ),
          typeof extractPagesRouteParams === "function"
            ? timeAsync(
              "extract-pages-route-params",
              () => extractPagesRouteParams(ctx.projectDir, slug, ctx.adapter),
            )
            : Promise.resolve(null),
        ]);

        // Prefer App Router params, fallback to Pages Router
        const extractedParams = appParams || pagesParams;

        if (extractedParams) {
          params = extractedParams;
          this.logDebug("Extracted route params", { slug, params }, ctx);
        }
      } catch (paramError) {
        // Param extraction is best-effort - continue without params if it fails
        this.logDebug("Failed to extract params", {
          slug,
          error: this.getErrorMessage(paramError),
        }, ctx);
      }

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

      const result = await timeAsync("render-page", () =>
        renderer.renderPage(slug, {
          delivery: "stream",
          params: params ?? undefined,
          request: req,
          url,
          nonce,
          studioEmbed,
          projectId,
          pageId,
          colorScheme,
          colorSchemeFromParam,
          proxyEnvironment: ctx.proxyEnvironment,
          projectSlug: ctx.projectSlug,
        }));

      // End tracking and record to manifest for future requests
      endRenderSession(renderSessionId);

      this.logDebug("SSR successful", { slug, params }, ctx);
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
      const isDev = isLocalDev();
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
        const body = isHeadRequest ? null : generateStyledErrorHtml(
          404,
          "Not Found",
          `The requested path "${slug || "/"}" could not be found`,
        );

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

          const body = isHeadRequest ? null : generateStyledErrorHtml(
            404,
            "Nothing here yet",
            "This project hasn't been deployed",
          );

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
      if (!isHead && (ctx.mode === "development" || ctx.proxyEnvironment === "preview")) {
        const { ErrorOverlay } = await import(
          "../../../dev-server/error-overlay/index.ts"
        );
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
      const body = isHead ? null : generateStyledErrorHtml(
        500,
        "Internal Server Error",
        "Something went wrong while rendering this page",
      );

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR);

      return this.respond(response);
    }
  }
}

/**
 * Generate a styled error page for any status code.
 * Styled to match the Veryfront design system.
 */
function generateStyledErrorHtml(
  statusCode: number,
  title: string,
  message: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <link rel="icon" type="image/png" href="https://cdn.veryfront.com/images/veryfront-favicon.png">
  <title>${statusCode} ${title} — Veryfront</title>
  <style>
    :root {
      --bg: #ffffff;
      --title: #374151;
      --message: #9ca3af;
    }
    /* Dark mode: system preference, .dark class, or data-theme="dark" */
    @media (prefers-color-scheme: dark) {
      :root:not(.light):not([data-theme="light"]) {
        --bg: #0d0e11;
        --title: #949A9F;
        --message: #6b7280;
      }
    }
    :root.dark, :root[data-theme="dark"] {
      --bg: #0d0e11;
      --title: #949A9F;
      --message: #6b7280;
    }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .title {
      margin: 0 0 0.75rem;
      font-size: 1.875rem;
      font-weight: 500;
      color: var(--title);
      letter-spacing: -0.025em;
    }
    .message {
      margin: 0;
      font-size: 1rem;
      color: var(--message);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="title">${title}</h1>
    <p class="message">${message}</p>
  </div>
</body>
</html>`;
}
