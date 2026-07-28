import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  HTTP_TOO_MANY_REQUESTS,
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
import { AuthHandler } from "#veryfront/security/http/auth.ts";

const logger = rendererLogger.component("memory-debug-handler");

/** Delay after forcing GC before re-measuring heap, so the runtime can settle */
const GC_SETTLE_DELAY_MS = 200;
const GC_MIN_INTERVAL_MS = 60_000;

interface MemoryDebugHandlerDependencies {
  authHandler: Pick<AuthHandler, "handle">;
  forceGC: typeof forceGC;
  getHeapStats: typeof getHeapStats;
  now: () => number;
  settle: () => Promise<void>;
}

interface GcSnapshot {
  timestamp: string;
  gcTriggered: boolean;
  before: ReturnType<typeof getHeapStats>;
  after: ReturnType<typeof getHeapStats>;
  freedMB: number;
}

type GcAdmission =
  | { kind: "operation"; operation: Promise<GcSnapshot> }
  | { kind: "rate-limited"; retryAfterSeconds: number };

class ForcedGcCoordinator {
  private inFlight: Promise<GcSnapshot> | undefined;
  private nextAllowedAt = 0;

  admit(now: number, operation: () => Promise<GcSnapshot>): GcAdmission {
    if (this.inFlight) {
      return { kind: "operation", operation: this.inFlight };
    }

    if (now < this.nextAllowedAt) {
      return {
        kind: "rate-limited",
        retryAfterSeconds: Math.max(1, Math.ceil((this.nextAllowedAt - now) / 1_000)),
      };
    }

    this.nextAllowedAt = now + GC_MIN_INTERVAL_MS;
    const sharedOperation = operation();
    this.inFlight = sharedOperation;
    void sharedOperation.finally(() => {
      if (this.inFlight === sharedOperation) this.inFlight = undefined;
    }).catch(() => undefined);

    return { kind: "operation", operation: sharedOperation };
  }
}

const processForcedGcCoordinator = new ForcedGcCoordinator();

export class MemoryDebugHandler extends BaseHandler {
  private readonly dependencies: MemoryDebugHandlerDependencies;
  private readonly gcCoordinator: ForcedGcCoordinator;

  constructor(dependencies: Partial<MemoryDebugHandlerDependencies> = {}) {
    super();
    const hasInjectedGcRuntime = dependencies.forceGC !== undefined ||
      dependencies.getHeapStats !== undefined ||
      dependencies.now !== undefined ||
      dependencies.settle !== undefined;
    this.gcCoordinator = hasInjectedGcRuntime
      ? new ForcedGcCoordinator()
      : processForcedGcCoordinator;
    this.dependencies = {
      authHandler: new AuthHandler(),
      forceGC,
      getHeapStats,
      now: Date.now,
      settle: () => new Promise((resolve) => setTimeout(resolve, GC_SETTLE_DELAY_MS)),
      ...dependencies,
    };
  }

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
    if (req.method !== "POST") {
      return this.respond(
        new Response("Method not allowed", {
          status: 405,
          headers: {
            "Allow": "POST",
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
      );
    }

    if (!this.hasConfiguredOperatorAuth(ctx)) {
      return this.respond(
        this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache("no-store")
          .withHeaders({ "WWW-Authenticate": 'Basic realm="Secure Area", Bearer' })
          .text("Unauthorized", 401),
      );
    }

    const authResult = await this.dependencies.authHandler.handle(req, ctx);
    if (authResult.response) return authResult;

    const now = this.dependencies.now();
    const admission = this.gcCoordinator.admit(now, () => this.runGC());
    if (admission.kind === "rate-limited") {
      return this.respond(
        this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache("no-store")
          .withHeaders({ "Retry-After": String(admission.retryAfterSeconds) })
          .json({ error: "Forced garbage collection is rate limited" }, HTTP_TOO_MANY_REQUESTS),
      );
    }

    return this.jsonResponse(await admission.operation, req, ctx);
  }

  private async runGC(): Promise<GcSnapshot> {
    const before = this.dependencies.getHeapStats();
    const gcTriggered = await this.dependencies.forceGC();
    await this.dependencies.settle();
    const after = this.dependencies.getHeapStats();
    const freedMB = Math.round((before.usedHeapSizeMB - after.usedHeapSizeMB) * 100) / 100;

    return {
      timestamp: new Date(this.dependencies.now()).toISOString(),
      gcTriggered,
      before,
      after,
      freedMB,
    };
  }

  private hasConfiguredOperatorAuth(ctx: HandlerContext): boolean {
    try {
      if (
        ctx.securityConfig &&
        (Object.hasOwn(ctx.securityConfig, "auth") || ctx.securityConfig.auth !== undefined)
      ) {
        return true;
      }
    } catch {
      // A hostile or malformed configuration is still passed to AuthHandler,
      // which rejects it without exposing credential details.
      return true;
    }

    try {
      const env = ctx.adapter?.env;
      return env !== undefined &&
        ["VERYFRONT_BASIC_USER", "VERYFRONT_BASIC_PASS", "VERYFRONT_BEARER_TOKEN"].some(
          (name) => env.get(name) !== undefined,
        );
    } catch {
      return false;
    }
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
