/**
 * Static File Handler
 *
 * Thin orchestration layer for static file serving.
 * Delegates business logic to StaticFileService, handles HTTP concerns.
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 *
 * @module server/handlers/request/static-handler
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { hasMatchingEtag } from "../utils/etag.ts";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_STATIC,
} from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { StaticFileService } from "../../services/static/index.ts";

export class StaticHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StaticHandler",
    priority: PRIORITY_MEDIUM_STATIC as HandlerPriority,
    patterns: [
      { pattern: /^\/[^_].*/, method: "GET" },
      { pattern: /^\/[^_].*/, method: "HEAD" },
    ],
  };

  private staticService = new StaticFileService();

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return Promise.resolve(this.continue());

    const pathname = new URL(req.url).pathname;
    if (pathname.startsWith("/_")) return Promise.resolve(this.continue());

    return this.withProxyContext(ctx, async () => {
      const response = await this.tryServeStatic(req, pathname, ctx);
      return response ? this.respond(response) : this.continue();
    });
  }

  private tryServeStatic(
    req: Request,
    pathname: string,
    ctx: HandlerContext,
  ): Promise<Response | null> {
    return withSpan(
      "static.tryServeStatic",
      async () => {
        const method = req.method.toUpperCase();
        const isHead = method === "HEAD";
        const isLocal = !!ctx.isLocalProject;
        const isPreviewMode = ctx.requestContext?.mode === "preview" && !isLocal;

        const result = await this.staticService.resolveFile(pathname, {
          projectDir: ctx.projectDir,
          adapter: ctx.adapter,
          isPreviewMode,
          isLocalProject: isLocal,
        });

        if (!result) {
          if (!this.staticService.isAssetRequest(pathname)) return null;

          return this.createResponseBuilder(ctx)
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache("no-cache")
            .withContentType(
              "text/plain; charset=utf-8",
              isHead ? null : "Not Found",
              HTTP_NOT_FOUND,
            );
        }

        if (hasMatchingEtag(req, result.etag)) {
          return this.createResponseBuilder(ctx)
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .notModified(result.etag);
        }

        const body: BodyInit | null = isHead ? null : result.data.slice();
        const response = this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache(result.cacheStrategy)
          .withETag(result.etag)
          .withContentType(result.contentType, body, HTTP_OK);

        this.logDebug(
          `Served static file: ${result.path}`,
          {
            contentType: result.contentType,
            cacheStrategy: result.cacheStrategy,
            size: result.data.byteLength,
            source: result.source,
          },
          ctx,
        );

        return response;
      },
      { "static.pathname": pathname, "static.projectSlug": ctx.projectSlug || "unknown" },
    );
  }
}
