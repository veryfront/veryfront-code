/**
 * Virtual Module Handler
 * Handles requests to the virtual module endpoint (/_veryfront/modules/).
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import type { AnyRendererPromise } from "../../../shared/renderer/types.ts";

/**
 * Handles virtual module requests using the renderer's VirtualModuleSystem.
 */
export async function handleVirtualModule(
  req: Request,
  ctx: HandlerContext,
  rendererInit: AnyRendererPromise,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  try {
    const renderer = await rendererInit;
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
}
