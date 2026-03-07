import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  PRIORITY_HIGH,
} from "#veryfront/utils/constants/index.ts";
import {
  checkMemoryPressure,
  forceGC,
  getCacheStats,
  getHeapStats,
  getMemorySnapshot,
} from "#veryfront/utils/memory/index.ts";
import { rendererLogger } from "#veryfront/utils";

const logger = rendererLogger.component("memory-debug-handler");

/** Delay after forcing GC before re-measuring heap, so the runtime can settle */
const GC_SETTLE_DELAY_MS = 200;

export class MemoryDebugHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MemoryDebugHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: "/_debug/memory", prefix: true }],
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const pathname = new URL(req.url).pathname;

    if (!ctx.isLocalProject) {
      return this.continue();
    }

    if (!pathname.startsWith("/_debug/memory")) {
      return this.continue();
    }

    try {
      switch (pathname) {
        case "/_debug/memory":
        case "/_debug/memory/":
          return this.handleFullSnapshot(req, ctx);
        case "/_debug/memory/heap":
          return this.handleHeapStats(req, ctx);
        case "/_debug/memory/caches":
          return this.handleCacheStats(req, ctx);
        case "/_debug/memory/gc":
          return this.handleGC(req, ctx);
        case "/_debug/memory/pressure":
          return this.handlePressureCheck(req, ctx);
        default:
          return this.continue();
      }
    } catch (error) {
      logger.error("Error", { error });

      const response = ResponseBuilder.error(
        HTTP_INTERNAL_SERVER_ERROR,
        "Failed to get memory info",
        req,
        this.getSecurityOptions(ctx),
      );

      return this.respond(response);
    }
  }

  private getSecurityOptions(ctx: HandlerContext): {
    securityConfig: NonNullable<HandlerContext["securityConfig"]> | undefined;
    corsConfig: NonNullable<HandlerContext["securityConfig"]>["cors"] | undefined;
  } {
    return {
      securityConfig: ctx.securityConfig ?? undefined,
      corsConfig: ctx.securityConfig?.cors,
    };
  }

  private jsonResponse(data: unknown, req: Request, ctx: HandlerContext): HandlerResult {
    const response = ResponseBuilder.json(data, req, {
      ...this.getSecurityOptions(ctx),
      status: HTTP_OK,
    });

    return this.respond(response);
  }

  private handleFullSnapshot(req: Request, ctx: HandlerContext): HandlerResult {
    return this.jsonResponse(getMemorySnapshot(), req, ctx);
  }

  private handleHeapStats(req: Request, ctx: HandlerContext): HandlerResult {
    return this.jsonResponse(
      {
        timestamp: new Date().toISOString(),
        heap: getHeapStats(),
      },
      req,
      ctx,
    );
  }

  private handleCacheStats(req: Request, ctx: HandlerContext): HandlerResult {
    const caches = getCacheStats();
    const totalEntries = caches.reduce((sum, c) => sum + Math.max(0, c.entries), 0);

    return this.jsonResponse(
      {
        timestamp: new Date().toISOString(),
        caches,
        totalEntries,
      },
      req,
      ctx,
    );
  }

  private async handleGC(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const beforeHeap = getHeapStats();
    const gcTriggered = await forceGC();

    await new Promise((resolve) => setTimeout(resolve, GC_SETTLE_DELAY_MS)); // no cleanup needed: one-shot

    const afterHeap = getHeapStats();
    const freedMB = Math.round((beforeHeap.usedHeapSizeMB - afterHeap.usedHeapSizeMB) * 100) / 100;

    return this.jsonResponse(
      {
        timestamp: new Date().toISOString(),
        gcTriggered,
        before: beforeHeap,
        after: afterHeap,
        freedMB,
      },
      req,
      ctx,
    );
  }

  private handlePressureCheck(req: Request, ctx: HandlerContext): HandlerResult {
    const pressure = checkMemoryPressure();

    return this.jsonResponse(
      {
        timestamp: new Date().toISOString(),
        ...pressure,
        heap: getHeapStats(),
        recommendations: this.getRecommendations(pressure),
      },
      req,
      ctx,
    );
  }

  private getRecommendations(pressure: { critical: boolean; warning: boolean }): string[] {
    if (pressure.critical) {
      return [
        "CRITICAL: Consider restarting the pod",
        "Clear all caches immediately",
        "Check for memory leaks in recent deployments",
      ];
    }

    if (pressure.warning) {
      return [
        "Monitor memory usage closely",
        "Consider clearing large caches",
        "Review cache TTL settings",
      ];
    }

    return ["Memory usage is healthy"];
  }
}
