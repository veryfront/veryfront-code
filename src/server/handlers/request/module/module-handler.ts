
import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { createRenderer } from "@veryfront/rendering/index.ts";
import { handleModuleServer } from "./module-server-handler.ts";
import { handlePageModule } from "./page-module-handler.ts";
import { handleDataEndpoint } from "./data-endpoint-handler.ts";
import { handleVirtualModule } from "./virtual-module-handler.ts";
import { PRIORITY_MEDIUM } from "@veryfront/core/constants/index.ts";

export class ModuleHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ModuleHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority,
    patterns: [
      { pattern: "/_vf_modules/", prefix: true },
      { pattern: "/_veryfront/modules/", prefix: true },
      { pattern: "/_veryfront/pages/", prefix: true },
      { pattern: "/_veryfront/data/", prefix: true },
    ],
  };

  private rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null = null;

  private ensureRenderer(
    ctx: HandlerContext,
  ): Promise<Awaited<ReturnType<typeof createRenderer>>> {
    if (!this.rendererInit) {
      this.rendererInit = createRenderer({
        projectDir: ctx.projectDir,
        mode: ctx.mode,
        adapter: ctx.adapter,
        moduleServerUrl: ctx.moduleServerUrl,
      });
    }
    return this.rendererInit;
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/_vf_modules/")) {
      return await handleModuleServer(
        req,
        ctx,
        this.createResponseBuilder.bind(this),
        this.respond.bind(this),
        this.logDebug.bind(this),
        this.getErrorMessage.bind(this),
      );
    }

    if (pathname.startsWith("/_veryfront/modules/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handleVirtualModule(
        req,
        ctx,
        rendererInit,
        this.createResponseBuilder.bind(this),
        this.respond.bind(this),
        this.getErrorMessage.bind(this),
      );
    }

    if (pathname.startsWith("/_veryfront/pages/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handlePageModule(
        req,
        pathname,
        ctx,
        rendererInit,
        this.createResponseBuilder.bind(this),
        this.respond.bind(this),
        this.getErrorMessage.bind(this),
      );
    }

    if (pathname.startsWith("/_veryfront/data/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handleDataEndpoint(
        req,
        pathname,
        ctx,
        rendererInit,
        this.createResponseBuilder.bind(this),
        this.respond.bind(this),
        this.getErrorMessage.bind(this),
      );
    }

    return this.continue();
  }
}
