/**
 * In-flight request tracker for debugging stuck requests.
 *
 * Tracks active requests and logs warnings when requests exceed thresholds.
 * Helps identify when the event loop is blocked or requests are hanging.
 */

import { serverLogger as logger } from "#veryfront/utils";

export interface TrackedRequest {
  requestId: string;
  projectSlug: string | undefined;
  path: string;
  method: string;
  startTime: number;
  /** Timer for logging slow requests */
  slowTimer?: ReturnType<typeof setTimeout>;
}

/** Threshold in ms before logging a warning about a slow request */
const SLOW_REQUEST_THRESHOLD_MS = 10_000; // 10 seconds

/** Threshold in ms before logging an error about a very slow request */
const VERY_SLOW_REQUEST_THRESHOLD_MS = 25_000; // 25 seconds

/** How often to log the current state of in-flight requests */
const STATUS_LOG_INTERVAL_MS = 30_000; // 30 seconds

class RequestTracker {
  private inFlight = new Map<string, TrackedRequest>();
  private statusInterval: ReturnType<typeof setInterval> | undefined;
  private totalRequests = 0;
  private totalCompleted = 0;
  private totalTimedOut = 0;

  constructor() {
    // Start periodic status logging
    this.startStatusLogging();
  }

  private startStatusLogging(): void {
    // Only log status if there are in-flight requests
    this.statusInterval = setInterval(() => {
      if (this.inFlight.size > 0) {
        const now = performance.now();
        const requests = Array.from(this.inFlight.values()).map((r) => ({
          requestId: r.requestId,
          projectSlug: r.projectSlug,
          path: r.path,
          method: r.method,
          elapsedMs: Math.round(now - r.startTime),
        }));

        // Sort by elapsed time descending
        requests.sort((a, b) => b.elapsedMs - a.elapsedMs);

        logger.info("[RequestTracker] In-flight requests status", {
          inFlightCount: this.inFlight.size,
          totalRequests: this.totalRequests,
          totalCompleted: this.totalCompleted,
          totalTimedOut: this.totalTimedOut,
          requests: requests.slice(0, 10), // Top 10 slowest
        });
      }
    }, STATUS_LOG_INTERVAL_MS);

    // Don't block process exit (Deno doesn't support unref, but that's okay
    // since Deno automatically doesn't block on intervals/timeouts)
  }

  /**
   * Start tracking a request.
   * Call this at the beginning of request handling.
   */
  start(
    requestId: string,
    projectSlug: string | undefined,
    path: string,
    method: string,
  ): void {
    const startTime = performance.now();
    this.totalRequests++;

    const tracked: TrackedRequest = {
      requestId,
      projectSlug,
      path,
      method,
      startTime,
    };

    // Set up slow request warning timer
    tracked.slowTimer = setTimeout(() => {
      const elapsed = Math.round(performance.now() - startTime);
      logger.warn("[RequestTracker] Slow request detected", {
        requestId,
        projectSlug,
        path,
        method,
        elapsedMs: elapsed,
        inFlightCount: this.inFlight.size,
      });

      // Set up very slow request error timer
      tracked.slowTimer = setTimeout(() => {
        const elapsed = Math.round(performance.now() - startTime);
        logger.error("[RequestTracker] Very slow request - likely stuck", {
          requestId,
          projectSlug,
          path,
          method,
          elapsedMs: elapsed,
          inFlightCount: this.inFlight.size,
        });
      }, VERY_SLOW_REQUEST_THRESHOLD_MS - SLOW_REQUEST_THRESHOLD_MS);
    }, SLOW_REQUEST_THRESHOLD_MS);

    this.inFlight.set(requestId, tracked);

    logger.info("[RequestTracker] Request started", {
      requestId,
      projectSlug,
      path,
      method,
      inFlightCount: this.inFlight.size,
    });
  }

  /**
   * Complete tracking a request.
   * Call this when the request finishes (success or error).
   */
  complete(requestId: string, statusCode: number, timedOut = false): void {
    const tracked = this.inFlight.get(requestId);
    if (!tracked) {
      // Request wasn't tracked (maybe health check or monitoring endpoint)
      return;
    }

    // Clear slow request timer
    if (tracked.slowTimer) {
      clearTimeout(tracked.slowTimer);
    }

    this.inFlight.delete(requestId);

    const durationMs = Math.round(performance.now() - tracked.startTime);

    if (timedOut) {
      this.totalTimedOut++;
    } else {
      this.totalCompleted++;
    }

    logger.info("[RequestTracker] Request completed", {
      requestId,
      projectSlug: tracked.projectSlug,
      path: tracked.path,
      method: tracked.method,
      statusCode,
      durationMs,
      timedOut,
      inFlightCount: this.inFlight.size,
    });
  }

  /**
   * Get current in-flight count for metrics/debugging.
   */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Get all in-flight requests for debugging.
   */
  getInFlightRequests(): TrackedRequest[] {
    return Array.from(this.inFlight.values());
  }

  /**
   * Get stats for metrics.
   */
  getStats(): {
    inFlight: number;
    total: number;
    completed: number;
    timedOut: number;
  } {
    return {
      inFlight: this.inFlight.size,
      total: this.totalRequests,
      completed: this.totalCompleted,
      timedOut: this.totalTimedOut,
    };
  }

  /**
   * Wait for all in-flight requests to complete (graceful drain).
   *
   * @param timeoutMs Maximum time to wait for requests to drain
   * @param pollIntervalMs How often to check for completion (default: 100ms)
   * @returns true if all requests drained, false if timed out
   */
  async waitForDrain(timeoutMs: number, pollIntervalMs = 100): Promise<boolean> {
    const startTime = Date.now();

    if (this.inFlight.size === 0) {
      logger.info("[RequestTracker] No in-flight requests, drain complete");
      return true;
    }

    logger.info("[RequestTracker] Waiting for in-flight requests to drain", {
      inFlightCount: this.inFlight.size,
      timeoutMs,
    });

    while (this.inFlight.size > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        const remaining = Array.from(this.inFlight.values()).map((r) => ({
          requestId: r.requestId,
          projectSlug: r.projectSlug,
          path: r.path,
          method: r.method,
          elapsedMs: Math.round(performance.now() - r.startTime),
        }));

        logger.warn("[RequestTracker] Drain timeout - forcing shutdown with in-flight requests", {
          inFlightCount: this.inFlight.size,
          timeoutMs,
          remainingRequests: remaining.slice(0, 10), // Top 10
        });
        return false;
      }

      // Log progress every 5 seconds
      if (elapsed > 0 && elapsed % 5000 < pollIntervalMs) {
        logger.info("[RequestTracker] Drain progress", {
          inFlightCount: this.inFlight.size,
          elapsedMs: elapsed,
          remainingMs: timeoutMs - elapsed,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const totalTime = Date.now() - startTime;
    logger.info("[RequestTracker] All requests drained successfully", {
      drainTimeMs: totalTime,
    });
    return true;
  }

  /**
   * Clean up (for testing or shutdown).
   */
  shutdown(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    // Clear all slow timers
    for (const tracked of this.inFlight.values()) {
      if (tracked.slowTimer) {
        clearTimeout(tracked.slowTimer);
      }
    }
    this.inFlight.clear();
  }
}

// Singleton instance
export const requestTracker = new RequestTracker();
