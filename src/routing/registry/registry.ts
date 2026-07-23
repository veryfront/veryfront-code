import type { Handler, HandlerContext, RouteRegistryConfig } from "./types.ts";
import { getBaseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { normalizeHttpMethod } from "#veryfront/observability/telemetry-safety.ts";
import { errorToRFC9457Response } from "#veryfront/errors";
import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";

const logger = getBaseLogger("SERVER").component("route-registry");

type SpanAttributes = Record<string, string | number | boolean>;

function getSafeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(name) ? name : "Error";
}

export function buildRouteRegistrySpanAttributes(
  req: Request,
  _url: URL,
  _ctx: HandlerContext,
): SpanAttributes {
  return { "http.method": normalizeHttpMethod(req.method) };
}

export class RouteRegistry {
  private handlers: Handler<RuntimeResponse>[] = [];
  private config: RouteRegistryConfig;

  constructor(config: RouteRegistryConfig = {}) {
    this.config = {
      debug: false,
      enableMetrics: true,
      ...config,
    };
  }

  register(handler: Handler<RuntimeResponse>): this {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => a.metadata.priority - b.metadata.priority);

    if (this.config.debug) {
      logger.debug(
        `[RouteRegistry] Registered handler: ${handler.metadata.name} (priority: ${handler.metadata.priority})`,
      );
    }

    return this;
  }

  registerAll(handlers: Handler<RuntimeResponse>[]): this {
    for (const handler of handlers) {
      this.register(handler);
    }
    return this;
  }

  execute(req: Request, ctx: HandlerContext): Promise<RuntimeResponse | null> {
    const url = new URL(req.url);

    return withSpan(
      "routing.registry.execute",
      async () => {
        const startTime = Date.now();

        if (this.config.debug) {
          logger.debug("Processing request", {
            method: normalizeHttpMethod(req.method),
          });
        }

        for (const handler of this.handlers) {
          try {
            if (handler.metadata.enabled && !handler.metadata.enabled(ctx)) {
              if (this.config.debug) {
                logger.debug(
                  `[RouteRegistry] Skipping disabled handler: ${handler.metadata.name}`,
                );
              }
              continue;
            }

            const handlerStart = Date.now();
            // Note: Individual handler spans removed to reduce trace noise.
            // Most handlers are very fast (< 1ms) and just check if they should handle.
            // The outer routing.registry.execute span captures total routing time.
            const result = await handler.handle(req, ctx);
            const handlerTime = Date.now() - handlerStart;

            if (this.config.debug && this.config.enableMetrics) {
              logger.debug(
                `[RouteRegistry] Handler ${handler.metadata.name} took ${handlerTime}ms`,
              );
            }

            if (result.response) {
              if (this.config.debug) {
                logger.debug(
                  `[RouteRegistry] Response from ${handler.metadata.name} (total: ${
                    Date.now() - startTime
                  }ms)`,
                );
              }
              return result.response;
            }

            if (!result.continue) {
              if (this.config.debug) {
                logger.debug(
                  `[RouteRegistry] Chain stopped by ${handler.metadata.name} without response`,
                );
              }
              break;
            }
          } catch (error) {
            // Convert handler error to RFC 9457 response and return immediately
            const response = errorToRFC9457Response(error, ctx, req);
            logger.error("Route handler failed", {
              handler: handler.metadata.name,
              method: normalizeHttpMethod(req.method),
              status: response.status,
              errorName: getSafeErrorName(error),
            });
            return response;
          }
        }

        if (this.config.debug) {
          logger.debug(
            `[RouteRegistry] No handler matched (total: ${Date.now() - startTime}ms)`,
          );
        }

        return null;
      },
      buildRouteRegistrySpanAttributes(req, url, ctx),
    );
  }

  getHandlers(): ReadonlyArray<Handler<RuntimeResponse>> {
    return [...this.handlers];
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
    const handlersByPriority: Record<string, number> = {};
    const handlerNames = this.handlers.map((h) => h.metadata.name);

    for (const handler of this.handlers) {
      const priority = String(handler.metadata.priority);
      handlersByPriority[priority] = (handlersByPriority[priority] ?? 0) + 1;
    }

    return {
      totalHandlers: this.handlers.length,
      handlersByPriority,
      handlerNames,
    };
  }
}
