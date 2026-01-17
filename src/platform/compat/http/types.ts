export interface ServeOptions {
  port?: number;

  hostname?: string;

  signal?: AbortSignal;

  onListen?: (params: { hostname: string; port: number }) => void;
}

export type Handler = (request: Request) => Response | Promise<Response>;

export interface HttpServer {
  serve(handler: Handler, options?: ServeOptions): Promise<void>;

  close(): Promise<void>;
}

/**
 * WebSocket upgrade result containing the socket and HTTP response
 */
export interface WebSocketUpgradeResult {
  socket: WebSocket;
  response: Response;
}

/**
 * Options for WebSocket upgrade
 */
export interface WebSocketUpgradeOptions {
  /** Protocol to use for the WebSocket connection */
  protocol?: string;
  /** Headers to include in the upgrade response */
  headers?: Headers | Record<string, string>;
}
