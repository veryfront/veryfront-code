/**
 * Debug Context Handler
 *
 * Shows the current request context for debugging token/context propagation issues.
 * Available in all modes - endpoint is internal-only (not publicly routable).
 *
 * Endpoint: /_vf_debug/context
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { getSSRModuleCacheStats } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import type { MultiProjectFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { isLocalDev } from "../../context/request-context.ts";

export class DebugContextHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DebugContextHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_debug/context", exact: true }],
    // Only enable in local development - debug endpoints should not be exposed in production
    enabled: () => isLocalDev(),
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    const token = req.headers.get("x-token");
    const debugInfo = {
      timestamp: new Date().toISOString(),
      request: {
        url: req.url,
        host: new URL(req.url).host,
        headers: {
          "x-project-slug": req.headers.get("x-project-slug"),
          "x-token": token ? `[${token.length} chars]` : null,
          "x-environment": req.headers.get("x-environment"),
          "x-release-id": req.headers.get("x-release-id"),
          "x-project-id": req.headers.get("x-project-id"),
        },
      },
      context: {
        mode: ctx.mode,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        projectDir: ctx.projectDir,
        proxyToken: ctx.proxyToken ? `[${ctx.proxyToken.length} chars]` : null,
        proxyEnvironment: ctx.proxyEnvironment,
        releaseId: ctx.releaseId,
        parsedDomain: ctx.parsedDomain,
      },
      adapter: {
        type: ctx.adapter?.fs?.constructor?.name || "unknown",
        isMultiProjectMode: this.checkMultiProjectMode(ctx),
        managerStats: this.getManagerStats(ctx),
      },
      ssrModuleCache: getSSRModuleCacheStats(),
    };

    const response = this.createResponseBuilder(ctx)
      .withCache("no-cache")
      .json(debugInfo, HTTP_OK);

    return Promise.resolve(this.respond(response));
  }

  private checkMultiProjectMode(ctx: HandlerContext): boolean {
    try {
      const fs = ctx.adapter?.fs as { isMultiProjectMode?: () => boolean };
      return typeof fs?.isMultiProjectMode === "function" && fs.isMultiProjectMode();
    } catch {
      return false;
    }
  }

  private getManagerStats(
    ctx: HandlerContext,
  ): { adapters: number; stats: Record<string, unknown> } | null {
    try {
      const fs = ctx.adapter?.fs as {
        getUnderlyingAdapter?: () => { getManagerStats?: () => unknown };
      };
      if (typeof fs?.getUnderlyingAdapter === "function") {
        const underlying = fs.getUnderlyingAdapter() as MultiProjectFSAdapter;
        if (typeof underlying?.getManagerStats === "function") {
          return underlying.getManagerStats();
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
