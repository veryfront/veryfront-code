import type { ServeOptions, Server } from "../../base.ts";
import type { NodeHttpServer, WSWebSocket, WSWebSocketServer } from "./types.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";

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
      wsServer?.close();
      wsServer = null;
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
  return crypto.randomUUID();
}

export function registerWebSocketUpgrade(requestId: string): Promise<WSWebSocket> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const pending = pendingWebSocketUpgrades.get(requestId);
      if (!pending) return;

      pendingWebSocketUpgrades.delete(requestId);
      pending.reject(TIMEOUT_ERROR.create({ detail: "WebSocket upgrade timed out" }));
    }, 30000);

    pendingWebSocketUpgrades.set(requestId, {
      resolve: (ws) => {
        clearTimeout(timeoutId);
        resolve(ws);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });
  });
}

export function resolveWebSocketUpgrade(requestId: string, ws: WSWebSocket): boolean {
  const pending = pendingWebSocketUpgrades.get(requestId);
  if (!pending) return false;
  pendingWebSocketUpgrades.delete(requestId);
  pending.resolve(ws);
  return true;
}

export async function createNodeServer(
  handler: (request: Request) => Promise<Response> | Response,
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

      const requestInit: RequestInit & { duplex?: string } = {
        method,
        headers: headersRecord,
        body: body as BodyInit | null,
      };

      if (body) requestInit.duplex = "half";

      const request = new Request(url.toString(), requestInit);
      const response = await handler(request);

      if (response.status === 101) return;

      _res.statusCode = response.status;
      _res.statusMessage = response.statusText;

      for (const [key, value] of response.headers) _res.setHeader(key, value);

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          _res.write(value);
        }
      }

      _res.end();
    } catch (error) {
      const { serverLogger } = await import("#veryfront/utils");
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

      // On Node.js, 'upgrade' events bypass the normal 'request' handler entirely.
      // Construct a synthetic Request and run it through the handler pipeline so that
      // handlers like HMRHandler can call upgradeWebSocket(), which registers a
      // pending entry in pendingWebSocketUpgrades before the transport-level upgrade.
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? hostname}`);
      const headersRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headersRecord[key] = value;
        else if (Array.isArray(value)) headersRecord[key] = value[0] ?? "";
      }

      const syntheticRequest = new Request(url.toString(), {
        method: request.method ?? "GET",
        headers: headersRecord,
      });

      await handler(syntheticRequest);

      // Complete the actual WebSocket upgrade at the transport level.
      // If a handler called upgradeWebSocket(), a pending promise exists
      // in pendingWebSocketUpgrades and will be resolved here.
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
        resolveWebSocketUpgrade(requestId, ws);

        (wsServer as unknown as { emit: (event: string, ws: WSWebSocket, req: unknown) => void })
          .emit(
            "connection",
            ws,
            request,
          );
      });
    } catch (error) {
      const { serverLogger } = await import("#veryfront/utils");
      serverLogger.error("WebSocket upgrade error:", error);
      socket.destroy();
    }
  });

  signal?.addEventListener("abort", () => {
    wsServer?.close();
    wsServer = null;
    server.close();
  }, { once: true });

  return new Promise((resolve) => {
    server.listen(port, hostname, () => {
      onListen?.({ hostname, port });
      resolve(new NodeServer(server as unknown as NodeHttpServer, hostname, port));
    });
  });
}
