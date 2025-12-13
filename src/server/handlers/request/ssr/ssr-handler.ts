
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
import { getRenderer } from "./renderer-manager.ts";
import { computeSSRETag } from "./etag-handler.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_LOW,
} from "@veryfront/core/constants/index.ts";
import { generateNonce } from "@veryfront/security/http/response/security-handler.ts";

export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW as HandlerPriority,
    patterns: [
      { pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] },
    ],
  };

  private rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null = null;

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/_veryfront/") || pathname.includes(".")) {
      return this.continue();
    }

    const slug = pathname === "/" ? "" : pathname.replace(/^\
    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    try {
      if (!this.rendererInit) {
        this.rendererInit = getRenderer(null, ctx).then(renderer => renderer);
      }
      const renderer = await this.rendererInit;
      this.logDebug("renderer obtained", { mode: ctx.mode }, ctx);

      let params: Record<string, string | string[]> | null | undefined;
      try {
        const { extractAppRouteParams, extractPagesRouteParams } = await import(
          "../../../../rendering/router-detection.ts"
        );

        let extractedParams: Record<string, string | string[]> | null = await extractAppRouteParams(
          ctx.projectDir,
          slug,
          ctx.adapter,
        );

        if (!extractedParams && typeof extractPagesRouteParams === "function") {
          extractedParams = await extractPagesRouteParams(
            ctx.projectDir,
            slug,
            ctx.adapter,
          );
        }

        if (extractedParams) {
          params = extractedParams;
          this.logDebug("Extracted route params", { slug, params }, ctx);
        }
      } catch (paramError) {
        this.logDebug("Failed to extract params", {
          slug,
          error: this.getErrorMessage(paramError),
        }, ctx);
      }

      const nonce = generateNonce();
      this.logDebug(`[NONCE-TRACE] Generated nonce for SSR: ${nonce}`, { slug }, ctx);

      const result = await renderer.renderPage(slug, {
        delivery: "stream",
        params: params ?? undefined,
        request: req,
        url,
        nonce,
      });
      this.logDebug("SSR successful", { slug, params }, ctx);

      const etag = computeSSRETag(result.ssrHash, result.html);
      const cacheStrategy = ctx.mode === "development" ? "no-cache" : "short";
      const isHeadRequest = req.method.toUpperCase() === "HEAD";

      const isDev = ctx.mode === "development";
      if (!isDev && hasMatchingEtag(req, etag)) {
        const builder = this.createResponseBuilder(ctx, nonce);
        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withCache(cacheStrategy)
            .notModified(etag),
        );
      }

      const builder = this.createResponseBuilder(ctx, nonce);
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
        console.log("[SSR-HANDLER] Returning 404 for FILE_NOT_FOUND:", {
          slug,
          error: this.getErrorMessage(error),
        });
        this.logDebug("SSR renderPage not found", {
          slug,
          error: this.getErrorMessage(error),
        }, ctx);

        const notFoundNonce = generateNonce();
        const builder = this.createResponseBuilder(ctx, notFoundNonce);
        const notFoundResponse = await tryNotFoundFallback(req, slug, ctx, builder);
        if (notFoundResponse) {
          return this.respond(notFoundResponse);
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

      console.error("[SSR-HANDLER] 500 Error:", {
        slug,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.logDebug("SSR renderPage failed with error", {
        slug,
        error: this.getErrorMessage(error),
      }, ctx);

      const errorNonce = generateNonce();
      const builder = this.createResponseBuilder(ctx, errorNonce);
      const isHead = req.method.toUpperCase() === "HEAD";

      let body: string | null;
      if (isHead) {
        body = null;
      } else if (ctx.mode === "development") {
        const { ErrorOverlay } = await import(
          "../../../dev-server/error-overlay/index.ts"
        );
        const errorObj = error instanceof Error ? error : new Error(String(error));
        body = ErrorOverlay.createHTML({
          error: errorObj,
          type: "runtime",
        });
      } else {
        body =
          `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Internal Server Error</title></head><body><h1>500 Internal Server Error</h1><p>Unexpected error rendering this page.</p></body></html>`;
      }

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR);

      return this.respond(response);
    }
  }
}
