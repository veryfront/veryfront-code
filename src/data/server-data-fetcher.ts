import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  type CircuitBreaker,
  CircuitBreakerOpen,
  getCircuitBreaker,
} from "#veryfront/utils/circuit-breaker.ts";
import { getWorkerPool, isDataIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  MAX_WORKER_BODY_BYTES,
  type WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
  validateRequestLimits,
} from "#veryfront/security/input-validation/limits.ts";
import { resolveDataProjectScope } from "./project-scope.ts";
import { parseDataResult } from "./result-validation.ts";
import { hashString } from "#veryfront/cache/hash.ts";

const ISOLATED_BODY_TOO_LARGE_DETAIL = "Request body too large for isolated data fetch";

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
    const pathnameHash = hashString(pathname);
    const projectScope = resolveDataProjectScope(context);

    const circuitBreaker = getCircuitBreaker(`data-fetch:${projectScope}`, {
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
          const label = "getServerData";
          const result = useIsolation
            ? await withTimeoutThrow(
              this.fetchIsolated(
                options!.modulePath!,
                options!.projectDir!,
                context,
                circuitBreaker,
                start + DATA_FETCH_TIMEOUT_MS,
                label,
              ),
              DATA_FETCH_TIMEOUT_MS,
              label,
            )
            : await circuitBreaker.execute(() =>
              withTimeoutThrow(
                Promise.resolve(pageModule.getServerData!(context)),
                DATA_FETCH_TIMEOUT_MS,
                label,
              ).then((value) => parseDataResult(value, "getServerData"))
            );

          if (result.redirect) return { redirect: result.redirect };
          if (result.notFound) return { notFound: true };

          return { props: result.props ?? {}, revalidate: result.revalidate };
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof CircuitBreakerOpen) {
            serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
              pathnameHash,
              projectScope,
              retryAfterMs: error.nextAttemptMs,
            });
            throw error;
          }

          if (error instanceof TimeoutError) {
            serverLogger.error("DATA_FETCH_TIMEOUT getServerData timed out", {
              pathnameHash,
              durationMs,
              timeoutMs: DATA_FETCH_TIMEOUT_MS,
            });
            throw error;
          }

          this.logError("DATA_FETCH_ERROR getServerData failed", error, {
            pathnameHash,
            durationMs,
            isolated: useIsolation,
          });
          throw error;
        }
      },
      {
        "data.fetch_method": "getServerData",
        "data.pathname_hash": pathnameHash,
        "data.timeout_ms": DATA_FETCH_TIMEOUT_MS,
        "data.project_scope": projectScope,
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
    circuitBreaker: CircuitBreaker,
    deadline: number,
    label: string,
  ): Promise<DataResult> {
    const pool = getWorkerPool();
    let body: Uint8Array | null = null;
    if (context.request) {
      try {
        validateRequestLimits(context.request, { maxBodySize: MAX_WORKER_BODY_BYTES });
        if (context.request.body) {
          body = await readBodyBytesWithLimit(context.request, MAX_WORKER_BODY_BYTES);
        }
      } catch (error) {
        if (!isRequestBodyTooLargeError(error)) throw error;
        throw INPUT_VALIDATION_FAILED.create({
          detail: ISOLATED_BODY_TOO_LARGE_DETAIL,
          cause: error,
          context: { maxBodyBytes: MAX_WORKER_BODY_BYTES },
        });
      }
    }

    const sourceIntegrationPolicy = requireActiveSourceIntegrationPolicy();
    const remainingMs = Math.ceil(deadline - performance.now());
    if (remainingMs <= 0) throw new TimeoutError(label, DATA_FETCH_TIMEOUT_MS);

    return circuitBreaker.execute(async () => {
      const workerResponse: WorkerResponse = await withTimeoutThrow(
        pool.execute(
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
            sourceIntegrationPolicy,
          },
        ),
        remainingMs,
        label,
      );

      if (workerResponse.type === "error") {
        const err = new Error(workerResponse.error.message);
        err.name = workerResponse.error.name;
        throw err;
      }

      if (workerResponse.type === "data-result") {
        return parseDataResult(workerResponse.result, "getServerData");
      }

      throw new Error(`Unexpected worker response type: ${workerResponse.type}`);
    });
  }

  /**
   * Log errors unconditionally. Production errors should always be logged.
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    serverLogger.error(message, {
      ...context,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}
