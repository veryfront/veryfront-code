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
import { handleBatchModuleEndpoint } from "./batch-module-handler.ts";
import { PRIORITY_MEDIUM } from "#veryfront/utils/constants/index.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  createProjectCodeUnavailableResponse,
  shouldRejectUnisolatedProjectCode,
} from "../../../utils/project-code-isolation.ts";
import {
  createDeprecatedModuleResponse,
  isFrameworkOwnedModulePath,
} from "./module-request-policy.ts";

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
    const { createResponseBuilder, respond, logDebug } = this.helpers;
    const proxyOptions = { requireToken: true };

    if (pathname.startsWith("/_veryfront/modules/")) {
      return Promise.resolve(this.respond(createDeprecatedModuleResponse(req)));
    }

    const hasProjectToken = !!(ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN"));
    const servesFrameworkWithoutProjectContext = ctx.isLocalProject === false &&
      !!ctx.projectSlug && !hasProjectToken && isFrameworkOwnedModulePath(pathname);
    if (
      ctx.isLocalProject === false && ctx.projectSlug && !hasProjectToken &&
      !servesFrameworkWithoutProjectContext
    ) {
      return Promise.resolve(this.respond(createProjectCodeUnavailableResponse(req, 502)));
    }

    const renderWorkload = pathname.startsWith("/_veryfront/pages/") ||
      pathname.startsWith("/_veryfront/data/");
    if (renderWorkload && shouldRejectUnisolatedProjectCode(ctx)) {
      return Promise.resolve(this.respond(createProjectCodeUnavailableResponse(req)));
    }

    if (pathname === "/_vf_modules/_batch") {
      return this.withProxyContext(
        ctx,
        () => handleBatchModuleEndpoint(req, ctx, createResponseBuilder, respond),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_vf_modules/")) {
      const execute = () => handleModuleServer(req, ctx, createResponseBuilder, respond, logDebug);
      if (servesFrameworkWithoutProjectContext) return execute();
      return this.withProxyContext(
        ctx,
        execute,
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/pages/")) {
      return this.withProxyContext(
        ctx,
        () => handlePageModule(req, pathname, ctx, createResponseBuilder, respond),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/data/")) {
      return this.withProxyContext(
        ctx,
        () => handleDataEndpoint(req, pathname, ctx, createResponseBuilder, respond),
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
          ),
        proxyOptions,
      );
    }

    return Promise.resolve(this.continue());
  }
}
