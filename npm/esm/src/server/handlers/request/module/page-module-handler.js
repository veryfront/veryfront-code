import { computeEtag, hasMatchingEtag } from "../../utils/etag.js";
import { ResponseBuilder } from "../../../../security/index.js";
import { getRendererForProject } from "../../../shared/renderer-factory.js";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";
export function handlePageModule(req, pathname, ctx, createResponseBuilder, respond, getErrorMessage) {
    return withSpan("module.page.handle", async () => {
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
                return respond(ResponseBuilder.error(404, "Module not found", req, {
                    securityConfig: ctx.securityConfig,
                    corsConfig: ctx.securityConfig?.cors,
                }));
            }
            const etag = computeEtag(code);
            const builder = createResponseBuilder(ctx)
                .withCORS(req, ctx.securityConfig?.cors)
                .withSecurity(ctx.securityConfig ?? undefined);
            if (hasMatchingEtag(req, etag)) {
                return respond(builder.notModified(etag));
            }
            return respond(builder
                .withCache(shouldUseNoCacheHeadersFromHandler(ctx) ? "no-cache" : "short")
                .withETag(etag)
                .javascript(code, 200));
        }
        catch (error) {
            return respond(ResponseBuilder.error(500, `Failed to generate module: ${getErrorMessage(error)}`, req, {
                securityConfig: ctx.securityConfig,
                corsConfig: ctx.securityConfig?.cors,
            }));
        }
    }, {
        "module.page.pathname": pathname,
        "module.page.projectSlug": ctx.projectSlug || "unknown",
    });
}
