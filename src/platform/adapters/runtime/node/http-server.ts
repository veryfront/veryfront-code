import {
  isWebSocketUpgradeResponse,
  type ServeOptions,
  type Server,
  type WebSocketUpgradeResponse,
} from "../../base.ts";
import type { NodeHttpServer, WSWebSocket, WSWebSocketServer } from "./types.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";

const pendingWebSocketUpgrades = new Map<
  string,
  { resolve: (ws: WSWebSocket) => void; reject: (error: Error) => void }
>();

/** Private correlation header injected by Node upgrade transports. */
export const NODE_WEBSOCKET_UPGRADE_ID_HEADER = "x-veryfront-node-upgrade-id";

export class NodeServer implements Server {
  private stopPromise: Promise<void> | undefined;
  private upgradesDisposed = false;
  private httpStopped = false;

  constructor(
    private server: NodeHttpServer,
    private hostname: string,
    private port: number,
    private disposeUpgrades: () => void | Promise<void> = () => {},
  ) {}

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const attempt = this.stopInternal();
    this.stopPromise = attempt;
    void attempt.then(
      () => undefined,
      () => {
        if (this.stopPromise === attempt) this.stopPromise = undefined;
      },
    );
    return attempt;
  }

  private async stopInternal(): Promise<void> {
    if (!this.upgradesDisposed) {
      await this.disposeUpgrades();
      this.upgradesDisposed = true;
    }
    if (!this.httpStopped) {
      await new Promise<void>((resolve, reject) => {
        try {
          this.server.close((error) => error ? reject(error) : resolve());
        } catch (error) {
          reject(error);
        }
      });
      this.httpStopped = true;
    }
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }

  /** @internal Update an ephemeral (`port: 0`) listener with its bound port. */
  setListeningPort(port: number): void {
    this.port = port;
  }
}

