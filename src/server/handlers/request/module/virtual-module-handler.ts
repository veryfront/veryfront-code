/**
 * Virtual Module Handler
 *
 * Handles requests to the virtual module endpoint (/_veryfront/modules/).
 * Serves virtual modules registered in the VirtualModuleSystem.
 *
 * @module server/handlers/request/module/virtual-module-handler
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import type { createRenderer } from "@veryfront/rendering/index.ts";

/**
 * Handles virtual module requests.
 * Uses the renderer's VirtualModuleSystem to serve registered modules.
 *
 * @param req - Incoming HTTP request
 * @param ctx - Handler context with project configuration
 * @param rendererInit - Promise that resolves to renderer instance
 * @param createResponseBuilder - Factory function to create response builder
 * @param respond - Function to wrap response in handler result
 * @param getErrorMessage - Error message extraction function
 * @returns Promise resolving to handler result
 *
 * @example
 * ```ts
 * const result = await handleVirtualModule(
 *   req,
 *   ctx,
 *   rendererInit,
 *   this.createResponseBuilder.bind(this),
 *   this.respond.bind(this),
 *   this.getErrorMessage.bind(this)
 * );
 * ```
 */
export async function handleVirtualModule(
  req: Request,
  ctx: HandlerContext,
  rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>>,
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
