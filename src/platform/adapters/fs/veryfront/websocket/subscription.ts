import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import type { PokeAckType, WebSocketDeps } from "./types.ts";

const logger = getBaseLogger("SERVER", { injectTraceContext: false }).component(
  "web-socket-subscription",
);

const WS_RECONNECT_DELAY_MS = 5000;
const WS_RECONNECT_MAX_DELAY_MS = 120000;
const WS_RECONNECT_MAX_FAILURES = 10;
const WS_HEARTBEAT_INTERVAL_MS = 60000;
const WS_HEARTBEAT_TIMEOUT_MS = 300000;

interface WebSocketSubscriptionHandlers {
  onMessage: (event: MessageEvent) => void;
  getTotalPokesReceived: () => number;
}

export class WebSocketSubscription {
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsLastPong = Date.now();
  private wsConnectionId: string | null = null;
  private wsConsecutiveFailures = 0;
  private wsErrorLogged = false;
  private disposed = false;

  constructor(
    private readonly deps: WebSocketDeps,
    private readonly handlers: WebSocketSubscriptionHandlers,
  ) {}

  get connectionId(): string | null {
    return this.wsConnectionId;
  }

  private getConnectionLogContext(context: Record<string, unknown> = {}): Record<string, unknown> {
    if (!this.deps.projectSlug) return context;
    return { projectSlug: this.deps.projectSlug, ...context };
  }

  connect(projectId: string): void {
    if (this.disposed) return;

    this.cleanupTimers();

    if (this.wsConsecutiveFailures >= WS_RECONNECT_MAX_FAILURES) {
      logger.warn("WebSocket reconnect failure cap reached, resetting failure counter", {
        consecutiveFailures: this.wsConsecutiveFailures,
        maxFailures: WS_RECONNECT_MAX_FAILURES,
        cappedDelayMs: WS_RECONNECT_MAX_DELAY_MS,
        projectId,
      });
      this.wsConsecutiveFailures = 0;
    }

    const wsUrl = this.deps.apiBaseUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/api$/, "");

    // The WebSocket protocol (ws vs wss) is derived from the configured
    // apiBaseUrl (http→ws, https→wss). No forced upgrade is needed because
    // the auth token is sent via a subprotocol header, not in the URL.

    const url = `${wsUrl}/ws/${projectId}/events`;

    logger.debug(
      "Connecting to WebSocket",
      this.getConnectionLogContext({
        url,
        consecutiveFailures: this.wsConsecutiveFailures,
      }),
    );

    try {
      // Send the API token via a WebSocket subprotocol header instead of
      // a query-string parameter. Query strings can leak into server
      // access logs, proxy logs, and the browser's Referer header.
      this.ws = new WebSocket(url, [`bearer-${this.deps.apiToken}`]);
      this.wsConnectionId = crypto.randomUUID().slice(0, 8);
      this.wsErrorLogged = false;

      this.ws.onopen = () => {
        this.wsConsecutiveFailures = 0;
        logger.debug(
          "WebSocket connected to events channel",
          this.getConnectionLogContext({
            projectId,
            connectionId: this.wsConnectionId,
            contentSource: this.deps.getContentSource(),
            branch: this.deps.getContentContext()?.branch,
          }),
        );
        this.wsLastPong = Date.now();
        this.startHeartbeat(projectId);
      };

      this.ws.onmessage = (event) => {
        this.wsLastPong = Date.now();
        logger.debug("WebSocket message received:", { data: event.data });
        this.handlers.onMessage(event);
      };

      this.ws.onclose = () => {
        this.wsConnectionId = null;
        this.cleanupTimers();

        if (this.disposed) return;

        this.wsConsecutiveFailures++;
        const delay = this.getReconnectDelay();
        logger.debug(
          "WebSocket closed, reconnecting",
          this.getConnectionLogContext({
            delayMs: delay,
            totalPokesReceived: this.handlers.getTotalPokesReceived(),
            consecutiveFailures: this.wsConsecutiveFailures,
          }),
        );
        this.wsReconnectTimer = setTimeout(() => this.connect(projectId), delay);
      };

      this.ws.onerror = (event) => {
        // Log once per connection attempt to avoid flooding logs.
        if (!this.wsErrorLogged) {
          this.wsErrorLogged = true;
          logger.warn(
            "WebSocket error",
            this.getConnectionLogContext({
              type: event.type,
              url: (event.target as WebSocket)?.url,
              readyState: (event.target as WebSocket)?.readyState,
              consecutiveFailures: this.wsConsecutiveFailures,
            }),
          );
        }
      };
    } catch (error) {
      this.wsConsecutiveFailures++;
      const delay = this.getReconnectDelay();
      logger.warn(
        "Failed to connect WebSocket",
        this.getConnectionLogContext({
          error,
          consecutiveFailures: this.wsConsecutiveFailures,
        }),
      );
      this.wsReconnectTimer = setTimeout(() => this.connect(projectId), delay);
    }
  }

  private getReconnectDelay(): number {
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s, capped at 120s
    const delay = WS_RECONNECT_DELAY_MS * Math.pow(2, this.wsConsecutiveFailures - 1);
    return Math.min(delay, WS_RECONNECT_MAX_DELAY_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupTimers();

    if (!this.ws) return;

    // Detach handlers before closing to prevent onclose from scheduling a reconnect
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;

    try {
      this.ws.close();
    } catch (error) {
      logger.warn("Error closing WebSocket", { error });
    } finally {
      this.ws = null;
    }
  }

  private startHeartbeat(projectId: string): void {
    this.wsHeartbeatTimer = setInterval(() => {
      const timeSinceLastPong = Date.now() - this.wsLastPong;
      if (timeSinceLastPong <= WS_HEARTBEAT_TIMEOUT_MS) return;

      logger.warn(
        "WebSocket heartbeat timeout, reconnecting",
        this.getConnectionLogContext({
          timeSinceLastPong,
        }),
      );

      // Detach onclose before closing to prevent double-reconnect:
      // ws.close() triggers onclose asynchronously, which would increment
      // the failure counter and schedule a separate reconnect timer.
      if (this.ws) {
        this.ws.onclose = null;
        try {
          this.ws.close();
        } catch (error) {
          logger.error("WebSocket close failed during heartbeat timeout", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.cleanupTimers();
      this.connect(projectId);
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private cleanupTimers(): void {
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  sendPokeAck(
    type: PokeAckType,
    changedPaths: string[] | undefined,
    totalInvalidations: number,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "poke_ack",
          data: {
            invalidationType: type,
            changedPaths: changedPaths ?? [],
            timestamp: Date.now(),
            connectionId: this.wsConnectionId,
            totalInvalidations,
          },
        }),
      );

      logger.debug("Poke acknowledgment sent", {
        type,
        changedPathsCount: changedPaths?.length ?? 0,
      });
    } catch (error) {
      logger.warn("Failed to send poke acknowledgment", { error });
    }
  }
}
