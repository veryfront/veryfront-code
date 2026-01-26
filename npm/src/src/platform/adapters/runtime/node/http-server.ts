import * as dntShim from "../../../../../_dnt.shims.js";
import type { ServeOptions, Server } from "../../base.js";
import type { NodeHttpServer, WSWebSocket, WSWebSocketServer } from "./types.js";
import { DEFAULT_PORT } from "../../../../config/index.js";

const pendingWebSocketUpgrades = new Map<
  string,
  { resolve: (ws: WSWebSocket) => void; reject: (error: Error) => void }
>();

let wsServer: WSWebSocketServer | null = null;

export class NodeServer implements Server {
  constructor(
    private server: NodeHttpServer,
    private hostname: string,
    private port: number,
  ) {}

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (wsServer) {
        wsServer.close();
        wsServer = null;
      }
      this.server.close(() => resolve());
    });
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }
}

function createRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const key = req.headers["sec-websocket-key"];
  if (typeof key === "string") return key;
  if (Array.isArray(key) && key[0]) return key[0];
  return dntShim.crypto.randomUUID();
}

export function registerWebSocketUpgrade(requestId: string): Promise<WSWebSocket> {
  return new Promise((resolve, reject) => {
    pendingWebSocketUpgrades.set(requestId, { resolve, reject });

    dntShim.setTimeout(() => {
      const pending = pendingWebSocketUpgrades.get(requestId);
      if (!pending) return;

      pendingWebSocketUpgrades.delete(requestId);
      pending.reject(new Error("WebSocket upgrade timed out"));
    }, 30000);
  });
}

export async function createNodeServer(
  handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen, signal } = options;
  const { createServer } = await import("node:http");

  const server = createServer(async (_req, _res) => {
    try {
      const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? hostname}`);
      const method = _req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? null : _req;

      const headersRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(_req.headers)) {
        if (typeof value === "string") headersRecord[key] = value;
        else if (Array.isArray(value)) headersRecord[key] = value[0] ?? "";
      }

      const requestInit: dntShim.RequestInit & { duplex?: string } = {
        method,
        headers: headersRecord,
        body: body as dntShim.BodyInit | null,
      };

      if (body) requestInit.duplex = "half";

      const request = new dntShim.Request(url.toString(), requestInit);
      const response = await handler(request);

      if (response.status === 101) return;

      _res.statusCode = response.status;
      _res.statusMessage = response.statusText;

      for (const [key, value] of response.headers) {
        _res.setHeader(key, value);
      }

      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          _res.write(value);
        }
      }

      _res.end();
    } catch (error) {
      const { serverLogger } = await import("../../../../utils/index.js");
      serverLogger.error("Request handler error:", error);
      _res.statusCode = 500;
      _res.end("Internal Server Error");
    }
  });

  server.on("upgrade", async (request, socket, head) => {
    try {
      const { WebSocketServer } = await import("ws");

      if (!wsServer) {
        wsServer = new WebSocketServer({ noServer: true }) as unknown as WSWebSocketServer;
      }

      const requestId = createRequestId(request);

      (
        wsServer as unknown as {
          handleUpgrade: (
            req: unknown,
            socket: unknown,
            head: unknown,
            callback: (ws: WSWebSocket) => void,
          ) => void;
        }
      ).handleUpgrade(request, socket, head, (ws: WSWebSocket) => {
        const pending = pendingWebSocketUpgrades.get(requestId);
        if (pending) {
          pendingWebSocketUpgrades.delete(requestId);
          pending.resolve(ws);
        }

        (wsServer as unknown as { emit: (event: string, ws: WSWebSocket, req: unknown) => void })
          .emit(
            "connection",
            ws,
            request,
          );
      });
    } catch (error) {
      const { serverLogger } = await import("../../../../utils/index.js");
      serverLogger.error("WebSocket upgrade error:", error);
      socket.destroy();
    }
  });

  signal?.addEventListener("abort", () => {
    if (wsServer) {
      wsServer.close();
      wsServer = null;
    }
    server.close();
  });

  return new Promise((resolve) => {
    server.listen(port, hostname, () => {
      onListen?.({ hostname, port });
      resolve(new NodeServer(server as unknown as NodeHttpServer, hostname, port));
    });
  });
}
