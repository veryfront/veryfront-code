import * as dntShim from "../../../../../_dnt.shims.js";
import { DEFAULT_PORT } from "../../../../config/index.js";
const pendingWebSocketUpgrades = new Map();
let wsServer = null;
export class NodeServer {
    server;
    hostname;
    port;
    constructor(server, hostname, port) {
        this.server = server;
        this.hostname = hostname;
        this.port = port;
    }
    stop() {
        return new Promise((resolve) => {
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
function createRequestId(req) {
    const key = req.headers["sec-websocket-key"];
    if (typeof key === "string")
        return key;
    if (Array.isArray(key) && key[0])
        return key[0];
    return dntShim.crypto.randomUUID();
}
export function registerWebSocketUpgrade(requestId) {
    return new Promise((resolve, reject) => {
        pendingWebSocketUpgrades.set(requestId, { resolve, reject });
        dntShim.setTimeout(() => {
            const pending = pendingWebSocketUpgrades.get(requestId);
            if (!pending)
                return;
            pendingWebSocketUpgrades.delete(requestId);
            pending.reject(new Error("WebSocket upgrade timed out"));
        }, 30000);
    });
}
export async function createNodeServer(handler, options = {}) {
    const { port = DEFAULT_PORT, hostname = "localhost", onListen, signal } = options;
    const { createServer } = await import("node:http");
    const server = createServer(async (_req, _res) => {
        try {
            const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? hostname}`);
            const method = _req.method ?? "GET";
            const body = method === "GET" || method === "HEAD" ? null : _req;
            const headersRecord = {};
            for (const [key, value] of Object.entries(_req.headers)) {
                if (typeof value === "string")
                    headersRecord[key] = value;
                else if (Array.isArray(value))
                    headersRecord[key] = value[0] ?? "";
            }
            const requestInit = {
                method,
                headers: headersRecord,
                body: body,
            };
            if (body)
                requestInit.duplex = "half";
            const request = new dntShim.Request(url.toString(), requestInit);
            const response = await handler(request);
            if (response.status === 101)
                return;
            _res.statusCode = response.status;
            _res.statusMessage = response.statusText;
            for (const [key, value] of response.headers) {
                _res.setHeader(key, value);
            }
            if (response.body) {
                const reader = response.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    _res.write(value);
                }
            }
            _res.end();
        }
        catch (error) {
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
                wsServer = new WebSocketServer({ noServer: true });
            }
            const requestId = createRequestId(request);
            wsServer.handleUpgrade(request, socket, head, (ws) => {
                const pending = pendingWebSocketUpgrades.get(requestId);
                if (pending) {
                    pendingWebSocketUpgrades.delete(requestId);
                    pending.resolve(ws);
                }
                wsServer
                    .emit("connection", ws, request);
            });
        }
        catch (error) {
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
            resolve(new NodeServer(server, hostname, port));
        });
    });
}
