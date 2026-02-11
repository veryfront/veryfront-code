import type { HandlerContext, HandlerResult } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { handleModuleBatch } from "#veryfront/modules/server/module-batch-handler.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = serverLogger.component("batch-module-handler");

export function handleBatchModuleEndpoint(
  req: Request,
  ctx: HandlerContext,
  _createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
): Promise<HandlerResult> {
  return withSpan(
    "module.batch.handle",
    async () => {
      logger.debug("Handling batch request", {
        projectSlug: ctx.projectSlug,
        url: req.url,
      });

      const response = await handleModuleBatch(req, {
        projectDir: ctx.projectDir,
        adapter: ctx.adapter,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        branch: ctx.parsedDomain?.branch ?? null,
        dev: !!ctx.isLocalProject,
        allowedImportDirs: ctx.config?.security?.allowedImportDirs,
      });

      return respond(response);
    },
    { "module.batch.projectSlug": ctx.projectSlug ?? "unknown" },
  );
}
