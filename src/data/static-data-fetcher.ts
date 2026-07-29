import {
  type CacheManager,
  dataCacheKeyMatches,
  type DataCacheMatchOptions,
  type DataCacheScope,
  snapshotDataCacheScope,
} from "./data-fetching-cache.ts";
import {
  cloneStaticDataContext,
  isDataControlResult,
  toDataControlResult,
  validateDataResult,
} from "./helpers.ts";
import type { CacheEntry, DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { getSemaphore, type Semaphore } from "#veryfront/utils/semaphore.ts";
import {
  MAX_CONCURRENT_REVALIDATIONS,
  REVALIDATION_PER_PROJECT_LIMIT,
  REVALIDATION_TIMEOUT_MS,
} from "#veryfront/utils/constants/cache.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import {
  type DataExecutionAdmission,
  defaultDataExecutionAdmission,
} from "./execution-admission.ts";
import { SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { requireDataProjectId } from "./project-identity.ts";
import {
  snapshotWorkerGenerationIdentity,
  type WorkerGenerationIdentity,
} from "#veryfront/security/sandbox/worker-generation.ts";

/** Semaphore to limit concurrent revalidations and prevent resource exhaustion */
const revalidationSemaphore = getSemaphore("revalidation", MAX_CONCURRENT_REVALIDATIONS, {
  acquireTimeoutMs: 5000, // Don't wait more than 5s for a permit
});

/**
 * Per-project revalidation tracking for multi-tenant fairness.
 * Prevents one project with many stale entries from starving other projects.
 *
 * Bounded in practice: an entry is created on slot acquire and deleted in
 * releaseRevalidationSlot once its count returns to 0, so the map only holds
 * projects with in-flight revalidations. Its high-water mark is the number of
 * projects revalidating concurrently, not the total number of projects seen.
 */
const projectRevalidationCounts = new Map<string, number>();
const DEFAULT_REVALIDATION_FAILURE_RETRY_MS = 30_000;

function getStaticDataCircuitBreaker(breakerName: string) {
  return getCircuitBreaker(breakerName, {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    successThreshold: 2,
  });
}

function getStaticDataCircuitBreakerName(
  projectId: string,
  scope: Readonly<DataCacheScope> | null,
  workerGeneration: Readonly<WorkerGenerationIdentity> | undefined,
): string {
  let sourceKey: string;
  if (scope) {
    sourceKey = `scope:${
      hashString(
        `${scope.mode.length}:${scope.mode}${scope.versionId.length}:${scope.versionId}`,
      )
    }`;
  } else if (workerGeneration !== undefined) {
    sourceKey = `generation:${
      hashString(
        `${workerGeneration.scopeId.length}:${workerGeneration.scopeId}${workerGeneration.generationId.length}:${workerGeneration.generationId}`,
      )
    }`;
  } else {
    sourceKey = "unversioned";
  }

  return `static-data-fetch:v2:${hashString(projectId)}:${sourceKey}`;
}

/** Acquire a revalidation slot for a project (returns false if at per-project limit) */
function acquireRevalidationSlot(projectId: string, limit: number): boolean {
  const current = projectRevalidationCounts.get(projectId) ?? 0;
  if (limit > 0 && current >= limit) return false;

  // A zero limit disables admission rejection, not accounting. Every
  // successful acquisition must have a matching release even when fetcher
  // instances with different limits share the process-level project map.
  projectRevalidationCounts.set(projectId, current + 1);
  return true;
}

/** Release a revalidation slot for a project */
function releaseRevalidationSlot(projectId: string): void {
  const current = projectRevalidationCounts.get(projectId) ?? 0;

  if (current <= 1) {
    projectRevalidationCounts.delete(projectId);
    return;
  }

  projectRevalidationCounts.set(projectId, current - 1);
}

type StaticDataHandler = NonNullable<PageWithData["getStaticData"]>;

interface CacheWriteToken {
  readonly cacheKey: string;
  valid: boolean;
  expectedEntry: CacheEntry | null;
}

interface PendingCacheWrite<T> {
  readonly token: CacheWriteToken;
  readonly promise: Promise<T>;
}

interface ProducerSettlement {
  readonly settled: Promise<void>;
  settle(): void;
}

function createProducerSettlement(): ProducerSettlement {
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  let complete = false;

  return {
    settled,
    settle(): void {
      if (complete) return;
      complete = true;
      resolveSettled();
    },
  };
}

export interface StaticDataFetchOptions {
  /** Non-empty module identity required for static cache lookup and publication. */
  modulePath?: string;
  /** Trusted project identity for circuit-breaker and fairness isolation */
  projectId?: string;
  /** Explicit immutable cache scope; null deliberately disables caching. */
  cacheScope?: DataCacheScope | null;
  /** @internal Host-owned source lifetime scope; paired with workerGenerationId. */
  workerScopeId?: string;
  /** @internal Immutable source identity; paired with workerScopeId. */
  workerGenerationId?: string;
}

export interface StaticDataFetcherOptions {
  /** Override the process default. Used by embedded runtimes and deterministic tests. */
  revalidationPerProjectLimit?: number;
  /** Minimum delay after a failed background refresh. */
  revalidationFailureRetryMs?: number;
  /** @internal Process execution budget shared with server data hooks. */
  executionAdmission?: DataExecutionAdmission;
  /** @internal Deterministic seam for the process-wide revalidation budget. */
  revalidationSemaphore?: Semaphore;
}

export class StaticDataFetcher {
  private pendingRevalidations = new Map<string, PendingCacheWrite<void>>();
  private pendingFetches = new Map<string, PendingCacheWrite<DataResult>>();
  private activeCacheWrites = new Set<CacheWriteToken>();
  private readonly revalidationPerProjectLimit: number;
  private readonly revalidationFailureRetryMs: number;
  private readonly executionAdmission: DataExecutionAdmission;
  private readonly revalidationSemaphore: Semaphore;

  constructor(
    private cacheManager: CacheManager,
    options: StaticDataFetcherOptions = {},
  ) {
    const limit = options.revalidationPerProjectLimit ?? REVALIDATION_PER_PROJECT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("revalidationPerProjectLimit must be a non-negative safe integer");
    }
    this.revalidationPerProjectLimit = limit;

    const retryMs = options.revalidationFailureRetryMs ??
      DEFAULT_REVALIDATION_FAILURE_RETRY_MS;
    if (!Number.isSafeInteger(retryMs) || retryMs < 0) {
      throw new RangeError("revalidationFailureRetryMs must be a non-negative safe integer");
    }
    this.revalidationFailureRetryMs = retryMs;
    this.executionAdmission = options.executionAdmission ??
      defaultDataExecutionAdmission;
    this.revalidationSemaphore = options.revalidationSemaphore ??
      revalidationSemaphore;
  }

  async fetch(
    pageModule: PageWithData,
    context: DataContext,
    options: StaticDataFetchOptions = {},
  ): Promise<DataResult> {
    const rawProjectId = options.projectId;
    const suppliedProjectId = rawProjectId === undefined
      ? undefined
      : requireDataProjectId(rawProjectId);
    const workerGeneration = snapshotWorkerGenerationIdentity(
      options.workerScopeId,
      options.workerGenerationId,
    );
    const getStaticData = pageModule.getStaticData;
    if (typeof getStaticData !== "function") return { props: {} };
    const suppliedScope = options.cacheScope;
    const modulePath = options.modulePath;
    const rawAmbientScope = tryGetCacheKeyContext();
    const ambientScope = rawAmbientScope === null ? null : snapshotDataCacheScope(rawAmbientScope);
    const rawScope = suppliedScope === undefined ? ambientScope : suppliedScope;
    const authoritativeScope = rawScope === null ? null : snapshotDataCacheScope(rawScope);
    if (
      authoritativeScope &&
      suppliedProjectId !== undefined &&
      suppliedProjectId !== authoritativeScope.projectId
    ) {
      throw new TypeError(
        "Static data projectId must match the authoritative cache scope projectId",
      );
    }
    const trustedProjectId = suppliedProjectId ??
      authoritativeScope?.projectId ??
      ambientScope?.projectId;

    // Snapshot every mutable identity field before the first await. The
    // caller retains its context object and may reuse or mutate it as soon as
    // fetch() returns; deriving a key now but cloning only inside the deferred
    // loader could publish data computed for a different request under that
    // original key.
    const requestContext: DataContext = {
      ...context,
      ...cloneStaticDataContext(context),
    };

    const pathname = requestContext.url.pathname;
    // Fairness and circuit identity must come from a trusted option or cache
    // scope. Request headers, hostnames, and URLs are caller-controlled and
    // could otherwise be rotated to bypass per-project limits.
    const projectId = trustedProjectId ?? "default";
    const breakerName = getStaticDataCircuitBreakerName(
      projectId,
      authoritativeScope,
      workerGeneration,
    );
    const cacheKey = this.cacheManager.createCacheKey(
      requestContext,
      modulePath,
      authoritativeScope,
    );

    // No caching in preview mode (cacheKey is null)
    if (!cacheKey) {
      return withSpan(
        "data.fetch_static",
        () =>
          this.fetchFreshNoCache(
            getStaticData,
            requestContext,
            projectId,
            breakerName,
          ),
        {
          "data.fetch_method": "getStaticData",
          "data.pathname": pathname,
          "data.cache": "disabled",
        },
      );
    }

    // Register before the first await so clearCache() is a true barrier even
    // when it runs before the cache lookup or loader microtask resumes.
    const token = this.beginCacheWrite(cacheKey);
    let cached: CacheEntry | null;
    try {
      cached = await withSpan(
        SpanNames.DATA_CACHE_GET,
        () => Promise.resolve(this.cacheManager.get(cacheKey)),
        { "data.pathname": pathname },
      );
    } catch (error) {
      this.releaseCacheWrite(token);
      throw error;
    }
    token.expectedEntry = cached;

    if (!cached) {
      return withSpan(
        "data.fetch_static",
        () =>
          this.fetchFreshSingleFlight(
            getStaticData,
            requestContext,
            projectId,
            breakerName,
            token,
          ),
        {
          "data.fetch_method": "getStaticData",
          "data.pathname": pathname,
          "data.cache": "miss",
        },
      );
    }

    if (this.cacheManager.shouldRevalidate(cached)) {
      this.startBackgroundRevalidation(
        getStaticData,
        requestContext,
        projectId,
        breakerName,
        token,
      );
    } else {
      this.releaseCacheWrite(token);
    }

    return cached.data;
  }

  private createStaticDataContext(
    context: DataContext,
  ): Omit<DataContext, "request" | "query"> {
    return cloneStaticDataContext(context);
  }

  private beginCacheWrite(cacheKey: string): CacheWriteToken {
    const token: CacheWriteToken = {
      cacheKey,
      valid: true,
      expectedEntry: null,
    };
    this.activeCacheWrites.add(token);
    return token;
  }

  private releaseCacheWrite(token: CacheWriteToken): void {
    token.valid = false;
    this.activeCacheWrites.delete(token);
  }

  private isCacheWriteActive(token: CacheWriteToken): boolean {
    return token.valid && this.activeCacheWrites.has(token);
  }

  private executeStaticData(
    getStaticData: StaticDataHandler,
    context: DataContext,
    timeoutMs: number,
    label: string,
    onProducerSettled?: () => void,
  ): Promise<DataResult> {
    const startedAt = performance.now();
    const producer = Promise.resolve()
      .then(() => getStaticData(this.createStaticDataContext(context)))
      .then((result) => {
        if (performance.now() - startedAt >= timeoutMs) {
          throw new TimeoutError(label, timeoutMs);
        }
        const validated = validateDataResult(result, "getStaticData");
        if (performance.now() - startedAt >= timeoutMs) {
          throw new TimeoutError(label, timeoutMs);
        }
        return validated;
      }, (error) => {
        if (
          !(error instanceof TimeoutError) &&
          performance.now() - startedAt >= timeoutMs
        ) {
          throw new TimeoutError(label, timeoutMs);
        }
        // `throw notFound()` / `throw redirect(...)`: treat a thrown control
        // result exactly like a returned one. Normalising here keeps a routing
        // decision outside dependency failure accounting.
        if (isDataControlResult(error)) {
          const control = validateDataResult(error, "getStaticData");
          if (performance.now() - startedAt >= timeoutMs) {
            throw new TimeoutError(label, timeoutMs);
          }
          return toDataControlResult(control);
        }
        throw error;
      });

    if (onProducerSettled) {
      void producer.then(onProducerSettled, onProducerSettled);
    }

    return withTimeoutThrow(
      producer,
      timeoutMs,
      label,
    ).catch((error) => {
      if (
        !(error instanceof TimeoutError) &&
        performance.now() - startedAt >= timeoutMs
      ) {
        throw new TimeoutError(label, timeoutMs);
      }
      throw error;
    });
  }

  private storeCacheEntry(
    result: DataResult,
    token: CacheWriteToken,
  ): void {
    if (!this.isCacheWriteActive(token)) return;
    this.cacheManager.replaceIfCurrent(token.cacheKey, token.expectedEntry, {
      data: result,
      timestamp: Date.now(),
      revalidate: result.revalidate,
    });
  }

  private deferRevalidation(
    token: CacheWriteToken,
  ): void {
    if (!this.isCacheWriteActive(token) || token.expectedEntry === null) return;
    this.cacheManager.deferRevalidationIfCurrent(
      token.cacheKey,
      token.expectedEntry,
      this.revalidationFailureRetryMs,
    );
  }

  private async fetchFreshNoCache(
    getStaticData: StaticDataHandler,
    context: DataContext,
    projectId: string,
    breakerName: string,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname ?? "unknown";
    const start = performance.now();

    let releaseAdmission: (() => void) | undefined;
    let producerOwnsAdmission = false;
    try {
      releaseAdmission = this.executionAdmission.acquire(projectId);
      return await getStaticDataCircuitBreaker(breakerName).execute(() => {
        const execution = this.executeStaticData(
          getStaticData,
          context,
          DATA_FETCH_TIMEOUT_MS,
          `getStaticData for ${pathname}`,
          releaseAdmission,
        );
        producerOwnsAdmission = true;
        return execution;
      });
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      if (
        !producerOwnsAdmission &&
        error instanceof VeryfrontError &&
        error.slug === SERVICE_OVERLOADED.slug
      ) {
        serverLogger.warn("DATA_FETCH_REJECTED execution capacity exhausted", {
          pathname,
        });
        throw error;
      }

      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getStaticData timed out", {
          pathname,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
        });
        throw error;
      }

      if (error instanceof CircuitBreakerOpen) {
        serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
          pathname,
          projectKey: hashString(projectId),
          retryAfterMs: error.nextAttemptMs,
        });
        throw error;
      }

      this.logError("DATA_FETCH_ERROR getStaticData failed", error, { pathname, durationMs });
      throw error;
    } finally {
      if (!producerOwnsAdmission) releaseAdmission?.();
    }
  }

  private async fetchFresh(
    getStaticData: StaticDataHandler,
    context: DataContext,
    projectId: string,
    breakerName: string,
    token: CacheWriteToken,
    producerSettlement: ProducerSettlement,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname ?? "unknown";
    const start = performance.now();
    const projectKey = hashString(projectId);
    let releaseAdmission: (() => void) | undefined;
    let producerOwnsAdmission = false;
    let producerHasSettled = false;

    try {
      releaseAdmission = this.executionAdmission.acquire(projectId);

      const result = await getStaticDataCircuitBreaker(breakerName).execute(() => {
        const settleProducer = (): void => {
          producerHasSettled = true;
          producerSettlement.settle();
        };
        const execution = this.executeStaticData(
          getStaticData,
          context,
          DATA_FETCH_TIMEOUT_MS,
          `getStaticData for ${pathname}`,
          settleProducer,
        );
        producerOwnsAdmission = true;
        return execution;
      });

      try {
        await withSpan(
          SpanNames.DATA_CACHE_SET,
          () => {
            this.storeCacheEntry(result, token);
            return Promise.resolve();
          },
          { "data.revalidate": result.revalidate ?? 0 },
        );
      } catch (error) {
        // Cache capacity or value-estimation limits must not turn valid
        // project data into an application outage. The caller receives the
        // fresh result and a later request may retry uncached.
        this.logError("DATA_CACHE_SET_ERROR static data was not cached", error, {
          pathname,
        });
      }

      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      if (
        !producerOwnsAdmission &&
        error instanceof VeryfrontError &&
        error.slug === SERVICE_OVERLOADED.slug
      ) {
        serverLogger.warn("DATA_FETCH_REJECTED execution capacity exhausted", {
          pathname,
          projectKey,
        });
        throw error;
      }

      if (error instanceof CircuitBreakerOpen) {
        serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
          pathname,
          projectKey,
          retryAfterMs: error.nextAttemptMs,
        });
        throw error;
      }

      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getStaticData timed out", {
          pathname,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
        });
        throw error;
      }

      this.logError("DATA_FETCH_ERROR getStaticData failed", error, {
        pathname,
        durationMs,
      });
      throw error;
    } finally {
      if (!producerOwnsAdmission) {
        releaseAdmission?.();
        producerSettlement.settle();
      } else if (producerHasSettled) {
        // Successful work retains its lease through cache publication and any
        // project-controlled property traversal performed by size estimation.
        releaseAdmission?.();
      } else {
        // A timeout-facing caller may leave non-cooperative project code
        // running. Release only when that raw producer and validation settle.
        void producerSettlement.settled.then(() => releaseAdmission?.());
      }
    }
  }

  private fetchFreshSingleFlight(
    getStaticData: StaticDataHandler,
    context: DataContext,
    projectId: string,
    breakerName: string,
    token: CacheWriteToken,
  ): Promise<DataResult> {
    const cacheKey = token.cacheKey;
    const existing = this.pendingFetches.get(cacheKey);
    if (existing && this.isCacheWriteActive(existing.token)) {
      this.releaseCacheWrite(token);
      return existing.promise;
    }
    if (existing && this.pendingFetches.get(cacheKey) === existing) {
      this.pendingFetches.delete(cacheKey);
    }

    const producerSettlement = createProducerSettlement();

    // Defer user code until the marker is installed. Synchronous handlers
    // would otherwise finish before a concurrent request can observe it.
    const pending = Promise.resolve().then(() =>
      this.fetchFresh(
        getStaticData,
        context,
        projectId,
        breakerName,
        token,
        producerSettlement,
      )
    );

    // A pre-clear lookup may resume after invalidation. Its original caller
    // still receives the loader result, but publishing its invalid marker
    // would make a post-clear request join obsolete work.
    if (!this.isCacheWriteActive(token)) {
      const cleanupDetached = (): void => this.releaseCacheWrite(token);
      void pending.then(cleanupDetached, cleanupDetached);
      return pending;
    }

    const record: PendingCacheWrite<DataResult> = { token, promise: pending };
    this.pendingFetches.set(cacheKey, record);

    const cleanup = (): void => {
      if (this.pendingFetches.get(cacheKey) === record) {
        this.pendingFetches.delete(cacheKey);
      }
      this.releaseCacheWrite(token);
    };
    void Promise.allSettled([
      pending,
      producerSettlement.settled,
    ]).then(cleanup);

    return pending;
  }

  private startBackgroundRevalidation(
    getStaticData: StaticDataHandler,
    context: DataContext,
    projectId: string,
    breakerName: string,
    token: CacheWriteToken,
  ): void {
    const cacheKey = token.cacheKey;
    const existing = this.pendingRevalidations.get(cacheKey);
    if (existing && this.isCacheWriteActive(existing.token)) {
      this.releaseCacheWrite(token);
      return;
    }
    if (existing && this.pendingRevalidations.get(cacheKey) === existing) {
      this.pendingRevalidations.delete(cacheKey);
    }
    if (!this.isCacheWriteActive(token) || token.expectedEntry === null) {
      this.releaseCacheWrite(token);
      return;
    }

    const producerSettlement = createProducerSettlement();

    // Install the marker before the async work starts. In particular, a
    // per-project-limit rejection may complete synchronously.
    const pending = Promise.resolve()
      .then(() =>
        this.revalidateInBackground(
          getStaticData,
          context,
          projectId,
          breakerName,
          token,
          producerSettlement,
        )
      )
      .catch((error) => {
        this.logError(
          "DATA_REVALIDATION_ERROR unexpected background revalidation failure",
          error,
          { pathname: context.url?.pathname ?? "unknown" },
        );
      });
    const record: PendingCacheWrite<void> = { token, promise: pending };
    this.pendingRevalidations.set(cacheKey, record);

    const cleanup = (): void => {
      if (this.pendingRevalidations.get(cacheKey) === record) {
        this.pendingRevalidations.delete(cacheKey);
      }
      this.releaseCacheWrite(token);
    };
    void Promise.allSettled([
      pending,
      producerSettlement.settled,
    ]).then(cleanup);
  }

  private async revalidateInBackground(
    getStaticData: StaticDataHandler,
    context: DataContext,
    projectId: string,
    breakerName: string,
    token: CacheWriteToken,
    producerSettlement: ProducerSettlement,
  ): Promise<void> {
    const pathname = context.url?.pathname ?? "unknown";
    const projectKey = hashString(projectId);

    // Check per-project limit before acquiring global semaphore
    if (!acquireRevalidationSlot(projectId, this.revalidationPerProjectLimit)) {
      serverLogger.debug("DATA_REVALIDATION_SKIPPED per-project limit reached", {
        pathname,
        projectKey,
        limit: this.revalidationPerProjectLimit,
      });
      producerSettlement.settle();
      return;
    }

    let releaseExecution: (() => void) | undefined;
    let producerOwnsAdmission = false;
    try {
      await this.revalidationSemaphore.acquire(async () => {
        const start = performance.now();

        // Waiting for the lower-priority revalidation semaphore must not
        // consume execution capacity needed by foreground data hooks.
        // Acquire the shared execution lease only when this refresh can
        // dispatch its producer immediately. Keep admission rejection outside
        // the dependency-error handler so expected capacity pressure is
        // classified by the outer catch.
        releaseExecution = this.executionAdmission.acquire(projectId);
        try {
          const result = await getStaticDataCircuitBreaker(breakerName).execute(
            () => {
              const settleProducer = (): void => {
                producerSettlement.settle();
              };
              const execution = this.executeStaticData(
                getStaticData,
                context,
                REVALIDATION_TIMEOUT_MS,
                `getStaticData revalidation for ${pathname}`,
                settleProducer,
              );
              producerOwnsAdmission = true;
              return execution;
            },
          );

          // A background revalidation refreshes a page that is already being
          // served. A notFound or redirect is not a refreshed page, so keep
          // the entry that is live and let the next revalidation try again.
          // Storing it would serve a 404 for the previously healthy page, and
          // a control result carries no revalidate interval, so the entry
          // would never revalidate again either.
          if (result.notFound || result.redirect) {
            this.deferRevalidation(token);
            serverLogger.warn(
              "DATA_REVALIDATION_CONTROL_RESULT background revalidation returned a control result, keeping the cached entry",
              {
                pathname,
                durationMs: Math.round(performance.now() - start),
                control: result.notFound ? "notFound" : "redirect",
              },
            );
            return;
          }

          this.storeCacheEntry(result, token);
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof TimeoutError) {
            this.deferRevalidation(token);
            serverLogger.error("DATA_REVALIDATION_TIMEOUT background revalidation timed out", {
              pathname,
              durationMs,
              timeoutMs: REVALIDATION_TIMEOUT_MS,
            });
            return;
          }

          if (error instanceof CircuitBreakerOpen) {
            this.deferRevalidation(token);
            serverLogger.warn(
              "DATA_REVALIDATION_CIRCUIT_OPEN circuit breaker open, keeping the cached entry",
              {
                pathname,
                projectKey,
                retryAfterMs: error.nextAttemptMs,
              },
            );
            return;
          }

          this.deferRevalidation(token);
          this.logError("DATA_REVALIDATION_ERROR background revalidation failed", error, {
            pathname,
            durationMs,
          });
        } finally {
          // The timeout-facing revalidation has finished reporting, but
          // non-cooperative project code may still be running. Keep the
          // process-wide permit aligned with the same raw-producer lifetime as
          // the execution and per-project admissions.
          if (producerOwnsAdmission) {
            await producerSettlement.settled;
          }
        }
      });
    } catch (error) {
      this.deferRevalidation(token);
      if (
        error instanceof VeryfrontError &&
        error.slug === SERVICE_OVERLOADED.slug
      ) {
        serverLogger.warn("DATA_REVALIDATION_SKIPPED execution capacity exhausted", {
          pathname,
          projectKey,
        });
      } else {
        // Expected when too many concurrent revalidations exhaust the bounded
        // semaphore wait budget.
        serverLogger.warn("DATA_REVALIDATION_SKIPPED semaphore timeout", {
          pathname,
          activeRevalidations: this.revalidationSemaphore.active,
          waitingRevalidations: this.revalidationSemaphore.waitingCount,
        });
      }
    } finally {
      // If a producer started, the semaphore callback above did not return
      // until its raw lifetime ended; successful cache publication also
      // completed before this point. Admission and per-project accounting
      // therefore cover the complete background operation.
      releaseExecution?.();
      releaseRevalidationSlot(projectId);
      producerSettlement.settle();
    }
  }

  /**
   * Log errors unconditionally. Production errors should always be logged
   * for debugging and monitoring purposes.
   *
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    // Always log errors - silent failures hide production bugs
    serverLogger.error(message, context ?? {}, error);
  }

  /**
   * Prevent cache work that began before an explicit invalidation from
   * restoring stale values after the cache has been cleared.
   */
  invalidatePendingCacheWrites(
    options: DataCacheMatchOptions = {},
  ): void {
    const matches = (cacheKey: string): boolean => dataCacheKeyMatches(cacheKey, options);

    for (const token of this.activeCacheWrites) {
      if (matches(token.cacheKey)) token.valid = false;
    }
    for (const cacheKey of this.pendingFetches.keys()) {
      if (matches(cacheKey)) this.pendingFetches.delete(cacheKey);
    }
    for (const cacheKey of this.pendingRevalidations.keys()) {
      if (matches(cacheKey)) this.pendingRevalidations.delete(cacheKey);
    }
  }
}
