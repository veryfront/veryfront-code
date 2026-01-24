import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function handlePageModule(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  return withSpan(
    "module.page.handle",
    async () => {
      try {
        const slugPath = pathname
          .replace("/_veryfront/pages/", "")
          .replace(/\.js$/, "")
          .replace(/\/$/, "");
        const slug = slugPath || "index";

        const renderer = await getRendererForProject(ctx);
        const moduleResult = await renderer.renderPage(slug, {
          params: undefined,
          props: undefined,
        });

        const code = moduleResult.pageModule?.code;
        if (!code) {
          return respond(
            ResponseBuilder.error(404, "Module not found", req, {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
            }),
          );
        }

        const etag = computeEtag(code);
        const builder = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined);

        if (hasMatchingEtag(req, etag)) {
          return respond(builder.notModified(etag));
        }

        return respond(
          builder
            .withCache(
              shouldUseNoCacheHeadersFromHandler(ctx) ? "no-cache" : "short",
            )
            .withETag(etag)
            .javascript(code, 200),
        );
      } catch (error) {
        return respond(
          ResponseBuilder.error(
            500,
            `Failed to generate module: ${getErrorMessage(error)}`,
            req,
            {
              securityConfig: ctx.securityConfig,
              corsConfig: ctx.securityConfig?.cors,
            },
          ),
        );
      }
    },
    {
      "module.page.pathname": pathname,
      "module.page.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}
