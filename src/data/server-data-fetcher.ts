import type { DataContext, DataResult, PageWithData } from "./types.ts";
import {
  cloneServerDataContext,
  isDataControlResult,
  toDataControlResult,
  validateDataResult,
} from "./helpers.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError } from "#veryfront/rendering/utils/stream-utils.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import { getWorkerPool, isDataIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import { deserializeWorkerError } from "#veryfront/security/sandbox/worker-error-boundary.ts";
import {
  MAX_WORKER_BODY_BYTES,
  type WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { INPUT_VALIDATION_FAILED, SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import {
  combineAbortSignals,
  getAbortReason,
  isAbortSignalAborted,
  isCallerAbort,
  raceWithCallerAbort,
} from "./abort-utils.ts";
import {
  type DataExecutionAdmission,
  defaultDataExecutionAdmission,
} from "./execution-admission.ts";
import { requireDataProjectId } from "./project-identity.ts";
import {
  resolveWorkerGeneration,
  snapshotWorkerGenerationIdentity,
  type WorkerGenerationIdentity,
} from "#veryfront/security/sandbox/worker-generation.ts";
import { type DataCacheScope, snapshotDataCacheScope } from "./data-fetching-cache.ts";

/**
 * Options for isolated data fetching through Worker pool.
 */
export interface ServerDataFetchOptions {
  /** Absolute path to the module containing getServerData */
  modulePath?: string;
  /** Project directory for worker scoping */
  projectDir?: string;
  /** Trusted project identity for circuit-breaker isolation */
  projectId?: string;
  /** Exact project/mode/version identity used when no worker source is available. */
  cacheScope?: DataCacheScope | null;
  /** Caller cancellation, kept outside dependency health accounting. */
  signal?: AbortSignal;
  /** @internal Host-owned worker lifetime scope; paired with workerGenerationId. */
  workerScopeId?: string;
  /** @internal Immutable source identity; paired with workerScopeId. */
  workerGenerationId?: string;
}

interface PreparedIsolatedRequest {
  body: Uint8Array | null;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
}

const localWorkerOverloads = new WeakSet<VeryfrontError>();

function getServerDataCircuitBreakerName(
  namespace: "data-fetch" | "data-prefetch",
  projectKey: string,
  workerGeneration?: Readonly<WorkerGenerationIdentity>,
  cacheScope?: Readonly<DataCacheScope> | null,
): string {
  let sourceKey: string;
  if (workerGeneration !== undefined) {
    sourceKey = `generation:${
      hashString(
        `${workerGeneration.scopeId.length}:${workerGeneration.scopeId}${workerGeneration.generationId.length}:${workerGeneration.generationId}`,
      )
    }`;
  } else if (cacheScope) {
    sourceKey = `scope:${
      hashString(
        `${cacheScope.mode.length}:${cacheScope.mode}${cacheScope.versionId.length}:${cacheScope.versionId}`,
      )
    }`;
  } else {
    sourceKey = "unversioned";
  }
  return `${namespace}:v2:${projectKey}:${sourceKey}`;
}

function getRejectedBodySize(error: unknown): number | undefined {
  if (!isRequestBodyTooLargeError(error)) return undefined;
  const details = (error.context as { details?: { actualSize?: unknown } } | undefined)
    ?.details;
  return typeof details?.actualSize === "number" ? details.actualSize : undefined;
}

function isServiceOverload(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError &&
    error.slug === SERVICE_OVERLOADED.slug;
}

function isLocalWorkerOverload(error: unknown, useIsolation: boolean): boolean {
  return useIsolation &&
    isServiceOverload(error) &&
    localWorkerOverloads.has(error);
}

interface DataFetchDeadline {
  readonly promise: Promise<never>;
  readonly signal: AbortSignal;
  clear(): void;
  throwIfExpired(): void;
}

function createDataFetchDeadline(
  label: string,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): DataFetchDeadline {
  const startedAt = performance.now();
  const timeoutError = new TimeoutError(label, timeoutMs);
  const controller = new AbortController();
  let expired = false;
  let expirationReason: unknown = timeoutError;
  let rejectDeadline!: (reason?: unknown) => void;

  const promise = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const expire = (): unknown => {
    if (!expired) {
      expired = true;
      // A caller cancellation scheduled before the deadline remains the
      // authoritative reason even if both timers become runnable together.
      // This keeps ordinary disconnects out of dependency health accounting.
      expirationReason = callerSignal && isAbortSignalAborted(callerSignal)
        ? getAbortReason(callerSignal)
        : timeoutError;
      controller.abort(expirationReason);
      rejectDeadline(expirationReason);
    }
    return expirationReason;
  };
  const timeoutId = setTimeout(expire, timeoutMs);

  return {
    promise,
    signal: controller.signal,
    clear(): void {
      clearTimeout(timeoutId);
    },
    throwIfExpired(): void {
      // Timers cannot run while synchronous user code blocks the event loop.
      // The monotonic check prevents a late result from winning merely because
      // its promise reaction was queued before the overdue timer callback.
      if (!expired && performance.now() - startedAt < timeoutMs) return;
      throw expire();
    },
  };
}

export class ServerDataFetcher {
  private readonly preparedRequestBodies = new WeakMap<
    Request,
    Promise<Uint8Array>
  >();

  constructor(
    private readonly executionAdmission: DataExecutionAdmission = defaultDataExecutionAdmission,
  ) {}

  fetch<TProps = unknown>(
    pageModule: PageWithData<TProps>,
    context: DataContext,
    options?: ServerDataFetchOptions,
  ): Promise<DataResult<TProps>> {
    let modulePath: string | undefined;
    let projectDir: string | undefined;
    let suppliedProjectId: string | undefined;
    let suppliedScope: DataCacheScope | null | undefined;
    let suppliedSignal: AbortSignal | undefined;
    let workerGeneration: Readonly<WorkerGenerationIdentity> | undefined;
    try {
      modulePath = options?.modulePath;
      projectDir = options?.projectDir;
      const rawProjectId = options?.projectId;
      suppliedProjectId = rawProjectId === undefined
        ? undefined
        : requireDataProjectId(rawProjectId);
      suppliedScope = options?.cacheScope;
      suppliedSignal = options?.signal;
      workerGeneration = snapshotWorkerGenerationIdentity(
        options?.workerScopeId,
        options?.workerGenerationId,
      );
    } catch (error) {
      return Promise.reject(error);
    }

    // Snapshot the application-controlled export once. Accessors or HMR
    // mutation must not select one hook for admission and a different hook at
    // deferred dispatch.
    const getServerData = pageModule.getServerData;
    if (typeof getServerData !== "function") {
      return Promise.resolve({ props: {} } as DataResult<TProps>);
    }

    const isolationEnabled = isDataIsolationEnabled();
    let executionContext: DataContext;
    try {
      executionContext = cloneServerDataContext(context, {
        cloneRequest: !isolationEnabled,
      });
    } catch (error) {
      return Promise.reject(error);
    }
    const pathname = executionContext.url?.pathname ?? "unknown";
    let projectId: string;
    let authoritativeScope: Readonly<DataCacheScope> | null;
    try {
      const rawAmbientScope = tryGetCacheKeyContext();
      const ambientScope = rawAmbientScope === null
        ? null
        : snapshotDataCacheScope(rawAmbientScope);
      const rawScope = suppliedScope === undefined ? ambientScope : suppliedScope;
      authoritativeScope = rawScope === null ? null : snapshotDataCacheScope(rawScope);
      if (
        authoritativeScope &&
        suppliedProjectId !== undefined &&
        suppliedProjectId !== authoritativeScope.projectId
      ) {
        throw new TypeError(
          "Server data projectId must match the authoritative cache scope projectId",
        );
      }
      projectId = requireDataProjectId(
        suppliedProjectId ??
          authoritativeScope?.projectId ??
          ambientScope?.projectId ??
          "default",
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const projectKey = hashString(projectId);
    const isPrefetch = executionContext.request?.headers?.get("x-veryfront-prefetch") === "1";
    const breakerNamespace = isPrefetch ? "data-prefetch" : "data-fetch";
    const callerSignal = combineAbortSignals(
      executionContext.request?.signal,
      suppliedSignal,
    );
    if (callerSignal && isAbortSignalAborted(callerSignal)) {
      return Promise.reject(getAbortReason(callerSignal));
    }

    const circuitBreaker = getCircuitBreaker(
      getServerDataCircuitBreakerName(
        breakerNamespace,
        projectKey,
        workerGeneration,
        authoritativeScope,
      ),
      {
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
        successThreshold: 2,
      },
    );

    const hasIsolationPaths = typeof modulePath === "string" &&
      modulePath.length > 0 &&
      typeof projectDir === "string" &&
      projectDir.length > 0;
    if (isolationEnabled && !hasIsolationPaths) {
      return Promise.reject(
        new Error(
          "Isolated getServerData execution requires non-empty modulePath and projectDir",
        ),
      );
    }
    const useIsolation = isolationEnabled;

    const dependencyExecution = withSpan(
      "data.fetch_server",
      async () => {
        const start = performance.now();
        const timeoutLabel = `getServerData for ${pathname}`;
        const deadline = createDataFetchDeadline(
          timeoutLabel,
          DATA_FETCH_TIMEOUT_MS,
          callerSignal,
        );
        let releaseAdmission: (() => void) | undefined;
        let producerOwnsAdmission = false;

        try {
          releaseAdmission = this.executionAdmission.acquire(projectId);
          // Validate and serialize caller-controlled input before entering the
          // dependency breaker. Oversized or malformed requests must not count
          // as backend outages and open the project circuit.
          const preparationSignal = combineAbortSignals(
            deadline.signal,
            callerSignal,
          )!;
          const directExecutionContext = useIsolation ? executionContext : {
            ...executionContext,
            request: new Request(executionContext.request, {
              signal: preparationSignal,
            }),
          };
          const isolatedRequest = useIsolation
            ? await Promise.race([
              this.prepareIsolatedRequest(
                executionContext,
                preparationSignal,
              ),
              deadline.promise,
            ])
            : undefined;
          deadline.throwIfExpired();

          // Once dependency execution begins, the same overall deadline must
          // reject inside the breaker so repeated hangs are counted.
          const result = await circuitBreaker.execute(
            async () => {
              const dependency = Promise.resolve().then(() =>
                useIsolation
                  ? this.fetchIsolated(
                    modulePath!,
                    projectDir!,
                    executionContext,
                    isolatedRequest!,
                    workerGeneration,
                  )
                  : getServerData(directExecutionContext)
              );
              const producer = dependency.then((dependencyResult) => {
                deadline.throwIfExpired();
                const validated = validateDataResult(
                  dependencyResult,
                  "getServerData",
                );
                deadline.throwIfExpired();
                return validated;
              }, (error) => {
                // Exact caller cancellation remains dependency-neutral even
                // when its promise reaction runs on the deadline boundary.
                // Converting it to TimeoutError first would open the project
                // circuit after five ordinary disconnects.
                if (isCallerAbort(error, callerSignal)) throw error;
                // A synchronous loader can block the event loop past the timer
                // and then throw before the overdue timer callback runs.
                deadline.throwIfExpired();
                // `throw notFound()` / `throw redirect(...)`: treat a thrown
                // control result exactly like a returned one.
                if (isDataControlResult(error)) {
                  const control = validateDataResult(
                    error,
                    "getServerData",
                  );
                  deadline.throwIfExpired();
                  return toDataControlResult(control);
                }
                throw error;
              });

              void producer.then(
                releaseAdmission!,
                releaseAdmission!,
              );
              producerOwnsAdmission = true;
              return await Promise.race([
                producer,
                deadline.promise,
              ]);
            },
            {
              isNeutralError: (error) =>
                isCallerAbort(error, callerSignal) ||
                isLocalWorkerOverload(error, useIsolation),
            },
          );

          if (result.redirect) return { redirect: result.redirect };
          if (result.notFound) return { notFound: true };

          return {
            props: result.props ?? {},
            revalidate: result.revalidate,
          } as DataResult<TProps>;
        } catch (caughtError) {
          // Preserve exact caller cancellation before applying the monotonic
          // deadline check. The caller signal can win the same event-loop turn
          // in which the deadline timer becomes eligible.
          if (isCallerAbort(caughtError, callerSignal)) {
            throw caughtError;
          }
          let error = caughtError;
          try {
            deadline.throwIfExpired();
          } catch (timeoutError) {
            error = timeoutError;
          }
          const durationMs = Math.round(performance.now() - start);

          if (!producerOwnsAdmission && isServiceOverload(error)) {
            serverLogger.warn("DATA_FETCH_REJECTED execution capacity exhausted", {
              pathname,
              projectKey,
            });
            throw error;
          }

          if (isLocalWorkerOverload(error, useIsolation)) {
            serverLogger.warn("DATA_FETCH_REJECTED worker execution capacity exhausted", {
              pathname,
              projectKey,
            });
            throw error;
          }

          if (error instanceof CircuitBreakerOpen) {
            serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
              pathname,
              projectKey,
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
        } finally {
          deadline.clear();
          if (!producerOwnsAdmission) releaseAdmission?.();
        }
      },
      {
        "data.fetch_method": "getServerData",
        "data.pathname": pathname,
        "data.timeout_ms": DATA_FETCH_TIMEOUT_MS,
        "data.project_key": projectKey,
        "data.prefetch": isPrefetch,
        "data.isolated": useIsolation,
      },
    );
    return raceWithCallerAbort(dependencyExecution, callerSignal);
  }

  /** Validate and serialize the request before entering dependency accounting. */
  private async prepareIsolatedRequest(
    context: DataContext,
    signal: AbortSignal,
  ): Promise<PreparedIsolatedRequest> {
    // Establish authorization before inspecting or consuming caller input.
    // A missing exact-source policy is a configuration failure, not permission
    // to buffer an otherwise untrusted request body.
    const sourceIntegrationPolicy = requireActiveSourceIntegrationPolicy();
    const request = context.request;
    if (isAbortSignalAborted(signal)) throw getAbortReason(signal);
    if (!request?.body) {
      return {
        body: null,
        sourceIntegrationPolicy,
      };
    }

    let pendingBody = this.preparedRequestBodies.get(request);
    if (!pendingBody) {
      // Page and layout data jobs share the same Request. Reading it once avoids
      // locking failures and gives the request one body-preparation lifecycle.
      pendingBody = this.readIsolatedRequestBody(request, signal);
      this.preparedRequestBodies.set(request, pendingBody);
    }

    const body = await pendingBody;
    return { body, sourceIntegrationPolicy };
  }

  private async readIsolatedRequestBody(
    request: Request,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    try {
      return await readBodyBytesWithLimit(request, MAX_WORKER_BODY_BYTES, {
        signal,
      });
    } catch (error) {
      if (!isRequestBodyTooLargeError(error)) throw error;

      const actualSize = getRejectedBodySize(error);
      const actualSizeLabel = actualSize !== undefined && Number.isFinite(actualSize)
        ? `${(actualSize / 1024 / 1024).toFixed(1)} MB, `
        : "";
      throw INPUT_VALIDATION_FAILED.create({
        message: `Request body too large for isolated data fetch (${actualSizeLabel}limit ${
          MAX_WORKER_BODY_BYTES / 1024 / 1024
        } MB)`,
        detail: error.detail,
        cause: error,
        context: error.context,
        status: error.status,
      });
    }
  }

  /**
   * Execute getServerData in a per-project Worker.
   */
  private async fetchIsolated(
    modulePath: string,
    projectDir: string,
    context: DataContext,
    prepared: PreparedIsolatedRequest,
    generationIdentity?: Readonly<WorkerGenerationIdentity>,
  ): Promise<DataResult> {
    const pool = getWorkerPool();
    const generation = await resolveWorkerGeneration(
      "data",
      generationIdentity,
    );
    let workerResponse: WorkerResponse;
    try {
      workerResponse = await pool.execute(
        generation.workerId,
        [projectDir],
        {
          type: "fetch-data",
          id: crypto.randomUUID(),
          modulePath,
          context: {
            params: context.params,
            query: context.query?.toString() ?? "",
            request: {
              url: context.request?.url ??
                context.url?.toString() ??
                "http://localhost",
              method: context.request?.method ?? "GET",
              headers: context.request ? [...context.request.headers.entries()] : [],
              body: prepared.body,
            },
            url: context.url?.toString() ?? "http://localhost",
          },
          sourceIntegrationPolicy: prepared.sourceIntegrationPolicy,
        },
      );
    } catch (error) {
      // Only host-side pool shedding is dependency-neutral. Project errors
      // arrive as WorkerResponse errors and must still affect circuit health.
      if (isServiceOverload(error)) localWorkerOverloads.add(error);
      throw error;
    } finally {
      if (!generation.reusable) {
        pool.evictWorker(generation.workerId);
      }
    }

    if (workerResponse.type === "error") {
      throw deserializeWorkerError(workerResponse.error);
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
