import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { VeryfrontError } from "#veryfront/errors";
import { getSafeErrorName } from "../../../utils/error-name.ts";

function isDataNotFound(error: unknown): boolean {
  try {
    return error instanceof VeryfrontError && error.status === 404;
  } catch {
    return false;
  }
}

export function handleDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
): Promise<HandlerResult> {
  return withSpan(
    "module.data.handle",
    async () => {
      try {
        const rawSlug = pathname.replace("/_veryfront/data/", "").replace(/\.json$/, "");
        const encSlug = rawSlug === "index" ? "" : rawSlug;
        const renderer = await getRendererForProject(ctx);
        const result = await renderer.renderPage(encSlug);

        const data = {
          slug: encSlug,
          frontmatter: result.frontmatter,
          headings: result.headings,
          html: result.html,
        };

        const body = JSON.stringify(data);
        const etag = await computeEtag(body);

        const builder = createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

        if (hasMatchingEtag(req, etag)) {
          return respond(builder.notModified(etag));
        }

        return respond(
          builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache("no-cache")
            .withETag(etag)
            .json(data, 200),
        );
      } catch (e) {
        const isNotFound = isDataNotFound(e);
        const status = isNotFound ? 404 : 500;

        serverLogger.error("[data-endpoint] Failed to resolve data", {
          errorName: getSafeErrorName(e),
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
    { "http.method": req.method },
  );
}
