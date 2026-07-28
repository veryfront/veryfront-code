import type { PageWithData, StaticPathsResult } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { type Span, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { getAbortReason, isCallerAbort, raceWithCallerAbort } from "./abort-utils.ts";
import {
  type DataExecutionAdmission,
  defaultDataExecutionAdmission,
} from "./execution-admission.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { requireDataProjectId } from "./project-identity.ts";

function createEmptyStaticPathsResult(): StaticPathsResult {
  return { paths: [], fallback: false };
}

function validateStaticPathsResult(value: unknown): StaticPathsResult {
  const fail = (): never => {
    throw new TypeError("getStaticPaths must return a valid static paths result object");
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail();
  }

  const result = value as Record<string, unknown>;
  // Snapshot application-controlled accessors once and return plain data.
  // Otherwise a getter can pass validation and expose a different shape to
  // the renderer immediately afterwards.
  const paths = result.paths;
  const fallback = result.fallback;
  if (!Array.isArray(paths)) return fail();
  if (
    fallback !== false &&
    fallback !== true &&
    fallback !== "blocking"
  ) {
    return fail();
  }

  const pathCount = paths.length;
  const normalizedPaths: StaticPathsResult["paths"] = new Array(pathCount);
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
    const path = paths[pathIndex];
    if (path === null || typeof path !== "object" || Array.isArray(path)) {
      return fail();
    }
    const params = (path as Record<string, unknown>).params;
    if (params === null || typeof params !== "object" || Array.isArray(params)) {
      return fail();
    }
    const normalizedParams: Record<string, string | string[]> = {};
    for (const key of Object.keys(params)) {
      const param = (params as Record<string, unknown>)[key];
      let normalizedParam: string | string[];
      if (typeof param === "string") {
        normalizedParam = param;
      } else {
        if (!Array.isArray(param)) return fail();

        // Read the length and every segment exactly once. Array accessors and
        // proxies must not validate one graph and publish another, and sparse
        // arrays must not turn skipped validation slots into `undefined`.
        const segmentCount = param.length;
        normalizedParam = new Array<string>(segmentCount);
        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
          const segment = param[segmentIndex];
          if (typeof segment !== "string") return fail();
          normalizedParam[segmentIndex] = segment;
        }
      }

      // Assignment to the magic `__proto__` name invokes Object.prototype's
      // setter instead of creating a route parameter. Define every key as an
      // ordinary own data property so all valid parameter names survive.
      Object.defineProperty(normalizedParams, key, {
        configurable: true,
        enumerable: true,
        value: normalizedParam,
        writable: true,
      });
    }
    normalizedPaths[pathIndex] = { params: normalizedParams };
  }

  return {
    paths: normalizedPaths,
    fallback,
  };
}

export interface StaticPathsFetcherOptions {
  timeoutMs?: number;
  /** @internal Shared process admission; injectable for embedded runtimes and tests. */
  executionAdmission?: DataExecutionAdmission;
}

export interface StaticPathsFetchOptions {
  /** Trusted project identity used to isolate execution capacity. */
  projectId?: string;
  /** Caller cancellation detaches the waiter without cancelling project code. */
  signal?: AbortSignal;
}

export class StaticPathsFetcher {
  private readonly timeoutMs: number | undefined;
  private readonly executionAdmission: DataExecutionAdmission;

