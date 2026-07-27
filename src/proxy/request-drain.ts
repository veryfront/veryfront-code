import { completeOnResponseBodySettlement } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import { MAX_PROXY_TIMER_DELAY_MS } from "./timing.ts";

export interface TrackedProxyRequest {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
}

export class ProxyRequestDrainTracker {
  private readonly inFlight = new Map<string, TrackedProxyRequest>();

  start(requestId: string, method: string, path: string): void {
    this.inFlight.set(requestId, {
      requestId,
      method,
      path,
      startTime: performance.now(),
    });
  }

  complete(requestId: string): void {
    this.inFlight.delete(requestId);
  }

  completeOnResponseEnd(requestId: string, response: Response): Response {
    return completeOnResponseBodySettlement(response, () => this.complete(requestId));
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  getInFlightRequests(): TrackedProxyRequest[] {
    return Array.from(this.inFlight.values(), (request) => ({ ...request }));
  }

  async waitForDrain(timeoutMs: number, pollIntervalMs = 100): Promise<boolean> {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_PROXY_TIMER_DELAY_MS
    ) {
      throw new RangeError(
        `Proxy drain timeout must be an integer between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
      );
    }
    if (
      !Number.isSafeInteger(pollIntervalMs) ||
      pollIntervalMs < 1 ||
      pollIntervalMs > MAX_PROXY_TIMER_DELAY_MS
    ) {
      throw new RangeError(
        `Proxy drain poll interval must be an integer between 1 and ${MAX_PROXY_TIMER_DELAY_MS}`,
      );
    }
    if (this.inFlight.size === 0) return true;

    const deadline = performance.now() + timeoutMs;

    while (this.inFlight.size > 0) {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) return false;

      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(pollIntervalMs, remainingMs))
      );
    }

    return true;
  }
}

export function parseProxyDrainTimeoutMs(
  rawValue: string | undefined,
  defaultValue: number,
): number {
  if (
    !Number.isSafeInteger(defaultValue) ||
    defaultValue < 0 ||
    defaultValue > 10 * 60 * 1_000
  ) {
    throw new RangeError(
      "Default proxy drain timeout must be an integer between 0 and 600000",
    );
  }
  if (rawValue === undefined || rawValue === "") return defaultValue;
  if (!/^\d+$/.test(rawValue)) {
    throw new TypeError("SHUTDOWN_DRAIN_TIMEOUT_MS must be a decimal integer");
  }
  const parsed = Number(rawValue);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > 10 * 60 * 1_000
  ) {
    throw new RangeError(
      "SHUTDOWN_DRAIN_TIMEOUT_MS must be between 0 and 600000",
    );
  }
  return parsed;
}

export function createProxyDrainingResponse(): Response {
  return new Response("Service Unavailable", {
    status: 503,
    headers: {
      Connection: "close",
      "Retry-After": "1",
    },
  });
}

export async function closeProxyServerWithin(
  close: () => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  if (typeof close !== "function") {
    throw new TypeError("Proxy server close operation must be a function");
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_PROXY_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Proxy server close timeout must be an integer between 0 and ${MAX_PROXY_TIMER_DELAY_MS}`,
    );
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([close().then(() => true as const), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
