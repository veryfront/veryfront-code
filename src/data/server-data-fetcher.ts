import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { isDataControlResult, toDataControlResult } from "./helpers.ts";
import { validateDataResult } from "./data-result-validation.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import { getWorkerPool, isDataIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  MAX_WORKER_BODY_BYTES,
  type WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  digestWorkerGenerationMaterial,
  resolveWorkerGeneration,
  snapshotWorkerGenerationIdentity,
} from "#veryfront/security/sandbox/worker-generation.ts";
import { getTrustedProjectEnvSnapshot } from "#veryfront/platform/compat/process/env.ts";
import type { ProjectEnvSnapshot } from "#veryfront/platform/compat/process/project-env-contract.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { readBodyBytesWithLimit } from "#veryfront/security/input-validation/limits.ts";
import { createApplicationRequestHeaders } from "#veryfront/security/http/application-request.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

/**
 * Options for isolated data fetching through Worker pool.
 */
export interface ServerDataFetchOptions {
  /** Absolute path to the module containing getServerData */
  modulePath?: string;
  /** Project directory for worker scoping */
  projectDir?: string;
  /** Host-owned locality decision for development-only behavior. */
  isLocalProject?: boolean;
  /** Narrow host-owned capability for project-code execution. */
  allowHostProjectCodeExecution?: boolean;
  /** Stable host-owned tenant/project scope for reusable workers. */
  workerScope?: string;
  /** Immutable release or source-snapshot identity for reusable workers. */
  sourceGeneration?: string;
}

interface DataWorkerAdmission {
  readonly projectEnv?: ProjectEnvSnapshot;
  readonly sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  readonly workerId: string;
  readonly reusable: boolean;
}

function appendIdentityPart(parts: string[], value: string): void {
  parts.push(`${value.length}:${value}`);
}

async function resolveDataWorkerAdmission(
  options: ServerDataFetchOptions,
): Promise<DataWorkerAdmission> {
  const sourceIntegrationPolicy = requireActiveSourceIntegrationPolicy();
  const projectEnv = getTrustedProjectEnvSnapshot();
  const hasScope = options.workerScope !== undefined;
  const hasGeneration = options.sourceGeneration !== undefined;
  if (hasScope !== hasGeneration) {
    throw new TypeError(
      "Data worker scope and source generation must be supplied together",
    );
  }

  if (!hasScope || !hasGeneration) {
    const generation = await resolveWorkerGeneration("data");
    return {
      projectEnv,
      sourceIntegrationPolicy,
      workerId: generation.workerId,
      reusable: false,
    };
  }

  const semanticParts: string[] = [];
  appendIdentityPart(semanticParts, options.sourceGeneration!);
  appendIdentityPart(semanticParts, sourceIntegrationPolicy.mode);
  appendIdentityPart(semanticParts, JSON.stringify(sourceIntegrationPolicy));
  if (projectEnv) {
    for (const key of Object.keys(projectEnv).sort(compareStrings)) {
      appendIdentityPart(semanticParts, key);
      appendIdentityPart(semanticParts, projectEnv[key]!);
    }
  }

  const identity = snapshotWorkerGenerationIdentity(
    options.workerScope!,
    await digestWorkerGenerationMaterial(semanticParts.join("|")),
  );
  if (!identity) throw new TypeError("Data worker generation identity is required");
  const generation = await resolveWorkerGeneration("data", identity);
  return {
    projectEnv,
    sourceIntegrationPolicy,
    workerId: generation.workerId,
    reusable: generation.reusable,
  };
}

/** @internal Exact worker identity probe for boundary regression tests. */
export async function __resolveDataWorkerIdentityForTests(
  options: ServerDataFetchOptions,
): Promise<Readonly<Pick<DataWorkerAdmission, "workerId" | "reusable">>> {
  const admission = await resolveDataWorkerAdmission(options);
  return Object.freeze({
    workerId: admission.workerId,
    reusable: admission.reusable,
  });
}

export class ServerDataFetcher {
  fetch(
    pageModule: PageWithData,
    context: DataContext,
    options?: ServerDataFetchOptions,
  ): Promise<DataResult> {
    if (
      options?.isLocalProject === false &&
      options.allowHostProjectCodeExecution !== true
    ) {
      return Promise.reject(
        INITIALIZATION_ERROR.create({
          detail: "Remote server-data execution requires a generation-owned prepared module graph",
        }),
      );
    }
    if (typeof pageModule.getServerData !== "function") {
      return Promise.resolve({ props: {} });
    }

    const pathname = context.url?.pathname ?? "unknown";
    const projectId = context.request?.headers?.get("x-project-id") ?? "default";
    const isPrefetch = context.request?.headers?.get("x-veryfront-prefetch") === "1";
    const breakerNamespace = isPrefetch ? "data-prefetch" : "data-fetch";

    const circuitBreaker = getCircuitBreaker(`${breakerNamespace}:${projectId}`, {
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
          const result = await circuitBreaker.execute(async () => {
            try {
              return await withTimeoutThrow(
                useIsolation
                  ? this.fetchIsolated(options!, context)
                  : Promise.resolve(pageModule.getServerData!(context)),
                DATA_FETCH_TIMEOUT_MS,
                `getServerData for ${pathname}`,
              );
            } catch (error) {
              // `throw notFound()` / `throw redirect(...)`: treat a thrown
              // control result exactly like a returned one. This has to happen
              // inside the breaker, or five legitimate 404s on the same project
              // open it and every data route after that fails fast for 30s.
              if (isDataControlResult(error)) return toDataControlResult(error);
              throw error;
            }
          });

          const validated = validateDataResult(result, "getServerData");
          if (validated.redirect || validated.notFound) return validated;

          return { ...validated, props: validated.props ?? {} };
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof CircuitBreakerOpen) {
            serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
              pathname,
              projectId,
              breakerNamespace,
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
        "data.prefetch": isPrefetch,
        "data.isolated": useIsolation,
      },
    );
  }

  /**
   * Execute getServerData in a per-project Worker.
   */
  private async fetchIsolated(
    options: ServerDataFetchOptions,
    context: DataContext,
  ): Promise<DataResult> {
    const modulePath = options.modulePath!;
    const projectDir = options.projectDir!;
    const pool = getWorkerPool();
    let body: Uint8Array | null = null;
    if (context.request?.body) {
      body = await readBodyBytesWithLimit(
        context.request,
        MAX_WORKER_BODY_BYTES,
      );
    }

    const applicationHeaders = context.request
      ? createApplicationRequestHeaders(context.request.headers)
      : undefined;

    const admission = await resolveDataWorkerAdmission(options);

    try {
      const workerResponse: WorkerResponse = await pool.execute(
        admission.workerId,
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
              headers: applicationHeaders ? [...applicationHeaders.entries()] : [],
              body,
            },
            url: context.url?.toString() ?? "http://localhost",
          },
          sourceIntegrationPolicy: admission.sourceIntegrationPolicy,
          projectEnv: admission.projectEnv,
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
    } finally {
      if (!admission.reusable) pool.evictWorker(admission.workerId);
    }
  }

  /**
   * Log errors unconditionally. Production errors should always be logged.
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    serverLogger.error(message, context ?? {}, error);
  }
}
