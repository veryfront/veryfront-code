/**
 * Module Server Handler
 *
 * Handles requests to the module server endpoint (/_vf_modules/).
 * Serves ES modules and handles module transformation.
 *
 * @module server/handlers/request/module/module-server-handler
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";

/**
 * Handles module server requests for ES module serving.
 * Delegates to the module server for transformation and serving.
 *
 * @param req - Incoming HTTP request
 * @param ctx - Handler context with project configuration
 * @param createResponseBuilder - Factory function to create response builder
 * @param respond - Function to wrap response in handler result
 * @param logDebug - Debug logging function
 * @param getErrorMessage - Error message extraction function
 * @returns Promise resolving to handler result
 *
 * @example
 * ```ts
 * const result = await handleModuleServer(
 *   req,
 *   ctx,
 *   this.createResponseBuilder.bind(this),
 *   this.respond.bind(this),
 *   this.logDebug.bind(this),
 *   this.getErrorMessage.bind(this)
 * );
 * ```
 */
export async function handleModuleServer(
  req: Request,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  logDebug: (message: string, data: Record<string, unknown>, ctx: HandlerContext) => void,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  try {
    const { serveModule } = await import("@veryfront/modules/server/index.ts");
    const moduleResponse = await serveModule(req, {
      projectId: ctx.projectDir,
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      dev: ctx.mode === "development",
      projectUUID: ctx.projectId,
    });

    const builder = createResponseBuilder(ctx);
    const response = builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined)
      .withHeaders(moduleResponse.headers)
      .build(moduleResponse.body, moduleResponse.status);

    return respond(response);
  } catch (e) {
    logDebug("module server error", {
      error: getErrorMessage(e),
    }, ctx);

    return respond(
      ResponseBuilder.error(500, "Module Server Error", req, {
        securityConfig: ctx.securityConfig,
        corsConfig: ctx.securityConfig?.cors,
      }),
    );
  }
}
