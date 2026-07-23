import { completeOnResponseBodySettlement } from "#veryfront/platform/compat/http/response-lifecycle.ts";

const MAX_DRAIN_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

function normalizeDurationMs(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_DRAIN_TIMEOUT_MS)
    : fallback;
}

/** Snapshot of a proxy request that has not completed. */
export interface TrackedProxyRequest {
  /** Internal request identifier. */
  requestId: string;
  /** HTTP method. */
  method: string;
  /** Request path used in shutdown diagnostics. */
  path: string;
  /** Monotonic start time from the Performance API. */
  startTime: number;
}

/** Tracks proxy requests until their response bodies settle. */
export class ProxyRequestDrainTracker {
  private readonly inFlight = new Map<string, TrackedProxyRequest>();

  /** Starts tracking a uniquely identified request. */
  start(requestId: string, method: string, path: string): void {
    if (this.inFlight.has(requestId)) {
      throw new Error("Proxy request identifier is already tracked");
    }
    this.inFlight.set(requestId, {
      requestId,
      method,
      path,
      startTime: performance.now(),
    });
  }

  /** Marks a tracked request as complete. */
  complete(requestId: string): void {
    this.inFlight.delete(requestId);
  }

  /** Completes a request after its response body closes, errors, or is cancelled. */
  completeOnResponseEnd(requestId: string, response: Response): Response {
    return completeOnResponseBodySettlement(response, () => this.complete(requestId));
  }

  /** Returns the number of requests that remain in flight. */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /** Returns defensive snapshots of all requests that remain in flight. */
  getInFlightRequests(): TrackedProxyRequest[] {
    return Array.from(this.inFlight.values(), (request) => ({ ...request }));
  }

  /** Waits for all tracked requests to finish within a bounded duration. */
  async waitForDrain(timeoutMs: number, pollIntervalMs = 100): Promise<boolean> {
    if (this.inFlight.size === 0) return true;

    const normalizedTimeoutMs = normalizeDurationMs(timeoutMs, 0);
    if (normalizedTimeoutMs === 0) return false;
    const deadline = performance.now() + normalizedTimeoutMs;
    const intervalMs = Math.max(
      1,
      normalizeDurationMs(pollIntervalMs, DEFAULT_POLL_INTERVAL_MS),
    );

    while (this.inFlight.size > 0) {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) return false;

      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
    }

    return true;
  }
}

/** Parses a bounded shutdown drain timeout from configuration. */
export function parseProxyDrainTimeoutMs(
  rawValue: string | undefined,
  defaultValue: number,
): number {
  const safeDefault = normalizeDurationMs(defaultValue, 0);
  if (!rawValue || !/^\d+$/u.test(rawValue)) return safeDefault;
  return normalizeDurationMs(Number(rawValue), safeDefault);
}

/** Creates the retryable response returned while the proxy is draining. */
export function createProxyDrainingResponse(): Response {
  return new Response("Service Unavailable", {
    status: 503,
    headers: {
      Connection: "close",
      "Retry-After": "1",
    },
  });
}

/** Attempts to close the proxy server within a bounded duration. */
export async function closeProxyServerWithin(
  close: () => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), normalizeDurationMs(timeoutMs, 0));
  });

  try {
    return await Promise.race([close().then(() => true as const), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
