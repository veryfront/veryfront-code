import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";
import { serverLogger } from "#veryfront/utils";

const PAGE_DATA_TIMEOUT_MS = 25_000;

export function handlePageDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan(
    "module.pageData.handle",
    async () => {
      try {
        const slug = pathname
          .replace("/_veryfront/page-data/", "")
          .replace(/\.json$/, "") || "";

        const url = new URL(req.url);
        const renderer = await getRendererForProject(ctx);

        const pageData = await withTimeoutThrow(
          renderer.resolvePageData(slug, { request: req, url }),
          PAGE_DATA_TIMEOUT_MS,
          `resolvePageData for ${slug}`,
        );

        const body = JSON.stringify(pageData);
        const etag = computeEtag(body);

        const builder = createResponseBuilder(ctx).withCORS(
          req,
          ctx.securityConfig?.cors,
        );

        if (hasMatchingEtag(req, etag)) {
          return respond(builder.notModified(etag));
        }

        return respond(
          builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache({ maxAge: 60, public: true })
            .withETag(etag)
            .json(pageData, 200),
        );
      } catch (e) {
        if (e instanceof TimeoutError) {
          serverLogger.warn("[page-data] Request timed out", {
            pathname,
            detail: e.message,
          });
          return respond(
            ResponseBuilder.json(
              { error: "Page data request timed out", status: HTTP_GATEWAY_TIMEOUT },
              req,
              {
                securityConfig: ctx.securityConfig,
                corsConfig: ctx.securityConfig?.cors,
                status: HTTP_GATEWAY_TIMEOUT,
              },
            ),
          );
        }

        const errorMessage = getErrorMessage(e);
        const lower = errorMessage.toLowerCase();
        const isNotFound = lower.includes("not found") ||
          lower.includes("404") ||
          (e instanceof Error && e.message.toLowerCase().includes("no page"));
        const status = isNotFound ? 404 : 500;

        // Log the full error server-side but return a generic message
        // to avoid leaking internal details (file paths, DB schema, etc.)
        serverLogger.error("[page-data] Failed to resolve page data", {
          pathname,
          error: errorMessage,
          status,
        });

        return respond(
          ResponseBuilder.json(
            { error: isNotFound ? "Page not found" : "Internal server error", status },
            req,
            {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
              status,
            },
          ),
        );
      }
    },
    {
      "module.pageData.pathname": pathname,
      "module.pageData.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}
