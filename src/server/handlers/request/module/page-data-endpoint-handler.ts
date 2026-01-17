/**
 * Page Data Endpoint Handler
 * Handles requests for SPA page data at /_veryfront/page-data/{slug}.json.
 * Returns structured JSON for client-side rendering without pre-rendered HTML.
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";

/**
 * Handles SPA page data endpoint requests.
 * Returns JSON with page path, layouts, providers, props, and params.
 */
export async function handlePageDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  try {
    // Extract slug from pathname: /_veryfront/page-data/about.json -> about
    const slug = pathname
      .replace("/_veryfront/page-data/", "")
      .replace(/\.json$/, "") ||
      "";

    const url = new URL(req.url);
    const renderer = await getRendererForProject(ctx);

    // Use resolvePageData instead of renderPage to get structured data
    const pageData = await renderer.resolvePageData(slug, {
      request: req,
      url,
    });

    const body = JSON.stringify(pageData);

    // ETag support for caching
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
        .withCache({ maxAge: 60, public: true })
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
