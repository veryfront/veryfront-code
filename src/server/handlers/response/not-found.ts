import { BaseHandler } from "./base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  PRIORITY_FALLBACK,
} from "#veryfront/utils/constants/index.ts";
import { ErrorPages } from "#veryfront/server/utils/error-html.ts";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";

export class NotFoundHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "NotFoundHandler",
    priority: PRIORITY_FALLBACK as HandlerPriority,
    patterns: [],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const pathname = new URL(req.url).pathname;

    try {
      const builder = this.createResponseBuilder(ctx);
      // Render the SAME 404 page as the SSR miss path (ssr.handler /
      // ssr.service) so every not-found — including a fallthrough like
      // /_veryfront/<missing> that never reaches SSR — looks identical.
      // Nonce the inline <style>/<script> exactly like the SSR response builder
      // (ssr-response-builder addNonceToHtmlTags) so the page still renders
      // styled under a strict nonce-based CSP.
      const html = addNonceToHtmlTags(ErrorPages.notFound(pathname), builder.nonce);
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-cache")
        .html(html, HTTP_NOT_FOUND);

      return Promise.resolve(this.respond(response));
    } catch (e) {
      this.logDebug("404 fallback error", { error: this.getErrorMessage(e) }, ctx);

      const response = ResponseBuilder.error(
        HTTP_INTERNAL_SERVER_ERROR,
        "Internal Server Error",
        req,
        {
          securityConfig: ctx.securityConfig,
          corsConfig: ctx.securityConfig?.cors,
        },
      );

      return Promise.resolve(this.respond(response));
    }
  }
}
