import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function handleDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan(
    "module.data.handle",
    async () => {
      try {
        const encSlug = pathname.replace("/_veryfront/data/", "").replace(/\.json$/, "");
        const renderer = await getRendererForProject(ctx);
        const result = await renderer.renderPage(encSlug);

        const data = {
          slug: encSlug,
          frontmatter: result.frontmatter,
          headings: result.headings,
          html: result.html,
        };

        const body = JSON.stringify(data);
        const etag = computeEtag(body);

        const builder = createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

        if (hasMatchingEtag(req, etag)) {
          return respond(builder.notModified(etag));
        }

        return respond(
          builder
            .withSecurity(ctx.securityConfig ?? undefined)
            .withCache("no-cache")
            .withETag(etag)
            .json(data, 200),
        );
      } catch (e) {
        const errorMessage = getErrorMessage(e);
        const lower = errorMessage.toLowerCase();
        const isNotFound = lower.includes("not found") ||
          lower.includes("404") ||
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
    },
    {
      "module.data.pathname": pathname,
      "module.data.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}
