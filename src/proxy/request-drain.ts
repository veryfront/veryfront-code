import { getRequestTransportLifetime } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import { continueProxyShutdownPromise, delayProxyShutdown } from "./shutdown-intrinsics.ts";
import { isControlPlaneRunStreamPost } from "./retry.ts";
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

  completeOnResponseEnd(requestId: string, request: Request, response: Response): Response {
    if (!response.body) {
      this.complete(requestId);
      return response;
    }

    const lifetime = getRequestTransportLifetime(request);
    if (lifetime?.completed) {
      const complete = () => this.complete(requestId);
      void continueProxyShutdownPromise(lifetime.completed, complete, complete);
      return response;
    }

    return completeOnResponseBodyConsumption(
      response,
      () => this.complete(requestId),
      lifetime?.signal ?? request.signal,
      { highWaterMark: 0 },
      { completeOnSourceClose: false, errorOnAbort: true },
    );
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

      await delayProxyShutdown(Math.min(pollIntervalMs, remainingMs));
    }

    return true;
  }
}

export function parseProxyDrainTimeoutMs(
  rawValue: string | undefined,
  defaultValue: number,
  name = "SHUTDOWN_DRAIN_TIMEOUT_MS",
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
    throw new TypeError(`${name} must be a non-negative decimal integer`);
  }
  const parsed = Number(rawValue);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > 10 * 60 * 1_000
  ) {
    throw new RangeError(`${name} must be between 0 and 600000`);
  }
  return parsed;
}

export function createProxyDrainingResponse(): Response {
  return new Response("Service Unavailable", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      Connection: "close",
      "Retry-After": "1",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * After SIGTERM the proxy keeps admitting new requests for a short grace
 * window. The gateway reaches it over pooled keep-alive connections through the
 * Service, and requests already queued on those connections would otherwise
 * get the draining 503. Each admitted response closes its connection (see
 * `withConnectionClose`), so the gateway reconnects through the Service, which
 * no longer routes to this terminating pod. After the window, new requests get
 * the draining response.
 *
 * SIGINT (a local Ctrl-C) has no gateway to wait for, so it starts with no
 * grace window. Long-lived requests (WebSocket upgrades and SSE streams) are
 * refused from the moment shutdown starts: they could outlive the remaining
 * drain budget and belong on a replica that stays.
 */
export class ProxyDrainAdmission {
  private admitUntil: number | null = null;
  private grantedMs = 0;

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(windowMs) || windowMs < 0) {
      throw new RangeError("Proxy drain admission window must be a non-negative integer");
    }
  }

  begin(signal: "SIGINT" | "SIGTERM"): void {
    if (this.admitUntil !== null) return;
    this.grantedMs = signal === "SIGTERM" ? this.windowMs : 0;
    this.admitUntil = this.now() + this.grantedMs;
  }

  /** Whether a request arriving now is served (always true before `begin`). */
  admits(request: Request, pathname: string): boolean {
    if (this.admitUntil === null) return true;
    if (isLongLivedProxyRequest(request, pathname)) return false;
    return this.now() < this.admitUntil;
  }

  /** The whole grace window granted by `begin`, in integer milliseconds. */
  getGrantedMs(): number {
    return this.grantedMs;
  }

  /** Wait out the rest of the grace window on a timer captured before extensions load. */
  waitForWindow(): Promise<void> {
    const remainingMs = this.admitUntil === null ? 0 : Math.max(0, this.admitUntil - this.now());
    return delayProxyShutdown(Math.ceil(remainingMs));
  }
}

/** WebSocket upgrades and SSE streams hold their connection open indefinitely. */
export function isLongLivedProxyRequest(request: Request, pathname: string): boolean {
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return true;
  if (request.headers.get("accept")?.toLowerCase().includes("text/event-stream")) return true;
  return isControlPlaneRunStreamPost(request, pathname);
}

/** Ask the HTTP/1.1 server to close the connection after this response. */
export function withConnectionClose(response: Response): Response {
  if (response.status === 101) return response;
  try {
    response.headers.set("Connection", "close");
    return response;
  } catch {
    // Fetched upstream responses carry immutable headers.
    const headers = new Headers(response.headers);
    headers.set("Connection", "close");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/**
 * Readiness path for the proxy. Unlike the static `/_proxy/health` liveness
 * check, it fails as soon as shutdown starts, so Kubernetes removes the
 * endpoint instead of routing new requests to a replica that refuses them.
 */
export const PROXY_READY_PATH = "/_proxy/ready";

export function createProxyReadinessResponse(shuttingDown: boolean): Response {
  if (shuttingDown) return createProxyDrainingResponse();
  return Response.json(
    { service: "veryfront-proxy", status: "ready" },
    { headers: { "Cache-Control": "no-store" } },
  );
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
