// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";

export class ServerDataFetcher {
  constructor(private adapter?: RuntimeAdapter) {}

  fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (typeof pageModule.getServerData !== "function") {
      return Promise.resolve({ props: {} });
    }

    const pathname = context.url?.pathname ?? "unknown";
    // Extract projectId from request headers (set by proxy) or use default
    const projectId = context.request?.headers?.get("x-project-id") ?? "default";

    // Circuit breaker per project to prevent cascade failures
    const circuitBreaker = getCircuitBreaker(`data-fetch:${projectId}`, {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      successThreshold: 2,
    });

    return withSpan(
      "data.fetch_server",
      async () => {
        const start = performance.now();

        try {
          // Wrap the data fetch in circuit breaker
          const result = await circuitBreaker.execute(() =>
            withTimeoutThrow(
              Promise.resolve(pageModule.getServerData!(context)),
              DATA_FETCH_TIMEOUT_MS,
              `getServerData for ${pathname}`,
            )
          );

          if (result.redirect) return { redirect: result.redirect };
          if (result.notFound) return { notFound: true };

          return {
            props: result.props ?? {},
            revalidate: result.revalidate,
          };
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof CircuitBreakerOpen) {
            serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
              pathname,
              projectId,
              retryAfterMs: error.nextAttemptMs,
            });
          } else if (error instanceof TimeoutError) {
            serverLogger.error("DATA_FETCH_TIMEOUT getServerData timed out", {
              pathname,
              durationMs,
              timeoutMs: DATA_FETCH_TIMEOUT_MS,
            });
          } else {
            this.logError("DATA_FETCH_ERROR getServerData failed", error, { pathname, durationMs });
          }

          throw error;
        }
      },
      {
        "data.fetch_method": "getServerData",
        "data.pathname": pathname,
        "data.timeout_ms": DATA_FETCH_TIMEOUT_MS,
        "data.project_id": projectId,
      },
    );
  }

  /**
   * Log errors unconditionally. Production errors should always be logged.
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    serverLogger.error(message, context ?? {}, error);
  }
}
