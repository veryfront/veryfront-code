import type { HandlerContext, HandlerResult } from "../../types.ts";
import { isAuthGateEnabled, ResponseBuilder } from "#veryfront/security/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { profilePhase } from "#veryfront/observability";
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
            isProxyMode: ctx.isProxyMode,
            allowSSRModuleMode: ctx.isLocalProject === true,
            allowedImportDirs: ctx.config?.security?.allowedImportDirs,
            config: ctx.config,
            mode: ctx.requestContext?.mode,
            // AuthHandler has already admitted this request, but it runs inside
            // the runtime while shared caches sit in front of it. A gated
            // project's module source must not be marked `public`, or one
            // authorized load seeds a CDN entry served to everyone else.
            authGateEnabled: isAuthGateEnabled(ctx),
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
