import type { Handler, HandlerContext, RouteRegistryConfig } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { errorToRFC9457Response } from "#veryfront/errors";

const logger = serverLogger.component("route-registry");

type SpanAttributes = Record<string, string | number | boolean>;

/**
 * Cancel (`DELETE /runs/{runId}`) and resume reach the owning pod directly, past the proxy,
 * so their release headers are unverified. Their handlers stamp the identity recorded when
 * the run's stream started instead.
 */
const DIRECT_TO_POD_RUN_ROUTE = /^\/api\/control-plane\/runs\/[^/]+(?:\/resume)?$/u;

export function buildRouteRegistrySpanAttributes(
  req: Request,
  url: URL,
  ctx: HandlerContext,
): SpanAttributes {
  const attributes: SpanAttributes = {
    "http.method": req.method,
    "http.path": url.pathname,
  };

  const projectSlug = ctx.projectSlug ?? ctx.enriched?.projectSlug;
  if (projectSlug) {
    attributes["veryfront.project_slug"] = projectSlug;
    attributes["project.slug"] = projectSlug;
    attributes["veryfront.environment"] = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ??
      "unknown";
  }

  const projectId = ctx.projectId;
  if (projectId) {
    attributes["veryfront.project_id"] = projectId;
    attributes["project.id"] = projectId;
  }

  if (!projectSlug && !projectId) return attributes;
  if (DIRECT_TO_POD_RUN_ROUTE.test(url.pathname)) return attributes;

  return { ...attributes, ...buildServingSpanAttributes(ctx) };
}

/** The environment name plus the release or branch a request was served from. */
export function buildServingSpanAttributes(ctx: HandlerContext): SpanAttributes {
  const attributes: SpanAttributes = {};
  if (ctx.environmentName) attributes["veryfront.environment_name"] = ctx.environmentName;

  const signedBranchName = ctx.branchId ? ctx.branchName : ctx.defaultBranchName;
  if (ctx.branchId || signedBranchName) {
    if (ctx.branchId) attributes["branch.id"] = ctx.branchId;
    if (signedBranchName) attributes["branch.name"] = signedBranchName;
  } else if (ctx.resolvedEnvironment === "production") {
    if (ctx.releaseId) attributes["release.id"] = ctx.releaseId;
  } else if (ctx.requestContext?.branch) {
    attributes["branch.name"] = ctx.requestContext.branch;
  }

  return attributes;
}

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
    const url = new URL(req.url);
    const debug = Boolean(this.config.debug || ctx.debug);

    return withSpan(
      "routing.registry.execute",
      async () => {
        const startTime = Date.now();

        if (debug) {
          logger.debug(`Processing ${req.method} ${url.pathname}`);
        }

        for (const handler of this.handlers) {
          try {
            if (handler.metadata.enabled && !handler.metadata.enabled(ctx)) {
              if (debug) {
                serverLogger.debug(
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

            if (debug && this.config.enableMetrics) {
              serverLogger.debug(
                `[RouteRegistry] Handler ${handler.metadata.name} took ${handlerTime}ms`,
              );
            }

            if (result.response) {
              if (debug) {
                serverLogger.debug(
                  `[RouteRegistry] Response from ${handler.metadata.name} (total: ${
                    Date.now() - startTime
                  }ms)`,
                );
              }
              return result.response;
            }

            if (!result.continue) {
              if (debug) {
                serverLogger.debug(
                  `[RouteRegistry] Chain stopped by ${handler.metadata.name} without response`,
                );
              }
              break;
            }
          } catch (error) {
            // Always log handler errors - they should never be silently swallowed
            serverLogger.error(
              `[RouteRegistry] Handler ${handler.metadata.name} threw an error`,
              {
                handler: handler.metadata.name,
                path: url.pathname,
                method: req.method,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
              },
            );
            // Convert handler error to RFC 9457 response and return immediately
            return errorToRFC9457Response(error, ctx, req);
          }
        }

        if (debug) {
          serverLogger.debug(
            `[RouteRegistry] No handler matched (total: ${Date.now() - startTime}ms)`,
          );
        }

        return null;
      },
      buildRouteRegistrySpanAttributes(req, url, ctx),
    );
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
