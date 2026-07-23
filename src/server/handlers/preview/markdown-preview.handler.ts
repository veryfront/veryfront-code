/** Serve standalone markdown previews in local and preview environments. */

import { validatePathSync } from "#veryfront/security";
import { serverLogger } from "#veryfront/utils";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNAVAILABLE,
} from "#veryfront/utils/constants/index.ts";
import { getSafeErrorName } from "../../utils/error-name.ts";
import { tryNotFoundFallback } from "../request/ssr/not-found-fallback.ts";
import { BaseHandler } from "../response/base.ts";
import { ProjectSourceContextUnavailableError } from "../shared/project-source-context.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { decodeMarkdownPath, isStandaloneMarkdownPath } from "./markdown-preview-request.ts";
import { MarkdownPreviewService } from "./markdown-preview-service.ts";

const logger = serverLogger.component("markdown-preview-handler");
const PRIORITY_MARKDOWN_PREVIEW = 900 as HandlerPriority;

export class MarkdownPreviewHandler extends BaseHandler {
  readonly #service = new MarkdownPreviewService();

  metadata: HandlerMetadata = {
    name: "MarkdownPreviewHandler",
    priority: PRIORITY_MARKDOWN_PREVIEW,
    patterns: [
      { pattern: /\.md$/, method: "GET" },
      { pattern: /\.md$/, method: "HEAD" },
    ],
    enabled: (ctx) => ctx.isLocalProject || ctx.requestContext?.mode === "preview",
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!ctx.isLocalProject && ctx.requestContext?.mode !== "preview") return this.continue();

    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return this.respond(
        this.createPrivateBuilder(req, ctx)
          .withAllow(["GET", "HEAD"])
          .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED),
      );
    }

    const url = new URL(req.url);
    const filePath = decodeMarkdownPath(url.pathname);
    if (filePath === null) return this.respondNotFound(req, ctx, method);
    if (!isStandaloneMarkdownPath(filePath)) return this.continue();

    const pathResult = validatePathSync(filePath, {
      baseDir: ctx.projectDir,
      level: "strict",
      allowAbsolute: false,
    });
    if (!pathResult.valid) {
      logger.warn("Markdown preview path rejected", { reason: pathResult.code ?? "invalid" });
      return this.respondNotFound(req, ctx, method);
    }

    const responseBuilder = this.createResponseBuilder(ctx);
    try {
      const result = await this.#service.render(req, ctx, filePath, url, responseBuilder.nonce);
      if (result.kind === "continue") return this.continue();
      if (result.kind === "missing") return await this.respondMissing(req, ctx, filePath, method);

      responseBuilder
        .withCORS(req, ctx.securityConfig?.cors)
        .withCache("no-cache")
        .withSecurity(ctx.securityConfig ?? undefined, req);
      return this.respond(
        responseBuilder.withContentType(
          "text/html; charset=utf-8",
          method === "HEAD" ? null : result.html,
          HTTP_OK,
        ),
      );
    } catch (error) {
      logger.error("Markdown preview failed", { errorName: getSafeErrorName(error) });
      const status = error instanceof ProjectSourceContextUnavailableError
        ? HTTP_UNAVAILABLE
        : HTTP_INTERNAL_SERVER_ERROR;
      return this.respondUnavailable(req, ctx, method, status);
    }
  }

  private async respondMissing(
    req: Request,
    ctx: HandlerContext,
    filePath: string,
    method: string,
  ): Promise<HandlerResult> {
    if (ctx.isLocalProject) {
      const fallback = await tryNotFoundFallback(
        req,
        filePath,
        ctx,
        this.createResponseBuilder(ctx),
      );
      if (fallback) {
        if (method !== "HEAD") return this.respond(fallback);
        return this.respond(
          new Response(null, {
            status: fallback.status,
            statusText: fallback.statusText,
            headers: fallback.headers,
          }),
        );
      }
    }
    return this.respondNotFound(req, ctx, method);
  }

  private respondNotFound(req: Request, ctx: HandlerContext, method: string): HandlerResult {
    return this.respond(
      this.createPrivateBuilder(req, ctx).withContentType(
        "text/plain; charset=utf-8",
        method === "HEAD" ? null : "Markdown preview not found",
        HTTP_NOT_FOUND,
      ),
    );
  }

  private respondUnavailable(
    req: Request,
    ctx: HandlerContext,
    method: string,
    status: number,
  ): HandlerResult {
    return this.respond(
      this.createPrivateBuilder(req, ctx).withContentType(
        "text/plain; charset=utf-8",
        method === "HEAD" ? null : "Markdown preview unavailable",
        status,
      ),
    );
  }

  private createPrivateBuilder(req: Request, ctx: HandlerContext) {
    return this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-store");
  }
}
