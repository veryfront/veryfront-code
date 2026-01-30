import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { handleModuleServer } from "./module-server-handler.ts";
import { handlePageModule } from "./page-module-handler.ts";
import { handleDataEndpoint } from "./data-endpoint-handler.ts";
import { handlePageDataEndpoint } from "./page-data-endpoint-handler.ts";
import { handleVirtualModule } from "./virtual-module-handler.ts";
import { handleBatchModuleEndpoint } from "./batch-module-handler.ts";
import { PRIORITY_MEDIUM } from "#veryfront/utils/constants/index.ts";

export class ModuleHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ModuleHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority,
    patterns: [
      { pattern: "/_vf_modules/", prefix: true },
      { pattern: "/_veryfront/modules/", prefix: true },
      { pattern: "/_veryfront/pages/", prefix: true },
      { pattern: "/_veryfront/data/", prefix: true },
      { pattern: "/_veryfront/page-data/", prefix: true },
    ],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const pathname = new URL(req.url).pathname;
    const { createResponseBuilder, respond, logDebug, getErrorMessage } = this.helpers;

    const proxyOptions = { requireToken: true };

    if (pathname === "/_vf_modules/_batch") {
      return this.withProxyContext(
        ctx,
        () => handleBatchModuleEndpoint(req, ctx, createResponseBuilder, respond),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_vf_modules/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handleModuleServer(
            req,
            ctx,
            createResponseBuilder,
            respond,
            logDebug,
            getErrorMessage,
          ),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/modules/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handleVirtualModule(
            req,
            ctx,
            createResponseBuilder,
            respond,
            getErrorMessage,
          ),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/pages/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handlePageModule(
            req,
            pathname,
            ctx,
            createResponseBuilder,
            respond,
            getErrorMessage,
          ),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/data/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handleDataEndpoint(
            req,
            pathname,
            ctx,
            createResponseBuilder,
            respond,
            getErrorMessage,
          ),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/page-data/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handlePageDataEndpoint(
            req,
            pathname,
            ctx,
            createResponseBuilder,
            respond,
            getErrorMessage,
          ),
        proxyOptions,
      );
    }

    return Promise.resolve(this.continue());
  }
}
