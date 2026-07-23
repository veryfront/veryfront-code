import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { profilePhase } from "#veryfront/observability";
import { getSafeErrorName } from "../../../utils/error-name.ts";

export function handleModuleServer(
  req: Request,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  logDebug: (message: string, data: Record<string, unknown>, ctx: HandlerContext) => void,
): Promise<HandlerResult> {
  return withSpan(
    "module.server.handle",
    async () => {
      try {
        const reactVersion = await profilePhase(
          "module.resolve_react_version",
          () =>
            resolveProjectReactVersion({
              projectDir: ctx.projectDir,
              config: ctx.config,
            }),
        );

        const moduleResponse = await profilePhase("module.serve", async () => {
          const { serveModule } = await import("#veryfront/modules/server/index.ts");
          return await serveModule(req, {
            projectId: ctx.projectId ?? ctx.projectDir,
            projectDir: ctx.projectDir,
            adapter: ctx.adapter,
            dev: !!ctx.isLocalProject,
            projectUUID: ctx.projectId,
            projectSlug: ctx.projectSlug,
            branch: ctx.parsedDomain?.branch ?? null,
            releaseId: ctx.releaseId ?? null,
            allowedImportDirs: ctx.config?.security?.allowedImportDirs,
            reactVersion,
            mode: ctx.requestContext?.mode,
          });
        });

        const response = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withHeaders(moduleResponse.headers)
          .build(moduleResponse.body, moduleResponse.status);

        return respond(response);
      } catch (error) {
        logDebug("module server error", { errorName: getSafeErrorName(error) }, ctx);

        return respond(
          ResponseBuilder.error(500, "Module Server Error", req, {
            securityConfig: ctx.securityConfig,
            corsConfig: ctx.securityConfig?.cors,
          }),
        );
      }
    },
    { "http.method": req.method },
  );
}
