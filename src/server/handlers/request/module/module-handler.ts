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
import { handleModuleServer } from "./module-server-handler.ts";
import { handlePageModule } from "./page-module-handler.ts";
import { handleDataEndpoint } from "./data-endpoint-handler.ts";
import { handlePageDataEndpoint } from "./page-data-endpoint-handler.ts";
import { handleVirtualModule } from "./virtual-module-handler.ts";
import { handleBatchModuleEndpoint } from "./batch-module-handler.ts";
import { PRIORITY_MEDIUM } from "@veryfront/utils/constants/index.ts";

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

  /**
   * Handles incoming requests by routing to appropriate handler.
   *
   * @param req - Incoming HTTP request
   * @param ctx - Handler context with project configuration
   * @returns Handler result (response or continuation)
   */
  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Use pre-bound helpers to avoid repeated binding on each request
    const { createResponseBuilder, respond, logDebug, getErrorMessage } = this.helpers;

    const proxyOptions = { requireToken: true };

    // Module batch endpoint - coalesce multiple module requests into one
    // Must be checked BEFORE general /_vf_modules/ handler
    if (pathname === "/_vf_modules/_batch") {
      return this.withProxyContext(
        ctx,
        () =>
          handleBatchModuleEndpoint(
            req,
            ctx,
            createResponseBuilder,
            respond,
          ),
        proxyOptions,
      );
    }

    // Module server endpoint (including snippet modules - they need transformation)
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

    // Virtual modules endpoint
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

    // Generated page modules for client hydration
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

    // Data JSON endpoint for client router prefetch (legacy HTML-based)
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

    // Page data endpoint for SPA client-side routing
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
