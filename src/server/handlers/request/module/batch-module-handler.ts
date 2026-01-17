/**
 * Batch Module Handler
 *
 * Handler wrapper for the module batch endpoint.
 * Integrates the batch system into the universal handler framework.
 *
 * @module server/handlers/request/module/batch-module-handler
 */

import type { HandlerContext, HandlerResult } from "../../types.ts";
import type { ResponseBuilder } from "@veryfront/security/index.ts";
import { handleModuleBatch } from "@veryfront/modules/server/module-batch-handler.ts";
import { serverLogger as logger } from "@veryfront/utils";

/**
 * Handle batch module requests at /_vf_modules/_batch.
 *
 * Query params:
 * - paths: Comma-separated module paths
 *
 * @param req - HTTP request
 * @param ctx - Handler context
 * @param createResponseBuilder - Response builder factory
 * @param respond - Response callback
 * @returns Handler result
 */
export async function handleBatchModuleEndpoint(
  req: Request,
  ctx: HandlerContext,
  _createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
): Promise<HandlerResult> {
  logger.debug("[BatchModuleHandler] Handling batch request", {
    projectSlug: ctx.projectSlug,
    url: req.url,
  });

  const response = await handleModuleBatch(req, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    projectSlug: ctx.projectSlug,
    projectId: ctx.projectId,
    branch: ctx.parsedDomain?.branch ?? null,
    dev: ctx.mode === "development",
    // Pass security config for opt-in import restrictions
    allowedImportDirs: ctx.config?.security?.allowedImportDirs,
  });

  return respond(response);
}
