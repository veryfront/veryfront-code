import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import { getWorkerPool, isDataIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import type { WorkerResponse } from "#veryfront/security/sandbox/worker-types.ts";

/**
 * Options for isolated data fetching through Worker pool.
 */
export interface ServerDataFetchOptions {
  /** Absolute path to the module containing getServerData */
  modulePath?: string;
  /** Project directory for worker scoping */
  projectDir?: string;
}

export class ServerDataFetcher {
  fetch(
    pageModule: PageWithData,
    context: DataContext,
    options?: ServerDataFetchOptions,
  ): Promise<DataResult> {
    if (typeof pageModule.getServerData !== "function") {
      return Promise.resolve({ props: {} });
    }

    const pathname = context.url?.pathname ?? "unknown";
    const projectId = context.request?.headers?.get("x-project-id") ?? "default";

    const circuitBreaker = getCircuitBreaker(`data-fetch:${projectId}`, {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      successThreshold: 2,
    });

    // Choose isolated or direct execution
    const useIsolation = isDataIsolationEnabled() &&
      !!options?.modulePath &&
      !!options?.projectDir;

    return withSpan(
      "data.fetch_server",
      async () => {
        const start = performance.now();

        try {
          const result = await circuitBreaker.execute(() =>
            withTimeoutThrow(
              useIsolation
                ? this.fetchIsolated(options!.modulePath!, options!.projectDir!, context)
                : Promise.resolve(pageModule.getServerData!(context)),
              DATA_FETCH_TIMEOUT_MS,
              `getServerData for ${pathname}`,
            )
          );

          if (result.redirect) return { redirect: result.redirect };
          if (result.notFound) return { notFound: true };

          return { props: result.props ?? {}, revalidate: result.revalidate };
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof CircuitBreakerOpen) {
            serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
              pathname,
              projectId,
              retryAfterMs: error.nextAttemptMs,
            });
            throw error;
          }

          if (error instanceof TimeoutError) {
            serverLogger.error("DATA_FETCH_TIMEOUT getServerData timed out", {
              pathname,
              durationMs,
              timeoutMs: DATA_FETCH_TIMEOUT_MS,
            });
            throw error;
          }

          this.logError("DATA_FETCH_ERROR getServerData failed", error, {
            pathname,
            durationMs,
            isolated: useIsolation,
          });
          throw error;
        }
      },
      {
        "data.fetch_method": "getServerData",
        "data.pathname": pathname,
        "data.timeout_ms": DATA_FETCH_TIMEOUT_MS,
        "data.project_id": projectId,
        "data.isolated": useIsolation,
      },
    );
  }

  /**
   * Execute getServerData in a per-project Worker.
   */
  private async fetchIsolated(
    modulePath: string,
    projectDir: string,
    context: DataContext,
  ): Promise<DataResult> {
    const pool = getWorkerPool();
    const body = context.request?.body ? new Uint8Array(await context.request.arrayBuffer()) : null;

    const workerResponse: WorkerResponse = await pool.execute(
      projectDir,
      [projectDir],
      {
        type: "fetch-data",
        id: crypto.randomUUID(),
        modulePath,
        context: {
          params: context.params,
          query: context.query?.toString() ?? "",
          request: {
            url: context.request?.url ?? context.url?.toString() ?? "http://localhost",
            method: context.request?.method ?? "GET",
            headers: context.request ? [...context.request.headers.entries()] : [],
            body,
          },
          url: context.url?.toString() ?? "http://localhost",
        },
      },
    );

    if (workerResponse.type === "error") {
      const err = new Error(workerResponse.error.message);
      err.name = workerResponse.error.name;
      throw err;
    }

    if (workerResponse.type === "data-result") {
      return workerResponse.result as DataResult;
    }

    // Unexpected response type — shouldn't happen but be defensive
    throw new Error(`Unexpected worker response type: ${workerResponse.type}`);
  }

  /**
   * Log errors unconditionally. Production errors should always be logged.
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    serverLogger.error(message, context ?? {}, error);
  }
}
