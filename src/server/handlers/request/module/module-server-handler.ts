import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { profilePhase } from "#veryfront/observability";
import { resolveRequestModuleImportMapIdentity } from "./import-map-identity.ts";
import {
  createHandlerDependencyPinningSource,
  getHandlerDependencyPinningIdentity,
} from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

export function handleModuleServer(
  req: Request,
  ctx: HandlerContext,
  createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder,
  respond: (response: Response) => HandlerResult,
  logDebug: (message: string, data: Record<string, unknown>, ctx: HandlerContext) => void,
  getErrorMessage: (error: unknown) => string,
): Promise<HandlerResult> {
  const url = new URL(req.url);

  return withSpan(
    "module.server.handle",
    async () => {
      try {
        const requestConfig = ctx.enriched?.config ?? ctx.config;
        const [reactVersion, importMapIdentity] = await Promise.all([
          profilePhase(
            "module.resolve_react_version",
            () =>
              resolveProjectReactVersion({
                projectDir: ctx.projectDir,
                config: requestConfig,
              }),
          ),
          resolveRequestModuleImportMapIdentity(ctx),
        ]);
        const dependencyIdentity = getHandlerDependencyPinningIdentity(ctx);
        const dependencyPinningSource = createHandlerDependencyPinningSource(ctx);
        const moduleResponse = await profilePhase("module.serve", async () => {
          const { serveModule } = await import("#veryfront/modules/server/index.ts");
          return await serveModule(req, {
            projectId: dependencyIdentity.projectId ?? ctx.projectDir,
            projectDir: ctx.projectDir,
            adapter: ctx.adapter,
            dev: !!ctx.isLocalProject,
            projectUUID: dependencyIdentity.projectId,
            projectSlug: dependencyIdentity.projectSlug,
            branch: dependencyIdentity.branch ?? null,
            releaseId: dependencyIdentity.releaseId ?? null,
            contentSourceId: dependencyIdentity.contentSourceId,
            dependencyPinningSource,
            isLocalProject: ctx.isLocalProject,
            allowedImportDirs: requestConfig?.security?.allowedImportDirs,
            config: requestConfig,
            reactVersion,
            mode: ctx.requestContext?.mode,
            importMapIdentity,
          });
        });

        const response = createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withHeaders(moduleResponse.headers)
          .build(moduleResponse.body, moduleResponse.status);

        return respond(response);
      } catch (error) {
        logDebug("module server error", { error: getErrorMessage(error) }, ctx);

        return respond(
          ResponseBuilder.error(500, "Module Server Error", req, {
            securityConfig: ctx.securityConfig,
            corsConfig: ctx.securityConfig?.cors,
          }),
        );
      }
    },
    {
      "module.path": url.pathname,
      "module.projectSlug": ctx.projectSlug || "unknown",
    },
  );
}
