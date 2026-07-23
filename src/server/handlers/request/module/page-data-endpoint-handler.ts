import type { HandlerContext, HandlerResult } from "../../types.ts";
import { hasMatchingEtag } from "../../utils/etag.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { PageDataEndpointCache, readPageDataCacheConfiguration } from "./page-data-cache.ts";
import { createPageDataErrorResponse } from "./page-data-error-response.ts";
import {
  createProjectCodeUnavailableResponse,
  shouldRejectUnisolatedProjectCode,
} from "../../../utils/project-code-isolation.ts";

export { buildPageDataCacheKey } from "./page-data-cache.ts";

const PAGE_DATA_TIMEOUT_MS = 25_000;
const pageDataCache = new PageDataEndpointCache(readPageDataCacheConfiguration());

export function __clearPageDataEndpointCacheForTests(): void {
  pageDataCache.clear();
}

export function handlePageDataEndpoint(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
): Promise<HandlerResult> {
  if (shouldRejectUnisolatedProjectCode(ctx)) {
    return Promise.resolve(respond(createProjectCodeUnavailableResponse(req)));
  }

  return withSpan("module.pageData.handle", async () => {
    try {
      const slug = pathname
        .replace("/_veryfront/page-data/", "")
        .replace(/\.json$/, "") || "";
      const url = new URL(req.url);
      const renderer = await getRendererForProject(ctx);
      const resolution = await pageDataCache.resolve(
        req,
        ctx,
        slug,
        url,
        () =>
          withTimeoutThrow(
            renderer.resolvePageData(slug, { request: req, url }),
            PAGE_DATA_TIMEOUT_MS,
            `resolvePageData for ${slug}`,
          ),
      );
      const builder = createResponseBuilder(ctx).withCORS(
        req,
        ctx.securityConfig?.cors,
      );

      if (hasMatchingEtag(req, resolution.payload.etag)) {
        return respond(builder.notModified(resolution.payload.etag));
      }

      return respond(
        builder
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache(resolution.cacheStrategy)
          .withETag(resolution.payload.etag)
          .withHeaders({ "content-type": "application/json" })
          .build(resolution.payload.body, 200),
      );
    } catch (error) {
      return respond(createPageDataErrorResponse(error, req, ctx));
    }
  });
}
