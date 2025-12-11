
import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { getApiHandler } from "./pages-api-handler.ts";
import { PRIORITY_MEDIUM_API } from "@veryfront/core/constants/index.ts";

export class ApiHandlerWrapper extends BaseHandler {
  private projectDir: string;
  private adapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter;
  private initPromise: Promise<void> | null = null;

  metadata: HandlerMetadata = {
    name: "ApiHandlerWrapper",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    // - Pages API routes (/api
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await getApiHandler({
          projectDir: this.projectDir,
          adapter: this.adapter,
        } as HandlerContext);
      })();
    }
    await this.initPromise;
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    try {
      const api = await getApiHandler(ctx);
      const apiRes = await api.handle(req);

      if (apiRes) {
        const builder = this.createResponseBuilder(ctx);
        const finalRes = builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
          .withHeaders(apiRes.headers)
          .build(apiRes.body, apiRes.status);
        return this.respond(finalRes);
      }
    } catch (error) {
      this.logDebug(
        "API handler error",
        {
          error: this.getErrorMessage(error),
        },
        ctx,
      );
    }

    return this.continue();
  }
}
