import type { HandlerContext, HandlerResult } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { handleModuleBatch } from "#veryfront/modules/server/module-batch-handler.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { resolveRequestModuleImportMapIdentity } from "./import-map-identity.ts";

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

      const requestConfig = ctx.enriched?.config ?? ctx.config;
      const [reactVersion, importMapIdentity] = await Promise.all([
        resolveProjectReactVersion({
          projectDir: ctx.projectDir,
          config: requestConfig,
        }),
        resolveRequestModuleImportMapIdentity(ctx),
      ]);
      const response = await handleModuleBatch(req, {
        projectDir: ctx.projectDir,
        adapter: ctx.adapter,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        branch: ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null,
        releaseId: ctx.releaseId ?? null,
        dev: !!ctx.isLocalProject,
        allowedImportDirs: requestConfig?.security?.allowedImportDirs,
        reactVersion,
        importMapIdentity,
      });

      return respond(response);
    },
    { "module.batch.projectSlug": ctx.projectSlug ?? "unknown" },
  );
}
