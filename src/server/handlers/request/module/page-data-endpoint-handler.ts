/**
 * Page Data Endpoint Handler
 * Handles requests for SPA page data at /_veryfront/page-data/{slug}.json.
 * Returns structured JSON for client-side rendering without pre-rendered HTML.
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

/** Timeout for entire page-data resolution (25s, leaves buffer before 30s request timeout) */
const PAGE_DATA_TIMEOUT_MS = 25000;

/**
 * Handles SPA page data endpoint requests.
 * Returns JSON with page path, layouts, providers, props, and params.
 */
export function handlePageDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan("module.pageData.handle", async () => {
    try {
      // Extract slug from pathname: /_veryfront/page-data/about.json -> about
      const slug = pathname
        .replace("/_veryfront/page-data/", "")
        .replace(/\.json$/, "") ||
        "";

      const url = new URL(req.url);
      const renderer = await getRendererForProject(ctx);

      // Use resolvePageData instead of renderPage to get structured data
      // Wrap with timeout to prevent hanging on slow module loads or data fetches
      const pageData = await withTimeoutThrow(
        renderer.resolvePageData(slug, {
          request: req,
          url,
        }),
        PAGE_DATA_TIMEOUT_MS,
        `resolvePageData for ${slug}`,
      );

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
      // Handle timeout errors with 504 Gateway Timeout
      if (e instanceof TimeoutError) {
        return respond(
          ResponseBuilder.json(
            { error: `Page data request timed out: ${e.message}`, status: 504 },
            req,
            {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
              status: 504,
            },
          ),
        );
      }

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
  }, {
    "module.pageData.pathname": pathname,
    "module.pageData.projectSlug": ctx.projectSlug || "unknown",
  });
}
