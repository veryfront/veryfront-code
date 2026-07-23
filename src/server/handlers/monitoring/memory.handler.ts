import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  PRIORITY_HIGH,
} from "#veryfront/utils/constants/index.ts";
import { rendererLogger } from "#veryfront/utils";
import { isAuthorizedDevControlRequest } from "../dev/access-policy.ts";
import {
  collectGarbageSnapshot,
  getCacheSnapshot,
  getFullMemorySnapshot,
  getHeapSnapshot,
  getMemoryPressureSnapshot,
} from "./memory-debug-service.ts";

const logger = rendererLogger.component("memory-debug-handler");

const MEMORY_ROOT_PATHS = new Set(["/_debug/memory", "/_debug/memory/"]);
const MEMORY_READ_PATHS = new Set([
  ...MEMORY_ROOT_PATHS,
  "/_debug/memory/heap",
  "/_debug/memory/caches",
  "/_debug/memory/pressure",
]);
const MEMORY_GC_PATH = "/_debug/memory/gc";

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

    if (!MEMORY_READ_PATHS.has(pathname) && pathname !== MEMORY_GC_PATH) {
      return this.continue();
    }

    if (!isAuthorizedDevControlRequest(req, ctx)) {
      const response = this.createPrivateResponseBuilder(req, ctx).text(
        "Unauthorized",
        HTTP_UNAUTHORIZED,
      );
      return this.respond(response);
    }

    const allowedMethod = pathname === MEMORY_GC_PATH ? "POST" : "GET";
    if (req.method !== allowedMethod) {
      const response = this.createPrivateResponseBuilder(req, ctx)
        .withAllow(allowedMethod)
        .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED);
      return this.respond(response);
    }

    try {
      switch (pathname) {
        case "/_debug/memory":
        case "/_debug/memory/":
          return this.jsonResponse(getFullMemorySnapshot(), req, ctx);
        case "/_debug/memory/heap":
          return this.jsonResponse(getHeapSnapshot(), req, ctx);
        case "/_debug/memory/caches":
          return this.jsonResponse(getCacheSnapshot(), req, ctx);
        case "/_debug/memory/gc":
          return this.jsonResponse(
            await collectGarbageSnapshot(undefined, req.signal),
            req,
            ctx,
          );
        case "/_debug/memory/pressure":
          return this.jsonResponse(getMemoryPressureSnapshot(), req, ctx);
        default:
          return this.continue();
      }
    } catch (error) {
      logger.error("Memory debug request failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });

      const response = this.createPrivateResponseBuilder(req, ctx).text(
        "Failed to get memory info",
        HTTP_INTERNAL_SERVER_ERROR,
      );

      return this.respond(response);
    }
  }

  private createPrivateResponseBuilder(req: Request, ctx: HandlerContext) {
    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache("no-store")
      .withHeaders({ "X-Content-Type-Options": "nosniff" });
    if (ctx.securityConfig) builder.withSecurity(ctx.securityConfig, req);
    return builder;
  }

  private jsonResponse(data: unknown, req: Request, ctx: HandlerContext): HandlerResult {
    const response = this.createPrivateResponseBuilder(req, ctx).json(data, HTTP_OK);

    return this.respond(response);
  }
}
