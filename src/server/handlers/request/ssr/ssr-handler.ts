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
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { ErrorPages } from "../../../utils/error-html.ts";
import { ErrorOverlay } from "../../../dev-server/error-overlay/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getErrorCollector } from "#veryfront/cli/mcp/error-collector.ts";

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

export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW as HandlerPriority,
    patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
  };

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

    try {
      const fsAdapter = ctx.adapter.fs;

      const hasMultiProjectSupport = isExtendedFSAdapter(fsAdapter) &&
        fsAdapter.isMultiProjectMode();

      if (ctx.projectSlug && hasMultiProjectSupport) {
        const prodMode = isProductionMode(ctx, url);
        const branch = ctx.parsedDomain?.branch ?? null;
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
        const handleWithContextStartTime = performance.now();
        _logger.debug("[SSR] handleWithContext START", {
          projectSlug: ctx.projectSlug,
          projectId: ctx.projectId,
          slug,
        });

        const studioEmbed = url.searchParams.get("studio_embed") === "true";

        if (shouldRejectDueToMemory()) {
          const nonce = generateNonce();
          const builder = this.createResponseBuilder(ctx, nonce);
          this.logDebug("Rejecting request due to memory pressure", { slug }, ctx);

          return this.respond(
            builder
              .withCORS(req, ctx.securityConfig?.cors)
              .withCache("no-cache")
              .withContentType(getContentType(".html"), ErrorPages.memoryPressure(), 503),
          );
        }

        try {
          _logger.debug("[SSR] getRendererForProject START", {
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
            slug,
            elapsedInHandler: `${(performance.now() - handleWithContextStartTime).toFixed(2)}ms`,
          });

          const renderer = await timeAsync("renderer-init", () => getRendererForProject(ctx));
          this.logDebug(
            "renderer obtained",
            { isDev: ctx.requestContext?.isLocalDev ?? false, projectSlug: ctx.projectSlug },
            ctx,
          );

          const nonce = generateNonce();
          this.logDebug(`[NONCE-TRACE] Generated nonce for SSR: ${nonce}`, { slug }, ctx);

          const projectId = ctx.projectId || url.searchParams.get("project_id") ||
            ctx.projectSlug || undefined;
          const pageId = url.searchParams.get("page_id") || undefined;

          const { scheme: colorScheme, fromParam: colorSchemeFromParam } =
            getColorSchemeFromRequest(req, url);

          // Check for noHmr query param (used by embedded iframes to disable WebSocket)
          const noHmr = url.searchParams.get("noHmr") === "1" ||
            url.searchParams.get("no_hmr") === "1";

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

          const renderSessionId = `${ctx.projectSlug || "default"}-${
            slug || "index"
          }-${Date.now()}`;
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
              noHmr,
            }));

          _logger.debug("[SSR] renderer.renderPage DONE", {
            projectSlug: ctx.projectSlug,
            slug,
            duration: `${(performance.now() - renderPageStartTime).toFixed(2)}ms`,
            hasHtml: !!result.html,
            hasStream: !!result.stream,
          });

          endRenderSession(renderSessionId);

          this.logDebug("SSR successful", { slug }, ctx);
          endRequest(requestId);

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

          const isTrueStreaming = !!result.stream && !result.html;
          const isHeadRequest = req.method.toUpperCase() === "HEAD";
          const builder = this.createResponseBuilder(ctx, nonce);

          if (isTrueStreaming) {
            this.logDebug("True streaming SSR - returning stream immediately", { slug }, ctx);

            const response = builder
              .withCORS(req, ctx.securityConfig?.cors)
              .withSecurity(ctx.securityConfig ?? undefined)
              .withClientHints()
              .withCache("no-cache")
              .withContentType(getContentType(".html"), result.stream!, HTTP_OK);

            if (isHeadRequest) {
              await response.body?.cancel().catch(() => {/* SILENT: HEAD request body discard */});
              return this.respond(
                new Response(null, { status: response.status, headers: response.headers }),
              );
            }

            return this.respond(response);
          }

          const cacheStrategy = shouldUseNoCacheHeadersFromHandler(ctx) ? "no-cache" : "short";
          const etag = computeSSRETag(result.ssrHash, result.html);

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
            .withClientHints()
            .withCache(cacheStrategy)
            .withETag(etag)
            .withContentType(getContentType(".html"), result.stream || result.html, HTTP_OK);

          if (isHeadRequest) {
            await response.body?.cancel().catch(() => {/* SILENT: HEAD request body discard */});
            return this.respond(
              new Response(null, { status: response.status, headers: response.headers }),
            );
          }

          return this.respond(response);
        } catch (error) {
          if (error instanceof VeryfrontError && error.code === ErrorCode.FILE_NOT_FOUND) {
            this.logDebug(
              "SSR renderPage not found",
              { slug, error: this.getErrorMessage(error) },
              ctx,
            );

            const notFoundNonce = generateNonce();
            const builder = this.createResponseBuilder(ctx, notFoundNonce);

            const notFoundResponse = await tryNotFoundFallback(req, slug, ctx, builder);
            if (notFoundResponse) {
              return this.respond(notFoundResponse);
            }

            const customNotFoundResponse = await tryErrorPageFallback(req, ctx, builder, {
              statusCode: HTTP_NOT_FOUND,
              pathname: slug || "/",
            });
            if (customNotFoundResponse) {
              return this.respond(customNotFoundResponse);
            }

            const isHeadRequest = req.method.toUpperCase() === "HEAD";
            const body = isHeadRequest ? null : ErrorPages.notFound(slug || "/");

            return this.respond(
              builder
                .withCORS(req, ctx.securityConfig?.cors)
                .withSecurity(ctx.securityConfig ?? undefined)
                .withCache("no-cache")
                .withContentType(getContentType(".html"), body, HTTP_NOT_FOUND),
            );
          }

          if (error instanceof VeryfrontAPIError && error.status === 404) {
            const errorDetails = error.details as
              | { url?: string; responseText?: string }
              | undefined;
            const apiUrl = errorDetails?.url || "";

            const isFileListRequest = apiUrl.includes("/files") &&
              !apiUrl.includes("/files/") &&
              (apiUrl.includes("/environments/") || apiUrl.includes("/branches/"));

            if (isFileListRequest) {
              this.logDebug(
                "No content found for project",
                {
                  projectSlug: ctx.projectSlug,
                  apiUrl,
                  error: this.getErrorMessage(error),
                },
                ctx,
              );

              const notDeployedNonce = generateNonce();
              const builder = this.createResponseBuilder(ctx, notDeployedNonce);
              const isHeadRequest = req.method.toUpperCase() === "HEAD";
              const body = isHeadRequest ? null : ErrorPages.undeployed();

              return this.respond(
                builder
                  .withCORS(req, ctx.securityConfig?.cors)
                  .withSecurity(ctx.securityConfig ?? undefined)
                  .withCache("no-cache")
                  .withContentType(getContentType(".html"), body, HTTP_NOT_FOUND),
              );
            }
          }

          _logger.error("[SSR] renderPage failed", {
            slug,
            error: this.getErrorMessage(error),
            stack: error instanceof Error ? error.stack : undefined,
            projectSlug: ctx.projectSlug,
          });
          this.logDebug(
            "SSR renderPage failed with error",
            { slug, error: this.getErrorMessage(error) },
            ctx,
          );

          const errorNonce = generateNonce();
          const builder = this.createResponseBuilder(ctx, errorNonce);
          const isHead = req.method.toUpperCase() === "HEAD";
          const errorObj = error instanceof Error ? error : new Error(String(error));

          if (
            !isHead &&
            (ctx.requestContext?.isLocalDev || ctx.requestContext?.mode === "preview")
          ) {
            // Capture error for MCP flywheel
            getErrorCollector().addRuntimeError(
              errorObj.message,
              errorObj.stack,
              { source: "ssr-handler", url: req.url, slug },
            );
            const body = ErrorOverlay.createHTML({ error: errorObj, type: "runtime" });
            return this.respond(
              builder
                .withCORS(req, ctx.securityConfig?.cors)
                .withSecurity(ctx.securityConfig ?? undefined)
                .withCache("no-cache")
                .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR),
            );
          }

          const customErrorResponse = await tryErrorPageFallback(req, ctx, builder, {
            statusCode: HTTP_INTERNAL_SERVER_ERROR,
            error: errorObj,
            pathname: slug || "/",
          });
          if (customErrorResponse) {
            return this.respond(customErrorResponse);
          }

          const body = isHead ? null : ErrorPages.serverError();

          return this.respond(
            builder
              .withCORS(req, ctx.securityConfig?.cors)
              .withSecurity(ctx.securityConfig ?? undefined)
              .withCache("no-cache")
              .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR),
          );
        }
      },
      { "ssr.slug": slug, "ssr.projectSlug": ctx.projectSlug || "unknown" },
    );
  }
}
