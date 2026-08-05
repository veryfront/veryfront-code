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
import { HTTP_METHOD_NOT_ALLOWED, PRIORITY_MEDIUM } from "#veryfront/utils/constants/index.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";

const MODULE_ENDPOINT_PREFIXES = [
  "/_vf_modules/",
  "/_veryfront/modules/",
  "/_veryfront/pages/",
  "/_veryfront/data/",
  "/_veryfront/page-data/",
] as const;

const HOST_RENDERER_ENDPOINT_PREFIXES = [
  "/_veryfront/modules/",
  "/_veryfront/pages/",
  "/_veryfront/data/",
  "/_veryfront/page-data/",
] as const;

export class ModuleHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ModuleHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority,
    patterns: MODULE_ENDPOINT_PREFIXES.map((pattern) => ({
      pattern,
      prefix: true,
    })),
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const pathname = new URL(req.url).pathname;
    const { createResponseBuilder, respond, logDebug, getErrorMessage } = this.helpers;
    const proxyOptions = { requireToken: true };
    const method = req.method.toUpperCase();
    const isOwnedPath = MODULE_ENDPOINT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (
      isOwnedPath &&
      method !== "GET" &&
      method !== "HEAD"
    ) {
      return Promise.resolve(
        respond(
          new Response("Method not allowed", {
            status: HTTP_METHOD_NOT_ALLOWED,
            headers: {
              "Allow": "GET, HEAD",
              "Cache-Control": "no-store",
              "Content-Type": "text/plain; charset=utf-8",
            },
          }),
        ),
      );
    }

    // These endpoints delegate to the legacy renderer, whose module loader
    // imports page and layout code in the host process rather than through a
    // generation-owned prepared module graph.
    //
    // That is a renderer-architecture concern, not a policy one, so it does not
    // decide who may execute tenant code: the host-execution capability does.
    // A host that grants the capability is asserting it is a suitable executor,
    // and this surface honours that like every other. `rsc/endpoints/
    // endpoint-router.ts` already resolved the identical tension the same way.
    if (
      requiresIsolatedProjectRuntime(ctx) &&
      HOST_RENDERER_ENDPOINT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ) {
      const problem = createErrorResponseFromDefinition(
        PROJECT_EXECUTION_UNAVAILABLE,
        {
          detail:
            "Shared runtimes require a dedicated isolated project runtime for module rendering",
          instance: pathname,
        },
      );
      problem.headers.set("Cache-Control", "no-store");
      return Promise.resolve(
        respond(
          method === "HEAD"
            ? new Response(null, {
              status: problem.status,
              statusText: problem.statusText,
              headers: problem.headers,
            })
            : problem,
        ),
      );
    }

    if (pathname === "/_vf_modules/_batch") {
      return this.withProxyContext(
        ctx,
        () => handleBatchModuleEndpoint(req, respond),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_vf_modules/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handleModuleServer(req, ctx, createResponseBuilder, respond, logDebug, getErrorMessage),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/modules/")) {
      return this.withProxyContext(
        ctx,
        () => handleVirtualModule(req, ctx, createResponseBuilder, respond, getErrorMessage),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/pages/")) {
      return this.withProxyContext(
        ctx,
        () => handlePageModule(req, pathname, ctx, createResponseBuilder, respond, getErrorMessage),
        proxyOptions,
      );
    }

    if (pathname.startsWith("/_veryfront/data/")) {
      return this.withProxyContext(
        ctx,
        () =>
          handleDataEndpoint(req, pathname, ctx, createResponseBuilder, respond, getErrorMessage),
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
