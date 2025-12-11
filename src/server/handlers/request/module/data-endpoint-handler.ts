
import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { getRenderer } from "./renderer-manager.ts";
import type { createRenderer } from "@veryfront/rendering";

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
