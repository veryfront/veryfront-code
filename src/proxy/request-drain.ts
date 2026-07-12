import { completeOnResponseBodySettlement } from "#veryfront/platform/compat/http/response-lifecycle.ts";

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
    if (this.inFlight.size === 0) return true;

    const deadline = Date.now() + Math.max(0, timeoutMs);
    const intervalMs = Math.max(1, pollIntervalMs);

    while (this.inFlight.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return false;

      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
    }

    return true;
  }
}

export function parseProxyDrainTimeoutMs(
  rawValue: string | undefined,
  defaultValue: number,
): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : defaultValue;
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });

  try {
    return await Promise.race([close().then(() => true as const), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
