/**
 * Memory Debug Handler
 *
 * Provides endpoints for memory profiling and debugging:
 * - /_debug/memory - Full memory snapshot
 * - /_debug/memory/heap - Heap stats only
 * - /_debug/memory/caches - Cache stats only
 * - /_debug/memory/gc - Trigger GC and report
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  PRIORITY_HIGH,
} from "@veryfront/utils/constants/index.ts";
import {
  checkMemoryPressure,
  forceGC,
  getCacheStats,
  getHeapStats,
  getMemorySnapshot,
} from "@veryfront/utils/memory/index.ts";
import { rendererLogger as logger } from "@veryfront/utils";

export class MemoryDebugHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MemoryDebugHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [
      { pattern: "/_debug/memory", prefix: true },
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const pathname = new URL(req.url).pathname;

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
          return await this.handleGC(req, ctx);
        case "/_debug/memory/pressure":
          return this.handlePressureCheck(req, ctx);
        default:
          return this.continue();
      }
    } catch (e) {
      logger.error("[MemoryDebugHandler] Error", { error: e });

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

  private jsonResponse(
    data: unknown,
    req: Request,
    ctx: HandlerContext,
  ): HandlerResult {
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
    return this.jsonResponse(
      {
        timestamp: new Date().toISOString(),
        caches,
        totalEntries: caches.reduce((sum, c) => sum + Math.max(0, c.entries), 0),
      },
      req,
      ctx,
    );
  }

  private async handleGC(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const beforeHeap = getHeapStats();
    const gcTriggered = await forceGC();

    // Wait a bit for GC to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const afterHeap = getHeapStats();

    return this.jsonResponse(
      {
        timestamp: new Date().toISOString(),
        gcTriggered,
        before: beforeHeap,
        after: afterHeap,
        freedMB: Math.round((beforeHeap.usedHeapSizeMB - afterHeap.usedHeapSizeMB) * 100) / 100,
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
    const recommendations: string[] = [];

    if (pressure.critical) {
      recommendations.push("CRITICAL: Consider restarting the pod");
      recommendations.push("Clear all caches immediately");
      recommendations.push("Check for memory leaks in recent deployments");
    } else if (pressure.warning) {
      recommendations.push("Monitor memory usage closely");
      recommendations.push("Consider clearing large caches");
      recommendations.push("Review cache TTL settings");
    } else {
      recommendations.push("Memory usage is healthy");
    }

    return recommendations;
  }
}
