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
} from "@veryfront/core/constants/index.ts";
import {
  checkMemoryPressure,
  forceGC,
  getCacheStats,
  getHeapStats,
  getMemorySnapshot,
} from "../../../core/memory/index.ts";
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
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only handle /_debug/memory paths
    if (!pathname.startsWith("/_debug/memory")) {
      return this.continue();
    }

    try {
      // Route to specific handlers
      if (pathname === "/_debug/memory" || pathname === "/_debug/memory/") {
        return this.handleFullSnapshot(req, ctx);
      }

      if (pathname === "/_debug/memory/heap") {
        return this.handleHeapStats(req, ctx);
      }

      if (pathname === "/_debug/memory/caches") {
        return this.handleCacheStats(req, ctx);
      }

      if (pathname === "/_debug/memory/gc") {
        return this.handleGC(req, ctx);
      }

      if (pathname === "/_debug/memory/pressure") {
        return this.handlePressureCheck(req, ctx);
      }

      // Unknown path
      return this.continue();
    } catch (e) {
      logger.error("[MemoryDebugHandler] Error", { error: e });

      const response = ResponseBuilder.error(
        HTTP_INTERNAL_SERVER_ERROR,
        "Failed to get memory info",
        req,
        {
          securityConfig: ctx.securityConfig ?? undefined,
          corsConfig: ctx.securityConfig?.cors,
        },
      );

      return this.respond(response);
    }
  }

  private handleFullSnapshot(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const snapshot = getMemorySnapshot();

    const response = ResponseBuilder.json(
      snapshot,
      req,
      {
        securityConfig: ctx.securityConfig ?? undefined,
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_OK,
      },
    );

    return Promise.resolve(this.respond(response));
  }

  private handleHeapStats(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const heap = getHeapStats();

    const response = ResponseBuilder.json(
      {
        timestamp: new Date().toISOString(),
        heap,
      },
      req,
      {
        securityConfig: ctx.securityConfig ?? undefined,
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_OK,
      },
    );

    return Promise.resolve(this.respond(response));
  }

  private handleCacheStats(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const caches = getCacheStats();
    const totalEntries = caches.reduce((sum, c) => sum + Math.max(0, c.entries), 0);

    const response = ResponseBuilder.json(
      {
        timestamp: new Date().toISOString(),
        caches,
        totalEntries,
      },
      req,
      {
        securityConfig: ctx.securityConfig ?? undefined,
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_OK,
      },
    );

    return Promise.resolve(this.respond(response));
  }

  private async handleGC(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const beforeHeap = getHeapStats();

    const gcTriggered = await forceGC();

    // Wait a bit for GC to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const afterHeap = getHeapStats();
    const freedMB = beforeHeap.usedHeapSizeMB - afterHeap.usedHeapSizeMB;

    const response = ResponseBuilder.json(
      {
        timestamp: new Date().toISOString(),
        gcTriggered,
        before: beforeHeap,
        after: afterHeap,
        freedMB: Math.round(freedMB * 100) / 100,
      },
      req,
      {
        securityConfig: ctx.securityConfig ?? undefined,
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_OK,
      },
    );

    return this.respond(response);
  }

  private handlePressureCheck(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const pressure = checkMemoryPressure();
    const heap = getHeapStats();

    const response = ResponseBuilder.json(
      {
        timestamp: new Date().toISOString(),
        ...pressure,
        heap,
        recommendations: this.getRecommendations(pressure),
      },
      req,
      {
        securityConfig: ctx.securityConfig ?? undefined,
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_OK,
      },
    );

    return Promise.resolve(this.respond(response));
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
