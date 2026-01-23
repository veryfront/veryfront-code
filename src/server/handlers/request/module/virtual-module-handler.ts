/**
 * Virtual Module Handler
 * Handles requests to the virtual module endpoint (/_veryfront/modules/).
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getRendererForProject } from "../../../shared/renderer-factory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

/**
 * Handles virtual module requests using the renderer's VirtualModuleSystem.
 */
export function handleVirtualModule(
  req: Request,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  const url = new URL(req.url);
  return withSpan("module.virtual.handle", async () => {
    try {
      const renderer = await getRendererForProject(ctx);
      const virtualModules = renderer.getVirtualModuleSystem();

      // Use the virtual module system's handleRequest method
      const vmResponse = virtualModules.handleRequest(req);

      if (!vmResponse) {
        // Virtual module not found or not handled
        return respond(
          ResponseBuilder.error(404, "Virtual module not found", req, {
            securityConfig: ctx.securityConfig,
            corsConfig: ctx.securityConfig?.cors,
          }),
        );
      }

      // Add security headers and CORS to the virtual module response
      const builder = createResponseBuilder(ctx);
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withHeaders(vmResponse.headers)
        .build(vmResponse.body, vmResponse.status);

      return respond(response);
    } catch (e) {
      return respond(
        ResponseBuilder.error(500, `Virtual Module Error: ${getErrorMessage(e)}`, req, {
          securityConfig: ctx.securityConfig,
          corsConfig: ctx.securityConfig?.cors,
        }),
      );
    }
  }, {
    "module.virtual.pathname": url.pathname,
    "module.virtual.projectSlug": ctx.projectSlug || "unknown",
  });
}
