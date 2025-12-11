
import type { HandlerContext, HandlerResult } from "../../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";

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
