import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext, HandlerResult } from "../../types.js";
import { ResponseBuilder } from "../../../../security/index.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";

export function handleModuleServer(
  req: dntShim.Request,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: dntShim.Response) => HandlerResult,
  logDebug: (message: string, data: Record<string, unknown>, ctx: HandlerContext) => void,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  const url = new URL(req.url);

  return withSpan(
    "module.server.handle",
    async () => {
      try {
        const { serveModule } = await import("../../../../modules/server/index.js");
        const moduleResponse = await serveModule(req, {
          projectId: ctx.projectId ?? ctx.projectDir,
          projectDir: ctx.projectDir,
          adapter: ctx.adapter,
          dev: ctx.requestContext?.isLocalDev ?? false,
          projectUUID: ctx.projectId,
          projectSlug: ctx.projectSlug,
          branch: ctx.parsedDomain?.branch ?? null,
          releaseId: ctx.releaseId ?? null,
          allowedImportDirs: ctx.config?.security?.allowedImportDirs,
        });

        const response = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withHeaders(moduleResponse.headers)
          .build(moduleResponse.body, moduleResponse.status);

        return respond(response);
      } catch (error) {
        logDebug(
          "module server error",
          { error: getErrorMessage(error) },
          ctx,
        );

        return respond(
          ResponseBuilder.error(500, "Module Server Error", req, {
            securityConfig: ctx.securityConfig,
            corsConfig: ctx.securityConfig?.cors,
          }),
        );
      }
    },
    { "module.path": url.pathname, "module.projectSlug": ctx.projectSlug || "unknown" },
  );
}