  constructor(options: StaticPathsFetcherOptions = {}) {
    this.executionAdmission = options.executionAdmission ??
      defaultDataExecutionAdmission;
    const timeoutMs = options.timeoutMs;
    if (timeoutMs === undefined || timeoutMs === 0) {
      this.timeoutMs = undefined;
      return;
    }
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_TIMER_DELAY_MS
    ) {
      throw new RangeError(
        `Static paths timeout must be zero or a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`,
      );
    }
    this.timeoutMs = timeoutMs;
  }

  fetch(
    pageModule: PageWithData,
    options?: StaticPathsFetchOptions,
  ): Promise<StaticPathsResult | null> {
    let suppliedProjectId: string | undefined;
    let callerSignal: AbortSignal | undefined;
    try {
      const rawProjectId = options?.projectId;
      suppliedProjectId = rawProjectId === undefined
        ? undefined
        : requireDataProjectId(rawProjectId);
      callerSignal = options?.signal;
    } catch (error) {
      return Promise.reject(error);
    }

    let getStaticPaths: PageWithData["getStaticPaths"];
    try {
      getStaticPaths = pageModule.getStaticPaths;
    } catch (error) {
      return Promise.reject(error);
    }
    if (typeof getStaticPaths !== "function") {
      return Promise.resolve(null);
    }

    if (callerSignal?.aborted) {
      return Promise.reject(getAbortReason(callerSignal));
    }
    let projectId: string;
    try {
      projectId = requireDataProjectId(
        suppliedProjectId ??
          tryGetCacheKeyContext()?.projectId ??
          "default",
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const projectKey = hashString(projectId);

    return withSpan(
      SpanNames.DATA_FETCH_STATIC_PATHS,
      async (span?: Span) => {
        const startedAt = performance.now();
        let releaseAdmission: (() => void) | undefined;
        let producerOwnsAdmission = false;
        try {
          releaseAdmission = this.executionAdmission.acquire(projectId);
          const producer = Promise.resolve()
            .then(() => getStaticPaths())
            .then((result) => {
              this.throwIfExpired(startedAt);
              const validated = result == null
                ? createEmptyStaticPathsResult()
                : validateStaticPathsResult(result);
              this.throwIfExpired(startedAt);
              return validated;
            });

          // A framework timeout or caller disconnect only stops waiting. The
          // process capacity lease belongs to the raw hook and its validation.
          void producer.then(releaseAdmission, releaseAdmission);
          producerOwnsAdmission = true;

          const finalResult = this.timeoutMs === undefined
            ? await raceWithCallerAbort(producer, callerSignal)
            : await withTimeoutThrow(
              producer,
              this.timeoutMs,
              "getStaticPaths",
              { signal: callerSignal },
            );

          span?.setAttribute("data.paths_count", finalResult.paths?.length ?? 0);
          span?.setAttribute("data.fallback", String(finalResult.fallback ?? false));

          return finalResult;
        } catch (caughtError) {
          // Exact caller cancellation is never dependency failure or timeout
          // telemetry, even if it races the local deadline at the boundary.
          if (isCallerAbort(caughtError, callerSignal)) {
            throw caughtError;
          }
          const error = this.timeoutMs !== undefined &&
              !(caughtError instanceof TimeoutError) &&
              performance.now() - startedAt >= this.timeoutMs
            ? new TimeoutError("getStaticPaths", this.timeoutMs)
            : caughtError;
          if (
            !producerOwnsAdmission &&
            error instanceof VeryfrontError &&
            error.slug === SERVICE_OVERLOADED.slug
          ) {
            serverLogger.warn(
              "DATA_FETCH_STATIC_PATHS_REJECTED execution capacity exhausted",
              { projectKey },
            );
            throw error;
          }
          if (error instanceof TimeoutError) {
            serverLogger.error("DATA_FETCH_STATIC_PATHS_TIMEOUT getStaticPaths timed out", {
              timeoutMs: this.timeoutMs,
            });
            throw error;
          }
          serverLogger.error("DATA_FETCH_STATIC_PATHS_ERROR getStaticPaths failed", {}, error);
          throw error;
        } finally {
          if (!producerOwnsAdmission) releaseAdmission?.();
        }
      },
      {
        "data.fetch_method": "getStaticPaths",
        "data.project_key": projectKey,
      },
    );
  }

  private throwIfExpired(startedAt: number): void {
    if (
      this.timeoutMs !== undefined &&
      performance.now() - startedAt >= this.timeoutMs
    ) {
      throw new TimeoutError("getStaticPaths", this.timeoutMs);
    }
  }
}