export function registerWebSocketUpgrade(requestId: string): Promise<WSWebSocket> {
  if (pendingWebSocketUpgrades.has(requestId)) {
    return Promise.reject(new Error(`WebSocket upgrade "${requestId}" is already pending`));
  }
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

/** Reject and remove a pending transport upgrade, if one exists. */
export function rejectWebSocketUpgrade(requestId: string, error: Error): boolean {
  const pending = pendingWebSocketUpgrades.get(requestId);
  if (!pending) return false;
  pendingWebSocketUpgrades.delete(requestId);
  pending.reject(error);
  return true;
}

function clientDisconnectedError(): DOMException {
  return new DOMException("HTTP client disconnected", "AbortError");
}

function waitForResponseDrain(
  response: import("node:http").ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? clientDisconnectedError());

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", onDrain);
      response.off("error", onError);
      response.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(clientDisconnectedError());
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? clientDisconnectedError());
    };

    response.once("drain", onDrain);
    response.once("error", onError);
    response.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function createNodeServer(
  handler: (
    request: Request,
  ) => Promise<Response | WebSocketUpgradeResponse> | Response | WebSocketUpgradeResponse,
  options: ServeOptions = {},
): Promise<Server> {
  const { port = DEFAULT_PORT, hostname = "localhost", onListen, signal } = options;
  const { createServer } = await import("node:http");
  let wsServer: WSWebSocketServer | null = null;
  let upgradesDisposed = false;
  const rawUpgradeSockets = new Set<{ destroy(): void }>();
  const activeRequestIds = new Set<string>();
  let abortListener: (() => void) | undefined;

  const server = createServer(async (_req, _res) => {
    const requestAbort = new AbortController();
    const abortForDisconnect = () => {
      if (!requestAbort.signal.aborted) requestAbort.abort(clientDisconnectedError());
    };
    const abortForPrematureResponseClose = () => {
      if (!_res.writableEnded) abortForDisconnect();
    };
    _req.once("aborted", abortForDisconnect);
    _res.once("close", abortForPrematureResponseClose);

    let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
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
        signal: requestAbort.signal,
      };

      if (body) requestInit.duplex = "half";

      const request = new Request(url.toString(), requestInit);
      const response = await handler(request);

      if (requestAbort.signal.aborted || _res.destroyed) return;

      if (response.status === 101) return;

      _res.statusCode = response.status;
      _res.statusMessage = response.statusText;

      const responseHeaders = response.headers as Headers & {
        getSetCookie?: () => string[];
      };
      const setCookies = responseHeaders.getSetCookie?.() ?? [];
      for (const [key, value] of response.headers) {
        if (key.toLowerCase() === "set-cookie" && setCookies.length > 0) continue;
        _res.setHeader(key, value);
      }
      if (setCookies.length > 0) _res.setHeader("set-cookie", setCookies);

      if (response.body) {
        responseReader = response.body.getReader();
        while (true) {
          const { done, value } = await responseReader.read();
          if (done) break;
          if (requestAbort.signal.aborted || _res.destroyed) {
            throw requestAbort.signal.reason ?? clientDisconnectedError();
          }
          if (!_res.write(value)) {
            await waitForResponseDrain(_res, requestAbort.signal);
          }
        }
      }

      if (!requestAbort.signal.aborted && !_res.destroyed) _res.end();
    } catch (error) {
      if (requestAbort.signal.aborted || _res.destroyed) return;
      const { serverLogger } = await import("#veryfront/utils");
      serverLogger.error("Request handler error:", error);
      if (!_res.headersSent) {
        _res.statusCode = 500;
        _res.end("Internal Server Error");
      } else {
        _res.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      _req.off("aborted", abortForDisconnect);
      _res.off("close", abortForPrematureResponseClose);
      if (requestAbort.signal.aborted && responseReader) {
        await responseReader.cancel(requestAbort.signal.reason).catch(() => undefined);
      }
    }
  });

  const upgradeListener = (
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Uint8Array,
  ): void => {
    rawUpgradeSockets.add(socket);
    void (async () => {
      const requestId = crypto.randomUUID();
      activeRequestIds.add(requestId);

      try {
        if (upgradesDisposed) {
          activeRequestIds.delete(requestId);
          socket.destroy();
          rawUpgradeSockets.delete(socket);
          return;
        }

        // On Node.js, upgrade events bypass the normal request callback. Run a
        // synthetic request through the handler as the authorization boundary.
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? hostname}`);
        const headersRecord: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === "string") headersRecord[key] = value;
          else if (Array.isArray(value)) headersRecord[key] = value[0] ?? "";
        }
        headersRecord[NODE_WEBSOCKET_UPGRADE_ID_HEADER] = requestId;

        const response = await handler(
          new Request(url.toString(), {
            method: request.method ?? "GET",
            headers: headersRecord,
          }),
        );

        if (upgradesDisposed || !isWebSocketUpgradeResponse(response)) {
          activeRequestIds.delete(requestId);
          rejectWebSocketUpgrade(
            requestId,
            new Error(
              upgradesDisposed
                ? "Node server stopped before WebSocket upgrade completed"
                : "Request handler did not authorize a WebSocket upgrade",
            ),
          );
          socket.destroy();
          rawUpgradeSockets.delete(socket);
          return;
        }

        const { WebSocketServer } = await import("ws");
        if (upgradesDisposed) {
          activeRequestIds.delete(requestId);
          rejectWebSocketUpgrade(
            requestId,
            new Error("Node server stopped before WebSocket upgrade completed"),
          );
          socket.destroy();
          rawUpgradeSockets.delete(socket);
          return;
        }
        if (!wsServer) {
          wsServer = new WebSocketServer({ noServer: true }) as unknown as WSWebSocketServer;
        }

        const ownedServer = wsServer;
        ownedServer.handleUpgrade(request, socket, head, (ws: WSWebSocket) => {
          rawUpgradeSockets.delete(socket);
          activeRequestIds.delete(requestId);
          if (!resolveWebSocketUpgrade(requestId, ws)) {
            if (ws.terminate) ws.terminate();
            else ws.close();
            return;
          }
          ownedServer.emit("connection", ws, request);
        });
      } catch (error) {
        activeRequestIds.delete(requestId);
        rawUpgradeSockets.delete(socket);
        rejectWebSocketUpgrade(
          requestId,
          error instanceof Error ? error : new Error(String(error)),
        );
        const { serverLogger } = await import("#veryfront/utils");
        serverLogger.error("WebSocket upgrade error:", error);
        socket.destroy();
      }
    })();
  };

  server.on("upgrade", upgradeListener);

  const disposeUpgrades = async (): Promise<void> => {
    upgradesDisposed = true;
    server.off("upgrade", upgradeListener);
    if (abortListener) {
      signal?.removeEventListener("abort", abortListener);
      abortListener = undefined;
    }

    for (const socket of rawUpgradeSockets) socket.destroy();
    rawUpgradeSockets.clear();
    for (const requestId of activeRequestIds) {
      rejectWebSocketUpgrade(
        requestId,
        new Error("Node server stopped before WebSocket upgrade completed"),
      );
    }
    activeRequestIds.clear();

    const ownedServer = wsServer;
    if (!ownedServer) return;
    for (const client of ownedServer.clients ?? []) {
      if (client.terminate) client.terminate();
      else client.close();
    }
    await new Promise<void>((resolve, reject) => {
      try {
        ownedServer.close((error) => error ? reject(error) : resolve());
      } catch (error) {
        reject(error);
      }
    });
    if (wsServer === ownedServer) wsServer = null;
  };

  const nodeServer = new NodeServer(
    server as unknown as NodeHttpServer,
    hostname,
    port,
    disposeUpgrades,
  );

  if (signal?.aborted) {
    await disposeUpgrades();
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Node server startup was aborted", "AbortError");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const abortError = (): Error =>
      signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("Node server startup was aborted", "AbortError");
    const rejectAfterCleanup = (error: unknown, cleanup: Promise<void>): void => {
      void cleanup.then(
        () => reject(error),
        (cleanupError) =>
          reject(
            new AggregateError(
              [error, cleanupError],
              `Node server startup and cleanup failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          ),
      );
    };
    const startupErrorListener = (error: Error): void => {
      if (settled) return;
      settled = true;
      server.off("error", startupErrorListener);
      rejectAfterCleanup(error, disposeUpgrades());
    };

    abortListener = () => {
      const error = abortError();
      if (settled) {
        void nodeServer.stop().catch(async (cleanupError) => {
          const { serverLogger } = await import("#veryfront/utils");
          serverLogger.error("Node server abort cleanup failed:", cleanupError);
        });
        return;
      }
      settled = true;
      server.off("error", startupErrorListener);
      rejectAfterCleanup(error, nodeServer.stop());
    };
    signal?.addEventListener("abort", abortListener, { once: true });
    server.once("error", startupErrorListener);

    try {
      server.listen(port, hostname, () => {
        if (settled) {
          void nodeServer.stop();
          return;
        }
        server.off("error", startupErrorListener);
        const address = server.address();
        const listeningPort = typeof address === "object" && address !== null ? address.port : port;
        nodeServer.setListeningPort(listeningPort);
        try {
          onListen?.({ hostname, port: listeningPort });
        } catch (error) {
          settled = true;
          rejectAfterCleanup(error, nodeServer.stop());
          return;
        }
        settled = true;
        resolve(nodeServer);
      });
    } catch (error) {
      startupErrorListener(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
