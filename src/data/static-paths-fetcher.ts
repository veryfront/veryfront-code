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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(record: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("getStaticPaths must return a valid static paths result object");
  }
  return descriptor.value;
}

class StaticPathsLimitError extends RangeError {}

interface StaticPathsSnapshotLimits {
  readonly maxPaths?: number;
  readonly maxArrayParamSegments?: number;
}

function snapshotDenseArray(
  value: unknown,
  maxLength?: number,
  limitDescription?: string,
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("getStaticPaths must return a valid static paths result object");
  }

  const rawLength = ownDataValue(value, "length");
  if (!Number.isSafeInteger(rawLength) || (rawLength as number) < 0) {
    throw new TypeError("getStaticPaths must return a valid static paths result object");
  }
  const length = rawLength as number;
  if (maxLength !== undefined && length > maxLength) {
    throw new StaticPathsLimitError(
      `getStaticPaths ${limitDescription ?? "arrays"} support at most ${
        maxLength.toLocaleString("en-US")
      } ${limitDescription === "paths" ? "paths" : "segments"}`,
    );
  }
  const snapshot = new Array<unknown>(length);
  let indexCount = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new TypeError("getStaticPaths must return a valid static paths result object");
    }
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      throw new TypeError("getStaticPaths must return a valid static paths result object");
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("getStaticPaths must return a valid static paths result object");
    }
    snapshot[index] = descriptor.value;
    indexCount++;
  }
  if (indexCount !== length) {
    throw new TypeError("getStaticPaths must return a valid static paths result object");
  }
  return snapshot;
}

function validateStaticPathsResult(
  value: unknown,
  limits: StaticPathsSnapshotLimits,
): StaticPathsResult {
  const fail = (): never => {
    throw new TypeError("getStaticPaths must return a valid static paths result object");
  };
  if (!isPlainRecord(value)) return fail();

  // Inspect descriptors rather than reading fields. Build hooks are an
  // application-controlled boundary; getters must be rejected without being
  // invoked, otherwise validation itself can run hidden code or return a
  // different graph on each read.
  let paths: unknown[];
  let fallback: unknown;
  try {
    paths = snapshotDenseArray(ownDataValue(value, "paths"), limits.maxPaths, "paths");
    fallback = ownDataValue(value, "fallback");
  } catch (error) {
    if (error instanceof StaticPathsLimitError) throw error;
    return fail();
  }
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
    if (!isPlainRecord(path)) return fail();
    let params: unknown;
    try {
      params = ownDataValue(path, "params");
    } catch {
      return fail();
    }
    if (!isPlainRecord(params)) return fail();
    const normalizedParams: Record<string, string | string[]> = {};
    for (const key of Reflect.ownKeys(params)) {
      if (typeof key !== "string") return fail();
      const descriptor = Reflect.getOwnPropertyDescriptor(params, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
      const param = descriptor.value;
      let normalizedParam: string | string[];
      if (typeof param === "string") {
        normalizedParam = param;
      } else {
        let segments: unknown[];
        try {
          segments = snapshotDenseArray(
            param,
            limits.maxArrayParamSegments,
            "catch-all parameters",
          );
        } catch (error) {
          if (error instanceof StaticPathsLimitError) throw error;
          return fail();
        }
        normalizedParam = new Array<string>(segments.length);
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
          const segment = segments[segmentIndex];
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
  /** @internal Maximum raw path entries admitted before result materialization. */
  maxPaths?: number;
  /** @internal Maximum raw array-param segments admitted before materialization. */
  maxArrayParamSegments?: number;
}

function snapshotOptionalLimit(value: unknown, description: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${description} must be a non-negative safe integer`);
  }
  return value as number;
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
    let limits: StaticPathsSnapshotLimits;
    try {
      const rawProjectId = options?.projectId;
      suppliedProjectId = rawProjectId === undefined
        ? undefined
        : requireDataProjectId(rawProjectId);
      callerSignal = options?.signal;
      limits = {
        maxPaths: snapshotOptionalLimit(options?.maxPaths, "Static paths result limit"),
        maxArrayParamSegments: snapshotOptionalLimit(
          options?.maxArrayParamSegments,
          "Static paths array-parameter limit",
        ),
      };
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
                : validateStaticPathsResult(result, limits);
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
