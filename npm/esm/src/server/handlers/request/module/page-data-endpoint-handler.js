import { computeEtag, hasMatchingEtag } from "../../utils/etag.js";
import { ResponseBuilder } from "../../../../security/index.js";
import { getRendererForProject } from "../../../shared/renderer-factory.js";
import { TimeoutError, withTimeoutThrow } from "../../../../rendering/utils/stream-utils.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";
const PAGE_DATA_TIMEOUT_MS = 25000;
export function handlePageDataEndpoint(req, pathname, ctx, createResponseBuilder, respond, getErrorMessage) {
    return withSpan("module.pageData.handle", async () => {
        try {
            const slug = pathname
                .replace("/_veryfront/page-data/", "")
                .replace(/\.json$/, "") || "";
            const url = new URL(req.url);
            const renderer = await getRendererForProject(ctx);
            const pageData = await withTimeoutThrow(renderer.resolvePageData(slug, { request: req, url }), PAGE_DATA_TIMEOUT_MS, `resolvePageData for ${slug}`);
            const body = JSON.stringify(pageData);
            const etag = computeEtag(body);
            const builder = createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);
            if (hasMatchingEtag(req, etag)) {
                return respond(builder.notModified(etag));
            }
            return respond(builder
                .withSecurity(ctx.securityConfig ?? undefined)
                .withCache({ maxAge: 60, public: true })
                .withETag(etag)
                .json(pageData, 200));
        }
        catch (e) {
            if (e instanceof TimeoutError) {
                return respond(ResponseBuilder.json({ error: `Page data request timed out: ${e.message}`, status: 504 }, req, {
                    securityConfig: ctx.securityConfig,
                    corsConfig: ctx.securityConfig?.cors,
                    status: 504,
                }));
            }
            const errorMessage = getErrorMessage(e);
            const lower = errorMessage.toLowerCase();
            const isNotFound = lower.includes("not found") ||
                lower.includes("404") ||
                (e instanceof Error && e.message.toLowerCase().includes("no page"));
            const status = isNotFound ? 404 : 500;
            return respond(ResponseBuilder.json({ error: errorMessage, status }, req, {
                securityConfig: ctx.securityConfig,
                corsConfig: ctx.securityConfig?.cors,
                status,
            }));
        }
    }, {
        "module.pageData.pathname": pathname,
        "module.pageData.projectSlug": ctx.projectSlug || "unknown",
    });
}
