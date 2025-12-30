/**
 * Page Data Endpoint Handler
 *
 * Handles requests for SPA page data at /_veryfront/page-data/{slug}.json.
 * Returns structured JSON data for client-side rendering without pre-rendered HTML.
 * This enables true SPA navigation where layouts persist and only page content changes.
 *
 * @module server/handlers/request/module/page-data-endpoint-handler
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { getRenderer } from "../../../shared/renderer-factory.ts";
import type { createRenderer } from "@veryfront/rendering";

/**
 * Handles SPA page data endpoint requests.
 * Returns JSON containing page path, layouts, providers, props, and params
 * for client-side dynamic import and rendering.
 *
 * @param req - Incoming HTTP request
 * @param pathname - Request pathname
 * @param ctx - Handler context with project configuration
 * @param rendererInit - Optional cached renderer promise
 * @param createResponseBuilder - Factory function to create response builder
 * @param respond - Function to wrap response in handler result
 * @param getErrorMessage - Error message extraction function
 * @returns Promise resolving to handler result
 */
export async function handlePageDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null | undefined,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  try {
    // Extract slug from pathname: /_veryfront/page-data/about.json -> about
    const slug = pathname
      .replace("/_veryfront/page-data/", "")
      .replace(/\.json$/, "")
      || "";

    const url = new URL(req.url);
    const renderer = await getRenderer(ctx, rendererInit);

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
        .withCache("no-cache")
        .withETag(etag)
        .json(JSON.parse(body), 200),
    );
  } catch (e) {
    return respond(
      ResponseBuilder.json(
        { error: getErrorMessage(e) },
        req,
        {
          securityConfig: ctx.securityConfig,
          corsConfig: ctx.securityConfig?.cors,
          status: 404,
        },
      ),
    );
  }
}
