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
import { createRenderer } from "@veryfront/rendering/index.ts";
import { serverLogger as _logger } from "@veryfront/utils";
import { endRequest, startRequest, timeAsync } from "@veryfront/utils";
import { computeSSRETag } from "./etag-handler.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_LOW,
} from "@veryfront/core/constants/index.ts";
import { generateNonce } from "@veryfront/security/http/response/security-handler.ts";

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

  private rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null = null;

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Skip internal paths and file extensions (likely static files)
    if (pathname.startsWith("/_veryfront/") || pathname.includes(".")) {
      return this.continue();
    }

    const slug = pathname === "/" ? "" : pathname.replace(/^\//, "").replace(/\/$/, "");
    const requestId = `${slug || "index"}-${Date.now()}`;
    startRequest(requestId);

    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    try {
      // Inject proxy token into FSAdapter before rendering
      // This ensures API calls use the per-request OAuth token from the proxy
      if (ctx.proxyToken && ctx.projectSlug) {
        const fsWrapper = ctx.adapter.fs as {
          setRequestToken?: (t: string) => void;
          runWithContext?: <T>(slug: string, token: string, fn: () => Promise<T>) => Promise<T>;
        };
        // For multi-project mode, use runWithContext
        if (typeof fsWrapper.runWithContext === "function") {
          this.logDebug("Using multi-project context", { projectSlug: ctx.projectSlug }, ctx);
          return fsWrapper.runWithContext(ctx.projectSlug, ctx.proxyToken, async () => {
            return this.handleWithContext(req, ctx, slug, requestId, url);
          });
        }
        // For single-project mode, use setRequestToken
        if (typeof fsWrapper.setRequestToken === "function") {
          fsWrapper.setRequestToken(ctx.proxyToken);
          this.logDebug("Injected proxy token into FSAdapter", {}, ctx);
        }
      }

      return this.handleWithContext(req, ctx, slug, requestId, url);
    } catch (error) {
      // Unexpected error in context setup - log and continue to 404
      this.logDebug("Unexpected error in context setup", {
        error: this.getErrorMessage(error),
      }, ctx);
      return this.continue();
    }
  }

  private async handleWithContext(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      const renderer = await timeAsync("renderer-init", () => {
        if (!this.rendererInit) {
          this.rendererInit = createRenderer({
            projectDir: ctx.projectDir,
            mode: ctx.mode,
            adapter: ctx.adapter,
            moduleServerUrl: ctx.moduleServerUrl,
            config: ctx.config,
          });
        }
        return this.rendererInit;
      });
      this.logDebug("renderer obtained", { mode: ctx.mode }, ctx);

      // Extract route parameters for both App Router and Pages Router
      let params: Record<string, string | string[]> | null | undefined;
      try {
        const { extractAppRouteParams, extractPagesRouteParams } = await import(
          "../../../../rendering/router-detection.ts"
        );

        // Try App Router params first
        let extractedParams: Record<string, string | string[]> | null = await timeAsync(
          "extract-app-route-params",
          () => extractAppRouteParams(ctx.projectDir, slug, ctx.adapter),
        );

        // If no App Router params, try Pages Router
        if (!extractedParams && typeof extractPagesRouteParams === "function") {
          extractedParams = await timeAsync(
            "extract-pages-route-params",
            () => extractPagesRouteParams(ctx.projectDir, slug, ctx.adapter),
          );
        }

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

      const studioEmbed = url.searchParams.get("studio_embed") === "true";
      const projectId = ctx.projectSlug || url.searchParams.get("project_id") || undefined;
      const pageId = url.searchParams.get("page_id") || undefined;

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
        }));
      this.logDebug("SSR successful", { slug, params }, ctx);
      endRequest(requestId);

      // TRUE STREAMING: If we have a stream but no buffered HTML, this is true streaming mode
      // Skip ETag/304 checks since we don't have the content to hash
      const isTrueStreaming = result.stream && !result.html;

      // Disable caching in development to prevent nonce mismatches
      // (cached HTML has old nonces, but each request generates a fresh nonce for CSP)
      const cacheStrategy = ctx.mode === "development" ? "no-cache" : "short";
      const isHeadRequest = req.method.toUpperCase() === "HEAD";
      const builder = this.createResponseBuilder(ctx, nonce);

      // For true streaming, skip ETag and return stream immediately for fast TTFB
      if (isTrueStreaming) {
        this.logDebug("True streaming SSR - returning stream immediately", { slug }, ctx);

        const response = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
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
      const isDev = ctx.mode === "development";
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
        const body = isHeadRequest
          ? null
          : `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>404 Not Found</title></head><body><h1>404 Not Found</h1><p>The requested path ${
            slug || "/"
          } could not be located.</p></body></html>`;

        const response = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withCache("no-cache")
          .withContentType(getContentType(".html"), body, HTTP_NOT_FOUND);

        return this.respond(response);
      }

      this.logDebug("SSR renderPage failed with error", {
        slug,
        error: this.getErrorMessage(error),
      }, ctx);

      // Generate nonce for error response HTML
      const errorNonce = generateNonce();
      const builder = this.createResponseBuilder(ctx, errorNonce);
      const isHead = req.method.toUpperCase() === "HEAD";
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // In development mode, show error overlay with full stack trace
      if (!isHead && ctx.mode === "development") {
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
      const body = isHead
        ? null
        : `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Internal Server Error</title></head><body><h1>500 Internal Server Error</h1><p>Unexpected error rendering this page.</p></body></html>`;

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR);

      return this.respond(response);
    }
  }
}
