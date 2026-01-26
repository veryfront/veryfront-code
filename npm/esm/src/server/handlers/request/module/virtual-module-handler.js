import { ResponseBuilder } from "../../../../security/index.js";
import { getRendererForProject } from "../../../shared/renderer-factory.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";
export function handleVirtualModule(req, ctx, createResponseBuilder, respond, getErrorMessage) {
    const url = new URL(req.url);
    return withSpan("module.virtual.handle", async () => {
        try {
            const renderer = await getRendererForProject(ctx);
            const vmResponse = renderer.getVirtualModuleSystem().handleRequest(req);
            if (!vmResponse) {
                return respond(ResponseBuilder.error(404, "Virtual module not found", req, {
                    securityConfig: ctx.securityConfig,
                    corsConfig: ctx.securityConfig?.cors,
                }));
            }
            const response = createResponseBuilder(ctx)
                .withCORS(req, ctx.securityConfig?.cors)
                .withSecurity(ctx.securityConfig ?? undefined)
                .withHeaders(vmResponse.headers)
                .build(vmResponse.body, vmResponse.status);
            return respond(response);
        }
        catch (e) {
            return respond(ResponseBuilder.error(500, `Virtual Module Error: ${getErrorMessage(e)}`, req, {
                securityConfig: ctx.securityConfig,
                corsConfig: ctx.securityConfig?.cors,
            }));
        }
    }, {
        "module.virtual.pathname": url.pathname,
        "module.virtual.projectSlug": ctx.projectSlug || "unknown",
    });
}
