import type { HttpHandlerResponse } from "../../adapters/base.ts";
import type { NodeWebSocketServerProvider } from "#veryfront/extensions/websocket";

export interface ServeOptions {
  /** Deno: undefined preserves implicit WS support; null explicitly disables it. */
  nodeWebSocketServerProvider?: Readonly<NodeWebSocketServerProvider> | null;
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
  /**
   * Node.js only. Called synchronously for each raw HTTP listener `error` event
   * emitted after `onListen` returns. Returned promises are observed only for
   * rejection and are not awaited by the listener or shutdown.
   */
  onRuntimeError?: (error: Error) => void | Promise<void>;
}

export type Handler = (request: Request) => HttpHandlerResponse | Promise<HttpHandlerResponse>;

export interface HttpServer {
  /**
   * Start one listener.
   *
   * `onListen` is the portable readiness boundary. Use `close()` as the
   * portable, awaitable shutdown boundary.
   */
  serve(handler: Handler, options?: ServeOptions): Promise<void>;

  /** Stop the active or pending listener. Concurrent calls share teardown. */
  close(): Promise<void>;
}

export interface WebSocketUpgradeResult {
  socket: WebSocket;
  response: HttpHandlerResponse;
}

export interface WebSocketUpgradeOptions {
  protocol?: string;
  headers?: Headers | Record<string, string>;
  idleTimeout?: number;
}
