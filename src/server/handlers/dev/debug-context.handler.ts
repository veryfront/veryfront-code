/**
 * Debug Context Handler
 *
 * Shows bounded runtime diagnostics for authorized local development requests.
 *
 * Endpoint: /_vf_debug/context
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  PRIORITY_HIGH_DEV,
} from "#veryfront/utils/constants/index.ts";
import { getSSRModuleCacheStats } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { isAuthorizedDevControlRequest } from "./access-policy.ts";

function hasSameBrowserOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

function toSafeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export class DebugContextHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DebugContextHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_debug/context", exact: true }],
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }
    if (!isAuthorizedDevControlRequest(req, ctx) || !hasSameBrowserOrigin(req)) {
      return Promise.resolve(
        this.respond(
          this.createPrivateResponseBuilder(ctx).text("Unauthorized", HTTP_UNAUTHORIZED),
        ),
      );
    }

    if (req.method.toUpperCase() !== "GET") {
      return Promise.resolve(
        this.respond(
          this.createPrivateResponseBuilder(ctx)
            .withAllow("GET")
            .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED),
        ),
      );
    }

    const debugInfo = {
      runtime: {
        adapterAvailable: Boolean(ctx.adapter),
        localProject: ctx.isLocalProject === true,
        multiProjectMode: this.checkMultiProjectMode(ctx),
        requestContextAvailable: Boolean(ctx.requestContext),
      },
      caches: this.getSafeCacheStats(),
    };

    const response = this.createPrivateResponseBuilder(ctx).json(debugInfo, HTTP_OK);
    return Promise.resolve(this.respond(response));
  }

  private createPrivateResponseBuilder(ctx: HandlerContext) {
    return this.createResponseBuilder(ctx)
      .withCache("no-store")
      .withHeaders({ "X-Content-Type-Options": "nosniff" });
  }

  private checkMultiProjectMode(ctx: HandlerContext): boolean {
    try {
      const fs = ctx.adapter?.fs as { isMultiProjectMode?: () => boolean } | undefined;
      return fs?.isMultiProjectMode?.() === true;
    } catch (_) {
      /* expected: adapter may not support multi-project mode */
      return false;
    }
  }

  private getSafeCacheStats(): {
    distributed: boolean;
    moduleEntries: number;
    moduleLimit: number;
    temporaryDirectories: number;
  } {
    try {
      const stats = getSSRModuleCacheStats();
      return {
        distributed: stats.distributedCacheEnabled === true,
        moduleEntries: toSafeCount(stats.memoryEntries),
        moduleLimit: toSafeCount(stats.maxEntries),
        temporaryDirectories: toSafeCount(stats.tmpDirs),
      };
    } catch {
      return {
        distributed: false,
        moduleEntries: 0,
        moduleLimit: 0,
        temporaryDirectories: 0,
      };
    }
  }
}
