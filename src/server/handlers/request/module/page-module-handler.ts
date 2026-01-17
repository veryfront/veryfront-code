/**
 * Page Module Handler
 * Handles requests for generated page modules (/_veryfront/pages/).
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { computeEtag, hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";

/**
 * Handles page module generation requests.
 * Generates JavaScript modules from markdown pages for client hydration.
 */
export async function handlePageModule(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
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
    if (hasMatchingEtag(req, etag)) {
      const builder = createResponseBuilder(ctx);
      return respond(
        builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .notModified(etag),
      );
    }

    const builder = createResponseBuilder(ctx);
    return respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache(ctx.mode === "development" ? "no-cache" : "short")
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
}
