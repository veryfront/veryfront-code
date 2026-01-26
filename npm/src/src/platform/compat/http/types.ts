import * as dntShim from "../../../../_dnt.shims.js";
export interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
}

export type Handler = (request: dntShim.Request) => dntShim.Response | Promise<dntShim.Response>;

export interface HttpServer {
  serve(handler: Handler, options?: ServeOptions): Promise<void>;
  close(): Promise<void>;
}

export interface WebSocketUpgradeResult {
  socket: WebSocket;
  response: dntShim.Response;
}

export interface WebSocketUpgradeOptions {
  protocol?: string;
  headers?: dntShim.Headers | Record<string, string>;
}
