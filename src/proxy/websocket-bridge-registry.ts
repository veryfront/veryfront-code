import {
  PROXY_WS_CLOSE_GOING_AWAY,
  type ProxyWebSocketBridge,
} from "./websocket-bridge-protocol.ts";

interface TrackedProxyWebSocketBridge {
  readonly close: (code: number, reason: string) => void;
  readonly closed: Promise<void>;
}

/**
 * Own live proxy WebSocket bridges so process shutdown can close sockets that
 * are no longer represented by an HTTP response body.
 */
export class ProxyWebSocketBridgeRegistry {
  private readonly bridges = new Set<TrackedProxyWebSocketBridge>();
  private closing = false;
  private closePromise: Promise<void> | null = null;

  track(bridge: ProxyWebSocketBridge): boolean {
    let close: unknown;
    let closed: unknown;
    let then: unknown;
    try {
      if (!bridge || typeof bridge !== "object") throw new TypeError();
      close = Reflect.get(bridge, "close");
      closed = Reflect.get(bridge, "closed");
      if (
        closed &&
        (typeof closed === "object" || typeof closed === "function")
      ) {
        then = Reflect.get(closed, "then");
      }
    } catch {
      throw new TypeError(
        "Proxy WebSocket bridge registry received an invalid bridge",
      );
    }
    if (
      typeof close !== "function" ||
      !closed ||
      (typeof closed !== "object" && typeof closed !== "function") ||
      typeof then !== "function"
    ) {
      throw new TypeError(
        "Proxy WebSocket bridge registry received an invalid bridge",
      );
    }
    const tracked = Object.freeze({
      close: (code: number, reason: string): void => {
        Reflect.apply(close, bridge, [code, reason]);
      },
      closed: new Promise<void>((resolve, reject) => {
        try {
          Reflect.apply(then, closed, [resolve, reject]);
        } catch (error) {
          reject(error);
        }
      }),
    });
    if (this.closing) {
      try {
        tracked.close(PROXY_WS_CLOSE_GOING_AWAY, "Proxy is shutting down");
      } catch {
        // The registry is already closed; the caller cannot retain ownership.
      }
      return false;
    }
    this.bridges.add(tracked);
    void tracked.closed.then(
      () => this.bridges.delete(tracked),
      () => this.bridges.delete(tracked),
    );
    return true;
  }

  get size(): number {
    return this.bridges.size;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    let resolveClose!: () => void;
    this.closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const bridges = [...this.bridges];
    for (const bridge of bridges) {
      try {
        bridge.close(PROXY_WS_CLOSE_GOING_AWAY, "Proxy is shutting down");
      } catch {
        // Continue closing every tracked bridge.
      }
    }
    void Promise.allSettled(bridges.map((bridge) => bridge.closed)).then(() => {
      this.bridges.clear();
      resolveClose();
    });
    return this.closePromise;
  }
}
