/**
 * In-flight request tracker for debugging stuck requests.
 *
 * Tracks active requests and logs warnings when requests exceed thresholds.
 * Helps identify when the event loop is blocked or requests are hanging.
 */

import { serverLogger } from "#veryfront/utils";
import { unrefTimer } from "#veryfront/compat/process.ts";
import { isLightweightPath, isWebSocketPath } from "./request-utils.ts";
import type { RequestProfileRecord } from "#veryfront/observability";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { generateRequestId } from "#veryfront/utils/request-id.ts";

const logger = serverLogger.component("request-tracker");

declare const requestTrackingKeyBrand: unique symbol;

/** Opaque identity for one in-flight request, distinct from its correlation ID. */
export type RequestTrackingKey = string & {
  readonly [requestTrackingKeyBrand]: true;
};

interface TrackedRequest {
  trackingKey: RequestTrackingKey;
  /** Client-visible correlation ID. This is not used as tracker identity. */
  requestId: string;
  projectSlug: string | undefined;
  path: string;
  method: string;
  startTime: number;
  env?: string;
  releaseId?: string;
  slowTimer?: ReturnType<typeof setTimeout>;
  verySlowTimer?: ReturnType<typeof setTimeout>;
}

/** Threshold in ms before logging a warning about a slow request */
const SLOW_REQUEST_THRESHOLD_MS = 10_000; // 10 seconds

/** Threshold in ms before logging an error about a very slow request */
const VERY_SLOW_REQUEST_THRESHOLD_MS = 25_000; // 25 seconds

/** How often to log the current state of in-flight requests */
const STATUS_LOG_INTERVAL_MS = 30_000; // 30 seconds

/** How often to log drain progress during graceful shutdown */
const DRAIN_PROGRESS_LOG_INTERVAL_MS = 5_000; // 5 seconds

/** Only log module requests that exceed this duration (to reduce noise) */
const MODULE_REQUEST_LOG_THRESHOLD_MS = 100;

/** Attach request-profiler details to completion logs at or above this duration. */
const DEFAULT_SLOW_REQUEST_PROFILE_LOG_THRESHOLD_MS = 2_000;

function getSlowRequestProfileLogThresholdMs(): number {
  const raw = getEnv("VERYFRONT_SLOW_REQUEST_PROFILE_LOG_THRESHOLD_MS");
  if (!raw) return DEFAULT_SLOW_REQUEST_PROFILE_LOG_THRESHOLD_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_SLOW_REQUEST_PROFILE_LOG_THRESHOLD_MS;
  }
  return parsed;
}

function buildRequestProfileLogContext(record: RequestProfileRecord): Record<string, unknown> {
  const slowestPhases = Object.entries(record.phases)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 10)
    .map(([name, durationMs]) => ({ name, durationMs }));

  return {
    sequence: record.sequence,
    category: record.category,
    method: record.method,
    requestMode: record.requestMode,
    status: record.status,
    totalMs: record.totalMs,
    phases: record.phases,
    slowestPhases,
  };
}

class RequestTracker {
  private inFlight = new Map<RequestTrackingKey, TrackedRequest>();
  private statusInterval: ReturnType<typeof setInterval> | undefined;
  private totalRequests = 0;
  private totalCompleted = 0;
  private totalTimedOut = 0;

  constructor() {
    this.startStatusLogging();
  }

  private startStatusLogging(): void {
    this.statusInterval = setInterval(() => {
      if (this.inFlight.size === 0) return;

      const now = performance.now();
      const requests = Array.from(this.inFlight.values())
        .map((r) => ({
          method: r.method,
          elapsedMs: Math.round(now - r.startTime),
        }))
        .sort((a, b) => b.elapsedMs - a.elapsedMs);

      logger.info("In-flight requests status", {
        inFlightCount: this.inFlight.size,
        totalRequests: this.totalRequests,
        totalCompleted: this.totalCompleted,
        totalTimedOut: this.totalTimedOut,
        requests: requests.slice(0, 10),
      });
    }, STATUS_LOG_INTERVAL_MS);

    // Global singleton status logging should not keep short-lived CLI processes alive.
    if (this.statusInterval) unrefTimer(this.statusInterval);
  }

