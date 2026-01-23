import type { Handler, HandlerContext, RouteRegistryConfig } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export class RouteRegistry {
  private handlers: Handler[] = [];
  private config: RouteRegistryConfig;

  constructor(config: RouteRegistryConfig = {}) {
    this.config = {
      debug: false,
      enableMetrics: true,
      ...config,
    };
  }

  register(handler: Handler): this {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => a.metadata.priority - b.metadata.priority);

    if (this.config.debug) {
      serverLogger.debug(
        `[RouteRegistry] Registered handler: ${handler.metadata.name} (priority: ${handler.metadata.priority})`,
      );
    }

    return this;
  }

  registerAll(handlers: Handler[]): this {
    for (const handler of handlers) {
      this.register(handler);
    }
    return this;
  }

  execute(req: Request, ctx: HandlerContext): Promise<Response | null> {
    return withSpan("routing.registry.execute", async () => {
      const startTime = Date.now();
      const url = new URL(req.url);

      if (this.config.debug) {
        serverLogger.debug(`[RouteRegistry] Processing ${req.method} ${url.pathname}`);
      }

      for (const handler of this.handlers) {
        try {
          if (handler.metadata.enabled && !handler.metadata.enabled(ctx)) {
            if (this.config.debug) {
              serverLogger.debug(
                `[RouteRegistry] Skipping disabled handler: ${handler.metadata.name}`,
              );
            }
            continue;
          }

          const handlerStart = Date.now();
          const result = await withSpan(
            `routing.handler.${handler.metadata.name}`,
            () => handler.handle(req, ctx),
            {
              "handler.name": handler.metadata.name,
              "handler.priority": handler.metadata.priority,
            },
          );
          const handlerTime = Date.now() - handlerStart;

          if (this.config.debug && this.config.enableMetrics) {
            serverLogger.debug(
              `[RouteRegistry] Handler ${handler.metadata.name} took ${handlerTime}ms`,
            );
          }

          if (result.response) {
            const totalTime = Date.now() - startTime;
            if (this.config.debug) {
              serverLogger.debug(
                `[RouteRegistry] Response from ${handler.metadata.name} (total: ${totalTime}ms)`,
              );
            }
            return result.response;
          }

          if (!result.continue) {
            if (this.config.debug) {
              serverLogger.debug(
                `[RouteRegistry] Chain stopped by ${handler.metadata.name} without response`,
              );
            }
            break;
          }
        } catch (error) {
          // Always log handler errors - they should never be silently swallowed
          serverLogger.error(`[RouteRegistry] Handler ${handler.metadata.name} threw an error`, {
            handler: handler.metadata.name,
            path: url.pathname,
            method: req.method,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          // Continue to next handler - a single handler failure shouldn't break the chain
        }
      }

      const totalTime = Date.now() - startTime;
      if (this.config.debug) {
        serverLogger.debug(`[RouteRegistry] No handler matched (total: ${totalTime}ms)`);
      }

      return null;
    }, { "http.method": req.method, "http.path": new URL(req.url).pathname });
  }

  getHandlers(): ReadonlyArray<Handler> {
    return this.handlers;
  }

  clear(): this {
    this.handlers = [];
    return this;
  }

  remove(name: string): this {
    this.handlers = this.handlers.filter((h) => h.metadata.name !== name);
    return this;
  }

  has(name: string): boolean {
    return this.handlers.some((h) => h.metadata.name === name);
  }

  getStats(): {
    totalHandlers: number;
    handlersByPriority: Record<string, number>;
    handlerNames: string[];
  } {
    const stats = {
      totalHandlers: this.handlers.length,
      handlersByPriority: {} as Record<string, number>,
      handlerNames: this.handlers.map((h) => h.metadata.name),
    };

    for (const handler of this.handlers) {
      const priority = handler.metadata.priority.toString();
      stats.handlersByPriority[priority] = (stats.handlersByPriority[priority] || 0) + 1;
    }

    return stats;
  }
}
