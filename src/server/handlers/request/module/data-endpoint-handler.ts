/**
 * Data Endpoint Handler
 *
 * Handles requests for data JSON endpoints (/_veryfront/data/).
 * Serves page data for client-side router prefetch.
 *
 * @module server/handlers/request/module/data-endpoint-handler
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { getRenderer } from "../../../shared/renderer-factory.ts";
import type { createRenderer } from "@veryfront/rendering";

/**
 * Handles data endpoint requests for client-side prefetch.
 * Returns JSON data containing frontmatter, headings, and HTML.
 *
 * @param req - Incoming HTTP request
 * @param pathname - Request pathname
 * @param ctx - Handler context with project configuration
 * @param rendererInit - Optional cached renderer promise
 * @param createResponseBuilder - Factory function to create response builder
 * @param respond - Function to wrap response in handler result
 * @param getErrorMessage - Error message extraction function
 * @returns Promise resolving to handler result
 *
 * @example
 * ```ts
 * const result = await handleDataEndpoint(
 *   req,
 *   pathname,
 *   ctx,
 *   this.rendererInit,
 *   this.createResponseBuilder.bind(this),
 *   this.respond.bind(this),
 *   this.getErrorMessage.bind(this)
 * );
 * ```
 */
export async function handleDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null | undefined,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  try {
    const encSlug = pathname.replace("/_veryfront/data/", "").replace(/\.json$/, "");
    const renderer = await getRenderer(ctx, rendererInit);
    const result = await renderer.renderPage(encSlug || "");

    const body = JSON.stringify({
      slug: encSlug,
      frontmatter: result.frontmatter,
      headings: result.headings,
      html: result.html,
    });

    const etag = computeEtag(body);
    if (hasMatchingEtag(req, etag)) {
      const builder = createResponseBuilder(ctx);
      return respond(
        builder
          .withCORS(req, ctx.securityConfig?.cors)
          .notModified(etag),
      );
    }

    const builder = createResponseBuilder(ctx);
    return respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .withETag(etag)
        .json(JSON.parse(body), 200),
    );
  } catch (e) {
    // Determine appropriate status code based on error type
    const errorMessage = getErrorMessage(e);
    const isNotFound = errorMessage.toLowerCase().includes("not found") ||
                       errorMessage.toLowerCase().includes("404") ||
                       (e instanceof Error && e.message.toLowerCase().includes("no page"));
    const status = isNotFound ? 404 : 500;

    return respond(
      ResponseBuilder.json(
        { error: errorMessage, status },
        req,
        {
          securityConfig: ctx.securityConfig,
          corsConfig: ctx.securityConfig?.cors,
          status,
        },
      ),
    );
  }
}
