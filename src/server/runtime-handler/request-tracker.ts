/**
 * In-flight request tracker for debugging stuck requests.
 *
 * Tracks active requests and logs warnings when requests exceed thresholds.
 * Helps identify when the event loop is blocked or requests are hanging.
 */

import { serverLogger } from "#veryfront/utils";
import { unrefTimer } from "#veryfront/compat/process.ts";
import { isWebSocketPath } from "./request-utils.ts";

const logger = serverLogger.component("request-tracker");

interface TrackedRequest {
  requestId: string;
  projectSlug: string | undefined;
  path: string;
  method: string;
  startTime: number;
  env?: string;
  releaseId?: string;
  slowTimer?: ReturnType<typeof setTimeout>;
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

class RequestTracker {
  private inFlight = new Map<string, TrackedRequest>();
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
          requestId: r.requestId,
          projectSlug: r.projectSlug,
          path: r.path,
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
  ): void {
    const startTime = performance.now();
    this.totalRequests++;

    const tracked: TrackedRequest = {
      requestId,
      projectSlug,
      path,
      method,
      startTime,
      env,
      releaseId,
    };

    // WebSocket connections are long-lived by design — don't flag them as stuck.
    if (!isWebSocketPath(path)) {
      tracked.slowTimer = setTimeout(() => {
        const elapsedMs = Math.round(performance.now() - startTime);
        logger.warn("Slow request detected", {
          requestId,
          projectSlug,
          path,
          method,
          elapsedMs,
          inFlightCount: this.inFlight.size,
        });

        tracked.slowTimer = setTimeout(() => {
          const verySlowElapsedMs = Math.round(performance.now() - startTime);
          logger.error("Very slow request - likely stuck", {
            requestId,
            projectSlug,
            path,
            method,
            elapsedMs: verySlowElapsedMs,
            inFlightCount: this.inFlight.size,
          });
        }, VERY_SLOW_REQUEST_THRESHOLD_MS - SLOW_REQUEST_THRESHOLD_MS);
        if (tracked.slowTimer) unrefTimer(tracked.slowTimer);
      }, SLOW_REQUEST_THRESHOLD_MS);
      if (tracked.slowTimer) unrefTimer(tracked.slowTimer);
    }

    this.inFlight.set(requestId, tracked);

    logger.debug("Request started", {
      requestId,
      projectSlug,
      path,
      method,
      inFlightCount: this.inFlight.size,
    });
  }

  complete(requestId: string, statusCode: number, timedOut = false): void {
    const tracked = this.inFlight.get(requestId);
    if (!tracked) return;

    if (tracked.slowTimer) clearTimeout(tracked.slowTimer);

    this.inFlight.delete(requestId);

    const durationMs = Math.round(performance.now() - tracked.startTime);

    if (timedOut) this.totalTimedOut++;
    else this.totalCompleted++;

    const isModuleRequest = tracked.path.startsWith("/_vf_modules/") ||
      tracked.path.startsWith("/_veryfront/");

    if (isModuleRequest) {
      if (durationMs > MODULE_REQUEST_LOG_THRESHOLD_MS) {
        logger.debug(`${tracked.method} ${tracked.path} ${statusCode} ${durationMs}ms`);
      }
      return;
    }

    logger.info(`${tracked.method} ${tracked.path} ${statusCode}`, {
      project_slug: tracked.projectSlug,
      request_url: tracked.path,
      durationMs,
      method: tracked.method,
      statusCode,
      env: tracked.env,
      release_id: tracked.releaseId,
    });
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
          requestId: r.requestId,
          projectSlug: r.projectSlug,
          path: r.path,
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
    }

    this.inFlight.clear();
  }
}

export const requestTracker = new RequestTracker();