  start(
    requestId: string,
    projectSlug: string | undefined,
    path: string,
    method: string,
    env?: string,
    releaseId?: string,
  ): RequestTrackingKey {
    const trackingKey = generateRequestId() as RequestTrackingKey;
    const startTime = performance.now();
    this.totalRequests++;

    const tracked: TrackedRequest = {
      trackingKey,
      requestId,
      projectSlug,
      path,
      method,
      startTime,
      env,
      releaseId,
    };

    // WebSocket connections are long-lived by design and lightweight internal
    // asset/module requests can be noisy under CI jitter, so do not flag them as stuck.
    if (!isWebSocketPath(path) && !isLightweightPath(path)) {
      tracked.slowTimer = setTimeout(() => {
        const elapsedMs = Math.round(performance.now() - startTime);
        logger.warn("Slow request detected", {
          method,
          elapsedMs,
          inFlightCount: this.inFlight.size,
        });

        tracked.verySlowTimer = setTimeout(() => {
          const verySlowElapsedMs = Math.round(performance.now() - startTime);
          logger.error("Very slow request - likely stuck", {
            method,
            elapsedMs: verySlowElapsedMs,
            inFlightCount: this.inFlight.size,
          });
        }, VERY_SLOW_REQUEST_THRESHOLD_MS - SLOW_REQUEST_THRESHOLD_MS);
        if (tracked.verySlowTimer) unrefTimer(tracked.verySlowTimer);
      }, SLOW_REQUEST_THRESHOLD_MS);
      if (tracked.slowTimer) unrefTimer(tracked.slowTimer);
    }

    this.inFlight.set(trackingKey, tracked);

    logger.debug("Request started", {
      method,
      inFlightCount: this.inFlight.size,
    });

    return trackingKey;
  }

  complete(
    trackingKey: RequestTrackingKey,
    statusCode: number,
    timedOut = false,
    profile?: RequestProfileRecord | null,
  ): void {
    const tracked = this.inFlight.get(trackingKey);
    if (!tracked) return;

    if (tracked.slowTimer) clearTimeout(tracked.slowTimer);
    if (tracked.verySlowTimer) clearTimeout(tracked.verySlowTimer);

    this.inFlight.delete(trackingKey);

    const durationMs = Math.round(performance.now() - tracked.startTime);

    if (timedOut) this.totalTimedOut++;
    else this.totalCompleted++;

    if (isLightweightPath(tracked.path)) {
      if (durationMs > MODULE_REQUEST_LOG_THRESHOLD_MS) {
        logger.debug("Lightweight request completed", {
          durationMs,
          method: tracked.method,
          statusCode,
        });
      }
      return;
    }

    const logContext: Record<string, unknown> = {
      durationMs,
      method: tracked.method,
      statusCode,
    };

    if (profile && durationMs >= getSlowRequestProfileLogThresholdMs()) {
      logContext.request_profile = buildRequestProfileLogContext(profile);
    }

    logger.info("Request completed", logContext);
  }

  markLongLived(trackingKey: RequestTrackingKey): void {
    const tracked = this.inFlight.get(trackingKey);
    if (!tracked) return;

    if (tracked.slowTimer) {
      clearTimeout(tracked.slowTimer);
      delete tracked.slowTimer;
    }
    if (tracked.verySlowTimer) {
      clearTimeout(tracked.verySlowTimer);
      delete tracked.verySlowTimer;
    }
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  getInFlightRequests(): TrackedRequest[] {
    return Array.from(this.inFlight.values());
  }

  getStats(): { inFlight: number; total: number; completed: number; timedOut: number } {
    return {
      inFlight: this.inFlight.size,
      total: this.totalRequests,
      completed: this.totalCompleted,
      timedOut: this.totalTimedOut,
    };
  }

  async waitForDrain(timeoutMs: number, pollIntervalMs = 100): Promise<boolean> {
    const startTime = Date.now();

    if (this.inFlight.size === 0) {
      logger.info("No in-flight requests, drain complete");
      return true;
    }

    logger.info("Waiting for in-flight requests to drain", {
      inFlightCount: this.inFlight.size,
      timeoutMs,
    });

    while (this.inFlight.size > 0) {
      const elapsedMs = Date.now() - startTime;

      if (elapsedMs >= timeoutMs) {
        const now = performance.now();
        const remainingRequests = Array.from(this.inFlight.values()).map((r) => ({
          method: r.method,
          elapsedMs: Math.round(now - r.startTime),
        }));

        logger.warn(
          "[RequestTracker] Drain timeout - forcing shutdown with in-flight requests",
          {
            inFlightCount: this.inFlight.size,
            timeoutMs,
            remainingRequests: remainingRequests.slice(0, 10),
          },
        );
        return false;
      }

      if (elapsedMs > 0 && elapsedMs % DRAIN_PROGRESS_LOG_INTERVAL_MS < pollIntervalMs) {
        logger.info("Drain progress", {
          inFlightCount: this.inFlight.size,
          elapsedMs,
          remainingMs: timeoutMs - elapsedMs,
        });
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    logger.info("All requests drained successfully", {
      drainTimeMs: Date.now() - startTime,
    });
    return true;
  }

  shutdown(): void {
    if (this.statusInterval) clearInterval(this.statusInterval);

    for (const tracked of this.inFlight.values()) {
      if (tracked.slowTimer) clearTimeout(tracked.slowTimer);
      if (tracked.verySlowTimer) clearTimeout(tracked.verySlowTimer);
    }

    this.inFlight.clear();
  }
}

export const requestTracker = new RequestTracker();
