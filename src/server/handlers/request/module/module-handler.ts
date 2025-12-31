/**
 * Module Handler
 *
 * Main handler class for serving ES modules and page module generation.
 * Coordinates between module server, page modules, and data endpoints.
 *
 * @module server/handlers/request/module/module-handler
 */

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
import { handlePageDataEndpoint } from "./page-data-endpoint-handler.ts";
import { handleVirtualModule } from "./virtual-module-handler.ts";
import { PRIORITY_MEDIUM } from "@veryfront/core/constants/index.ts";

/**
 * ModuleHandler class.
 * Handles all module-related requests including:
 * - Module server endpoint (/_vf_modules/)
 * - Virtual modules (/_veryfront/modules/)
 * - Generated page modules (/_veryfront/pages/)
 * - Data JSON endpoints (/_veryfront/data/)
 * - Page data for SPA routing (/_veryfront/page-data/)
 *
 * @example
 * ```ts
 * const handler = new ModuleHandler();
 * const result = await handler.handle(request, context);
 * ```
 */
export class ModuleHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ModuleHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority, // MEDIUM priority
    patterns: [
      { pattern: "/_vf_modules/", prefix: true },
      { pattern: "/_veryfront/modules/", prefix: true },
      { pattern: "/_veryfront/pages/", prefix: true },
      { pattern: "/_veryfront/data/", prefix: true },
      { pattern: "/_veryfront/page-data/", prefix: true },
    ],
  };

  private rendererInit: Promise<Awaited<ReturnType<typeof createRenderer>>> | null = null;

  private ensureRenderer(
    ctx: HandlerContext,
  ): Promise<Awaited<ReturnType<typeof createRenderer>>> {
    // Inject proxy token into FSAdapter before any renderer operations
    // This ensures API calls use the per-request OAuth token from the proxy
    if (ctx.proxyToken) {
      const fsWrapper = ctx.adapter.fs as { setRequestToken?: (t: string) => void };
      if (typeof fsWrapper.setRequestToken === "function") {
        fsWrapper.setRequestToken(ctx.proxyToken);
      }
    }

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

  /**
   * Handles incoming requests by routing to appropriate handler.
   *
   * @param req - Incoming HTTP request
   * @param ctx - Handler context with project configuration
   * @returns Handler result (response or continuation)
   */
  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Use pre-bound helpers to avoid repeated binding on each request
    const { createResponseBuilder, respond, logDebug, getErrorMessage } = this.helpers;

    // Module server endpoint
    if (pathname.startsWith("/_vf_modules/")) {
      return await handleModuleServer(
        req,
        ctx,
        createResponseBuilder,
        respond,
        logDebug,
        getErrorMessage,
      );
    }

    // Virtual modules endpoint
    if (pathname.startsWith("/_veryfront/modules/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handleVirtualModule(
        req,
        ctx,
        rendererInit,
        createResponseBuilder,
        respond,
        getErrorMessage,
      );
    }

    // Generated page modules for client hydration
    if (pathname.startsWith("/_veryfront/pages/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handlePageModule(
        req,
        pathname,
        ctx,
        rendererInit,
        createResponseBuilder,
        respond,
        getErrorMessage,
      );
    }

    // Data JSON endpoint for client router prefetch (legacy HTML-based)
    if (pathname.startsWith("/_veryfront/data/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handleDataEndpoint(
        req,
        pathname,
        ctx,
        rendererInit,
        createResponseBuilder,
        respond,
        getErrorMessage,
      );
    }

    // Page data endpoint for SPA client-side routing
    if (pathname.startsWith("/_veryfront/page-data/")) {
      const rendererInit = this.ensureRenderer(ctx);
      return await handlePageDataEndpoint(
        req,
        pathname,
        ctx,
        rendererInit,
        createResponseBuilder,
        respond,
        getErrorMessage,
      );
    }

    return this.continue();
  }
}
