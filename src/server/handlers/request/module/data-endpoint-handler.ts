/**
 * Data Endpoint Handler
 * Handles requests for data JSON endpoints (/_veryfront/data/).
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { getRenderer } from "../../../shared/renderer-factory.ts";
import type { AnyRendererPromise } from "../../../shared/renderer/types.ts";

/**
 * Handles data endpoint requests for client-side prefetch.
 * Returns JSON data containing frontmatter, headings, and HTML.
 */
export async function handleDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  rendererInit: AnyRendererPromise | null | undefined,
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
