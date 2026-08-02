import {
  PROXY_WS_CLOSE_GOING_AWAY,
  PROXY_WS_CLOSE_TRY_AGAIN_LATER,
  type ProxyWebSocketBridge,
} from "./websocket-bridge-protocol.ts";

export const DEFAULT_PROXY_WEBSOCKET_BRIDGE_CAPACITY = 256;
export const MAX_PROXY_WEBSOCKET_BRIDGE_CAPACITY = 65_535;
const CAPACITY_EXHAUSTED_REASON = "Proxy WebSocket bridge capacity exhausted";

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
  private readonly maxActiveBridges: number;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    maxActiveBridges = DEFAULT_PROXY_WEBSOCKET_BRIDGE_CAPACITY,
  ) {
    if (
      !Number.isSafeInteger(maxActiveBridges) ||
      maxActiveBridges < 1 ||
      maxActiveBridges > MAX_PROXY_WEBSOCKET_BRIDGE_CAPACITY
    ) {
      throw new RangeError(
        `Proxy WebSocket bridge capacity must be an integer between 1 and ${MAX_PROXY_WEBSOCKET_BRIDGE_CAPACITY}`,
      );
    }
    this.maxActiveBridges = maxActiveBridges;
  }

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
      return this.closeUnownedBridge(
        tracked,
        PROXY_WS_CLOSE_GOING_AWAY,
        "Proxy is shutting down",
      );
    }
    if (this.bridges.size >= this.maxActiveBridges) {
      return this.closeUnownedBridge(
        tracked,
        PROXY_WS_CLOSE_TRY_AGAIN_LATER,
        CAPACITY_EXHAUSTED_REASON,
      );
    }
    this.bridges.add(tracked);
    void tracked.closed.then(
      () => this.bridges.delete(tracked),
      () => this.bridges.delete(tracked),
    );
    return true;
  }

  private closeUnownedBridge(
    bridge: TrackedProxyWebSocketBridge,
    code: number,
    reason: string,
  ): false {
    // Rejected ownership must still observe bridge settlement so a failing
    // implementation cannot surface an unhandled promise rejection.
    void bridge.closed.catch(() => undefined);
    try {
      bridge.close(code, reason);
    } catch {
      // The caller cannot retain registry ownership after rejection.
    }
    return false;
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
