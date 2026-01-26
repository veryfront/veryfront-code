import { handleModuleBatch } from "../../../../modules/server/module-batch-handler.js";
import { serverLogger as logger } from "../../../../utils/index.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";
export function handleBatchModuleEndpoint(req, ctx, _createResponseBuilder, respond) {
    return withSpan("module.batch.handle", async () => {
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
            dev: ctx.requestContext?.isLocalDev ?? false,
            allowedImportDirs: ctx.config?.security?.allowedImportDirs,
        });
        return respond(response);
    }, { "module.batch.projectSlug": ctx.projectSlug || "unknown" });
}
