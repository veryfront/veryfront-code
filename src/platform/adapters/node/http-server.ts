import type { ServeOptions, Server } from "../base.ts";
import type { NodeHttpServer, WSWebSocket, WSWebSocketServer } from "./types.ts";
import { DEFAULT_PORT } from "@veryfront/config";

// Track pending WebSocket upgrades by request ID
const pendingWebSocketUpgrades = new Map<string, {
  resolve: (ws: WSWebSocket) => void;
  reject: (error: Error) => void;
}>();

// Singleton WebSocket server instance (one per HTTP server)
let wsServer: WSWebSocketServer | null = null;

export class NodeServer implements Server {
  constructor(
    private server: NodeHttpServer,
    private hostname: string,
    private port: number,
  ) {}

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close WebSocket server first
      if (wsServer) {
        wsServer.close();
        wsServer = null;
      }
      this.server.close(() => resolve());
    });
  }

  get addr() {
    return { hostname: this.hostname, port: this.port };
  }
}

/**
 * Create a request ID for matching WebSocket upgrades
 */
function createRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const key = req.headers["sec-websocket-key"];
  return typeof key === "string" ? key : (Array.isArray(key) ? key[0] : "") || crypto.randomUUID();
}

/**
 * Register a pending WebSocket upgrade
 * Called by NodeServerAdapter.upgradeWebSocket
 */
export function registerWebSocketUpgrade(requestId: string): Promise<WSWebSocket> {
  return new Promise((resolve, reject) => {
    pendingWebSocketUpgrades.set(requestId, { resolve, reject });
    // Cleanup after timeout (30 seconds)
    setTimeout(() => {
      if (pendingWebSocketUpgrades.has(requestId)) {
        pendingWebSocketUpgrades.delete(requestId);
        reject(new Error("WebSocket upgrade timed out"));
      }
    }, 30000);
  });
}

export async function createNodeServer(
  handler: (request: Request) => Promise<Response> | Response,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;
  const { createServer } = await import("node:http");

  const server = createServer(async (_req, _res) => {
    try {
      const url = new URL(_req.url || "/", `http://${_req.headers.host || hostname}`);
      const body = _req.method === "GET" || _req.method === "HEAD" ? null : _req;

      const headersRecord: Record<string, string> = {};
      for (const [key, value] of Object.entries(_req.headers)) {
        if (typeof value === "string") {
          headersRecord[key] = value;
        } else if (Array.isArray(value)) {
          headersRecord[key] = value[0] || "";
        }
      }

      // Node.js 18+ requires duplex: "half" when creating a Request with a streaming body
      const requestInit: RequestInit & { duplex?: string } = {
        method: _req.method,
        headers: headersRecord,
        body: body as BodyInit | null,
      };
      // Only add duplex for requests with a body (POST, PUT, PATCH, etc.)
      if (body !== null) {
        requestInit.duplex = "half";
      }
      const request = new Request(url.toString(), requestInit);

      const response = await handler(request);

      // Check if this is a WebSocket upgrade response (status 101)
      // The actual WebSocket handling is done in the 'upgrade' event
      if (response.status === 101) {
        // Don't end the response - the upgrade handler will take over
        return;
      }

      _res.statusCode = response.status;
      _res.statusMessage = response.statusText;

      for (const [key, value] of response.headers) {
        _res.setHeader(key, value);
      }

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          _res.write(value);
        }
      }

      _res.end();
    } catch (_error) {
      const { serverLogger } = await import("@veryfront/utils");
      serverLogger.error("Request handler error:", _error);
      _res.statusCode = 500;
      _res.end("Internal Server Error");
    }
  });

  // Handle WebSocket upgrades
  server.on("upgrade", async (request, socket, head) => {
    try {
      // Lazy load ws package
      const { WebSocketServer } = await import("ws");

      // Create WebSocket server if not exists
      if (!wsServer) {
        wsServer = new WebSocketServer({ noServer: true }) as unknown as WSWebSocketServer;
      }

      // Get request ID to match with pending upgrade
      const requestId = createRequestId(request);

      // Handle the upgrade
      (wsServer as unknown as {
        handleUpgrade: (
          req: unknown,
          socket: unknown,
          head: unknown,
          callback: (ws: WSWebSocket) => void,
        ) => void;
      })
        .handleUpgrade(request, socket, head, (ws: WSWebSocket) => {
          const pending = pendingWebSocketUpgrades.get(requestId);
          if (pending) {
            pendingWebSocketUpgrades.delete(requestId);
            pending.resolve(ws);
          }
          // Emit connection event
          (wsServer as unknown as { emit: (event: string, ws: WSWebSocket, req: unknown) => void })
            .emit("connection", ws, request);
        });
    } catch (error) {
      const { serverLogger } = await import("@veryfront/utils");
      serverLogger.error("WebSocket upgrade error:", error);
      socket.destroy();
    }
  });

  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      if (wsServer) {
        wsServer.close();
        wsServer = null;
      }
      server.close();
    });
  }

  return new Promise((resolve) => {
    server.listen(port, hostname, () => {
      onListen?.({ hostname, port });
      resolve(new NodeServer(server as unknown as NodeHttpServer, hostname, port));
    });
  });
}
