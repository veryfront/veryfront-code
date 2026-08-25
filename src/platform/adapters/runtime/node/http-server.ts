import {
  isWebSocketUpgradeResponse,
  type ServeOptions,
  type Server,
  type WebSocketUpgradeResponse,
} from "../../base.ts";
import type { NodeHttpServer, WSWebSocket, WSWebSocketServer } from "./types.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import { isErrorAcrossRealms } from "../../../compat/error-introspection.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors/error-registry/general.ts";
import {
  captureNodeWebSocketServer,
  NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
  type NodeWebSocketServerOptions,
  snapshotNodeWebSocketServerProvider,
} from "#veryfront/extensions/websocket";
import { recordRequestPeerFromTransport } from "../shared/request-peer.ts";

const pendingWebSocketUpgrades = new Map<
  string,
  { resolve: (ws: WSWebSocket) => void; reject: (error: Error) => void }
>();
const NODE_WEBSOCKET_UPGRADE_TIMEOUT_MS = 30_000;

function isServerNotRunningError(error: Error): boolean {
  let current: object | null = error;
  while (current && current !== Error.prototype && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "code");
    if (descriptor !== undefined) {
      return "value" in descriptor && descriptor.value === "ERR_SERVER_NOT_RUNNING";
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

/** Private correlation header injected by Node upgrade transports. */
export const NODE_WEBSOCKET_UPGRADE_ID_HEADER = "x-veryfront-node-upgrade-id";

export class NodeServer implements Server {
  private stopPromise: Promise<void> | undefined;
  private upgradesDisposed = false;
  private httpStopped = false;
  private transportListenersDetached = false;
  private transportState: "idle" | "pending" | "bound" | "close-observed" = "idle";
  private transportCloseObserver: (() => void) | undefined;

  constructor(
    private server: NodeHttpServer,
    private hostname: string,
    private port: number,
    private disposeUpgrades: () => void | Promise<void> = () => {},
    private detachTransportListeners: () => void = () => {},
  ) {
    if (typeof server.once === "function") {
      this.transportCloseObserver = () => {
        this.transportState = "close-observed";
        this.transportCloseObserver = undefined;
      };
      server.once("close", this.transportCloseObserver);
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    // Defer cleanup until after the shared promise is published. Upgrade
    // disposal aborts application-visible requests synchronously, and their
    // listeners are allowed to re-enter stop().
    const attempt = Promise.resolve().then(() => this.stopInternal());
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
      if (this.transportState === "close-observed") {
        this.httpStopped = true;
      } else {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let observesClose = false;
          const detachCloseListener = (): void => {
            if (!observesClose) return;
            observesClose = false;
            try {
              this.server.off?.("close", onClose);
            } catch {
              // Node's once-listener removes itself before invocation. A
              // diagnostic off() failure cannot make a closed server live.
            }
          };
          const settle = (error?: unknown): void => {
            if (settled) return;
            settled = true;
            detachCloseListener();
            if (error === undefined) resolve();
            else reject(error);
          };
          const onClose = (): void => settle();
          try {
            if (typeof this.server.once === "function") {
              this.server.once("close", onClose);
              observesClose = true;
            }
            this.server.close((error) => {
              if (!error) {
                settle();
                return;
              }
              // During a pending bind Node can report NOT_RUNNING before its
              // close event. Wait for that event to finish this close attempt.
              // This does not prove that the queued lookup was cancelled; the
              // startup coordinator retains ownership of any later
              // listening/error outcome.
              if (isServerNotRunningError(error)) {
                if (observesClose && this.transportState === "pending") return;
                settle();
                return;
              }
              settle(error);
            });
            // `close()` waits for active HTTP requests and can otherwise
            // deadlock with handlers that are waiting for their Fetch signal to
            // abort. Use Node's explicit force-close phase.
            this.server.closeAllConnections?.();
          } catch (error) {
            settle(error);
          }
        });
        this.httpStopped = true;
        this.transportState = "close-observed";
      }
      if (this.transportCloseObserver) {
        try {
          this.server.off?.("close", this.transportCloseObserver);
        } finally {
          this.transportCloseObserver = undefined;
        }
      }
    }
    if (!this.transportListenersDetached) {
      this.detachTransportListeners();
      this.transportListenersDetached = true;
    }
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }

  /** @internal Native transport for compatibility facades that expose Node's server. */
  get nativeHttpServer(): import("node:http").Server {
    return this.server as import("node:http").Server;
  }

  /** @internal Update an ephemeral (`port: 0`) listener with its bound port. */
  setListeningPort(port: number): void {
    this.port = port;
    if (this.transportState !== "close-observed") this.transportState = "bound";
  }

  /** @internal Mark the native listen request as pending. */
  markListenStarted(): void {
    if (this.transportState === "idle") this.transportState = "pending";
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
    }, NODE_WEBSOCKET_UPGRADE_TIMEOUT_MS);

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

export function hasPendingWebSocketUpgrade(requestId: string): boolean {
  return pendingWebSocketUpgrades.has(requestId);
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

function logContainedNodeRuntimeError(message: string, error: unknown): void {
  void import("#veryfront/utils/logger/logger.ts").then(
    ({ serverLogger }) => {
      try {
        serverLogger.error(message, error);
      } catch {
        // A diagnostic failure must not escape Node's EventEmitter boundary.
      }
    },
    () => {
      // The runtime error is already contained and there is no safe logger.
    },
  );
}

function reportNodeRuntimeError(
  callback: NonNullable<ServeOptions["onRuntimeError"]>,
  error: Error,
): void {
  try {
    void Promise.resolve(callback(error)).catch((callbackError) => {
      logContainedNodeRuntimeError(
        "Node HTTP runtime error callback failed",
        callbackError,
      );
    });
  } catch (callbackError) {
    logContainedNodeRuntimeError(
      "Node HTTP runtime error callback failed",
      callbackError,
    );
  }
}

function retireLateNodeListener(
  server: import("node:http").Server,
  onSettled: () => void,
): void {
  let settled = false;
  const settle = (error?: unknown): void => {
    if (settled) return;
    settled = true;
    server.off("close", onClose);
    try {
      onSettled();
    } catch (cleanupError) {
      logContainedNodeRuntimeError(
        "Node HTTP late-startup listener cleanup failed",
        cleanupError,
      );
    }
    if (error !== undefined) {
      logContainedNodeRuntimeError(
        "Node HTTP listener bound after startup cancellation and failed to close",
        error,
      );
    }
  };
  const onClose = (): void => settle();

  server.once("close", onClose);
  try {
    // Node can bind after close() has already reported a pending listen as
    // closed. Begin a fresh native close inside the listening callback, before
    // the event loop can dispatch connections for that resurrected handle.
    server.close((error) => {
      if (!error || isServerNotRunningError(error)) settle();
      else settle(error);
    });
    server.closeAllConnections?.();
  } catch (error) {
    settle(error);
  }
}

function absorbCanceledNodeListenError(
  this: import("node:http").Server,
): void {
  this.off("listening", retireCanceledNodeListener);
}

function retireCanceledNodeListener(
  this: import("node:http").Server,
): void {
  this.off("error", absorbCanceledNodeListenError);
  retireLateNodeListener(this, () => undefined);
}

function armCanceledNodeListenGuards(server: import("node:http").Server): void {
  // Some Node resolver paths may still bind or emit a bind error after close()
  // reports that a pending hostname listen is closed. Shared one-shot guards
  // own either late outcome without retaining application/startup closures.
  server.once("error", absorbCanceledNodeListenError);
  server.once("listening", retireCanceledNodeListener);
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

const NODE_MANAGED_WEBSOCKET_RESPONSE_HEADERS = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "upgrade",
]);

function appendApplicationUpgradeHeaders(
  wireHeaders: string[],
  responseHeaders: Headers,
): void {
  const extendedHeaders = responseHeaders as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = extendedHeaders.getSetCookie?.() ?? [];

  for (const [name, value] of responseHeaders) {
    const normalizedName = name.toLowerCase();
    if (NODE_MANAGED_WEBSOCKET_RESPONSE_HEADERS.has(normalizedName)) continue;
    if (normalizedName === "set-cookie" && setCookies.length > 0) continue;
    wireHeaders.push(`${name}: ${value}`);
  }
  for (const cookie of setCookies) wireHeaders.push(`set-cookie: ${cookie}`);
}

/**
 * Request-scoped handshake metadata shared with `ws`.
 *
 * `ws` otherwise auto-selects the first offered subprotocol and owns the wire
 * response headers. Both Node server entry points use this controller so the
 * application-selected protocol and custom headers are applied exactly once.
 */
export class NodeWebSocketHandshakeController {
  private readonly metadata = new WeakMap<
    object,
    { readonly headers: Headers; readonly protocol?: string }
  >();

  readonly serverOptions: NodeWebSocketServerOptions = Object.freeze({
    noServer: true,
    handleProtocols: (_protocols: ReadonlySet<string>, request: object) =>
      this.metadata.get(request)?.protocol ?? false,
  });

  attach(server: Pick<WSWebSocketServer, "on">): void {
    server.on("headers", (headers, request) => {
      if (typeof request !== "object" || request === null) return;
      const metadata = this.metadata.get(request);
      if (metadata) appendApplicationUpgradeHeaders(headers, metadata.headers);
    });
  }

  authorize(request: object, response: WebSocketUpgradeResponse): void {
    const headers = new Headers(response.headers);
    const protocol = headers.get("sec-websocket-protocol") ?? undefined;
    this.metadata.set(request, {
      headers,
      ...(protocol ? { protocol } : {}),
    });
  }

  release(request: object): void {
    this.metadata.delete(request);
  }
}

export type NodeRequestHandler = (
  request: Request,
) => Promise<Response | WebSocketUpgradeResponse> | Response | WebSocketUpgradeResponse;

/**
 * Create the canonical Node listener for Web Request/Response handlers.
 *
 * This owns disconnect propagation, response backpressure, streaming failure
 * containment, and listener cleanup for both Platform and public compatibility
 * surfaces.
 */
export function createNodeRequestListener(
  handler: NodeRequestHandler,
  fallbackHostname = "localhost",
): (
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) => Promise<void> {
  return async (_req, _res) => {
    const requestAbort = new AbortController();
    let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abortForDisconnect = () => {
      if (!requestAbort.signal.aborted) requestAbort.abort(clientDisconnectedError());
      void responseReader?.cancel(requestAbort.signal.reason).catch(() => undefined);
    };
    const abortForPrematureResponseClose = () => {
      if (!_res.writableEnded) abortForDisconnect();
    };
    _req.once("aborted", abortForDisconnect);
    _res.once("close", abortForPrematureResponseClose);

    try {
      const url = new URL(_req.url ?? "/", `http://${_req.headers.host ?? fallbackHostname}`);
      const method = _req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? null : _req;
      const headers = new Headers();
      for (const [key, value] of Object.entries(_req.headers)) {
        if (typeof value === "string") headers.append(key, value);
        else if (Array.isArray(value)) {
          for (const entry of value) headers.append(key, entry);
        }
      }

      const requestInit: RequestInit & { duplex?: string } = {
        method,
        headers,
        body: body as BodyInit | null,
        signal: requestAbort.signal,
      };

      if (body) requestInit.duplex = "half";

      const request = new Request(url.toString(), requestInit);
      if (typeof _req.socket.remoteAddress === "string") {
        recordRequestPeerFromTransport(request, {
          runtime: "node",
          transport: "tcp",
          hostname: _req.socket.remoteAddress,
        });
      }
      const response = await handler(request);

      if (requestAbort.signal.aborted || _res.destroyed) return;

      if (isWebSocketUpgradeResponse(response)) {
        throw new Error(
          "A WebSocket upgrade response is only valid for an HTTP Upgrade request",
        );
      }

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
      const { serverLogger } = await import("#veryfront/utils/logger/logger.ts");
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
  };
}

export async function createNodeServer(
  handler: NodeRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  return await createNodeServerInternal(handler, options);
}

/** @internal Publish startup cleanup ownership before listener readiness. */
export function createNodeServerWithStartupOwner(
  handler: NodeRequestHandler,
  options: ServeOptions,
  ownStartupServer: (server: NodeServer) => void,
): Promise<NodeServer> {
  if (typeof ownStartupServer !== "function") {
    return Promise.reject(new TypeError("Node server startup owner must be a function"));
  }
  return createNodeServerInternal(handler, options, ownStartupServer);
}

async function createNodeServerInternal(
  handler: NodeRequestHandler,
  options: ServeOptions,
  ownStartupServer?: (server: NodeServer) => void,
): Promise<NodeServer> {
  const {
    port = DEFAULT_PORT,
    hostname = "localhost",
    onListen,
    onRuntimeError,
    signal,
  } = options;
  const nodeWebSocketServerProvider = options.nodeWebSocketServerProvider === undefined
    ? undefined
    : snapshotNodeWebSocketServerProvider(options.nodeWebSocketServerProvider);
  if (onRuntimeError !== undefined && typeof onRuntimeError !== "function") {
    throw new TypeError("Node server runtime error callback must be a function");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(`Node server port must be an integer from 0 to 65535, got ${port}`);
  }
  if (signal?.aborted) {
    throw isErrorAcrossRealms(signal.reason)
      ? signal.reason
      : new DOMException("Node server startup was aborted", "AbortError");
  }
  const { createServer } = await import("node:http");
  if (signal?.aborted) {
    throw isErrorAcrossRealms(signal.reason)
      ? signal.reason
      : new DOMException("Node server startup was aborted", "AbortError");
  }
  let wsServer: WSWebSocketServer | null = null;
  const ownedWebSocketServers = new Set<WSWebSocketServer>();
  const webSocketServerRetirements = new Map<WSWebSocketServer, Promise<void>>();
  let upgradesDisposed = false;
  const rawUpgradeSockets = new Set<import("node:stream").Duplex>();
  const activeRequestIds = new Set<string>();
  const upgradeAbortControllers = new Map<string, AbortController>();
  const handshakeController = new NodeWebSocketHandshakeController();
  let abortListener: (() => void) | undefined;
  let transportErrorListener: ((error: Error) => void) | undefined;
  let startupListeningListener: (() => void) | undefined;
  let retainTransportErrorListener = false;

  const retireWebSocketServer = (ownedServer: WSWebSocketServer): Promise<void> => {
    if (!ownedWebSocketServers.has(ownedServer)) return Promise.resolve();
    const existing = webSocketServerRetirements.get(ownedServer);
    if (existing) return existing;

    const attempt = Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      try {
        for (const client of ownedServer.clients ?? []) {
          try {
            if (client.terminate) client.terminate();
            else client.close();
          } catch (error) {
            failures.push(error);
          }
        }
      } catch (error) {
        failures.push(error);
      }

      let closed = false;
      try {
        await new Promise<void>((resolve, reject) => {
          try {
            ownedServer.close((error) => error ? reject(error) : resolve());
          } catch (error) {
            reject(error);
          }
        });
        closed = true;
      } catch (error) {
        failures.push(error);
      }

      if (closed) {
        ownedWebSocketServers.delete(ownedServer);
        if (wsServer === ownedServer) wsServer = null;
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "Node WebSocket server retirement failed");
      }
    });
    webSocketServerRetirements.set(ownedServer, attempt);
    void attempt.then(
      () => {
        if (webSocketServerRetirements.get(ownedServer) === attempt) {
          webSocketServerRetirements.delete(ownedServer);
        }
      },
      () => {
        if (webSocketServerRetirements.get(ownedServer) === attempt) {
          webSocketServerRetirements.delete(ownedServer);
        }
      },
    );
    return attempt;
  };

  const server = createServer(createNodeRequestListener(handler, hostname));

  const upgradeListener = (
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Uint8Array,
  ): void => {
    rawUpgradeSockets.add(socket);
    void (async () => {
      const requestId = crypto.randomUUID();
      activeRequestIds.add(requestId);
      const requestAbort = new AbortController();
      upgradeAbortControllers.set(requestId, requestAbort);
      let transportSettled = false;

      const clearTransportState = (): void => {
        activeRequestIds.delete(requestId);
        upgradeAbortControllers.delete(requestId);
        handshakeController.release(request);
        rawUpgradeSockets.delete(socket);
        socket.off("close", onSocketClose);
      };
      const failUpgrade = (error: Error): void => {
        if (transportSettled) return;
        transportSettled = true;
        clearTransportState();
        if (!requestAbort.signal.aborted) requestAbort.abort(error);
        rejectWebSocketUpgrade(requestId, error);
        socket.destroy();
      };
      const onSocketClose = (): void => {
        failUpgrade(new DOMException("WebSocket client disconnected", "AbortError"));
      };
      socket.once("close", onSocketClose);

      try {
        if (upgradesDisposed) {
          failUpgrade(new Error("Node server stopped before WebSocket upgrade completed"));
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

        const webRequest = new Request(url.toString(), {
          method: request.method ?? "GET",
          headers: headersRecord,
          signal: requestAbort.signal,
        });
        if (typeof request.socket.remoteAddress === "string") {
          recordRequestPeerFromTransport(webRequest, {
            runtime: "node",
            transport: "tcp",
            hostname: request.socket.remoteAddress,
          });
        }
        const response = await handler(webRequest);

        if (upgradesDisposed || !isWebSocketUpgradeResponse(response)) {
          failUpgrade(
            new Error(
              upgradesDisposed
                ? "Node server stopped before WebSocket upgrade completed"
                : "Request handler did not authorize a WebSocket upgrade",
            ),
          );
          return;
        }
        if (!hasPendingWebSocketUpgrade(requestId)) {
          failUpgrade(
            new Error(
              "Request handler returned a WebSocket upgrade response without registering an application socket",
            ),
          );
          return;
        }

        if (upgradesDisposed || transportSettled || requestAbort.signal.aborted) {
          failUpgrade(new Error("Node server stopped before WebSocket upgrade completed"));
          return;
        }
        if (nodeWebSocketServerProvider === undefined) {
          failUpgrade(new Error(NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE));
          return;
        }
        if (!wsServer) {
          const candidate = captureNodeWebSocketServer(
            nodeWebSocketServerProvider.createServer(
              handshakeController.serverOptions,
            ),
          );
          ownedWebSocketServers.add(candidate);
          try {
            handshakeController.attach(candidate);
          } catch (error) {
            void retireWebSocketServer(candidate).catch((cleanupError) => {
              logContainedNodeRuntimeError(
                "Node WebSocket initialization cleanup failed",
                cleanupError,
              );
            });
            throw error;
          }
          wsServer = candidate;
        }

        handshakeController.authorize(request, response);

        const ownedServer = wsServer;
        ownedServer.handleUpgrade(request, socket, head, (ws: WSWebSocket) => {
          if (transportSettled) {
            if (ws.terminate) ws.terminate();
            else ws.close();
            return;
          }
          transportSettled = true;
          clearTransportState();
          if (!resolveWebSocketUpgrade(requestId, ws)) {
            if (ws.terminate) ws.terminate();
            else ws.close();
            return;
          }
          ownedServer.emit("connection", ws, request);
        });
      } catch (error) {
        failUpgrade(error instanceof Error ? error : new Error(String(error)));
        const { serverLogger } = await import("#veryfront/utils/logger/logger.ts");
        serverLogger.error("WebSocket upgrade error:", error);
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

    const stoppedError = new Error("Node server stopped before WebSocket upgrade completed");
    for (const controller of upgradeAbortControllers.values()) {
      if (!controller.signal.aborted) controller.abort(stoppedError);
    }
    upgradeAbortControllers.clear();
    for (const socket of rawUpgradeSockets) socket.destroy();
    rawUpgradeSockets.clear();
    for (const requestId of activeRequestIds) {
      rejectWebSocketUpgrade(requestId, stoppedError);
    }
    activeRequestIds.clear();

    const failures: unknown[] = [];
    await Promise.all(
      [...ownedWebSocketServers].map((ownedServer) =>
        retireWebSocketServer(ownedServer).catch((error) => failures.push(error))
      ),
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Node WebSocket server cleanup failed");
    }
  };

  const detachTransportErrorListener = (): void => {
    if (retainTransportErrorListener) return;
    if (!transportErrorListener) return;
    server.off("error", transportErrorListener);
    transportErrorListener = undefined;
  };
  const detachStartupListeningListener = (): void => {
    if (!startupListeningListener) return;
    server.off("listening", startupListeningListener);
    startupListeningListener = undefined;
  };

  const nodeServer = new NodeServer(
    server as NodeHttpServer,
    hostname,
    port,
    disposeUpgrades,
    detachTransportErrorListener,
  );
  try {
    ownStartupServer?.(nodeServer);
  } catch (error) {
    try {
      await nodeServer.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Node server startup ownership and cleanup both failed",
      );
    }
    throw error;
  }

  return new Promise((resolve, reject) => {
    let phase: "starting" | "ready" | "startup-cleanup" = "starting";
    let invokingOnListen = false;
    let nativeListenOutcomePending = false;
    const abortError = (): Error =>
      isErrorAcrossRealms(signal?.reason)
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
    const cleanupStartup = async (cleanup: Promise<void>): Promise<void> => {
      await cleanup;
      if (nativeListenOutcomePending) {
        detachStartupListeningListener();
        retainTransportErrorListener = false;
        detachTransportErrorListener();
        nativeListenOutcomePending = false;
        armCanceledNodeListenGuards(server);
        return;
      }
      retainTransportErrorListener = false;
      detachTransportErrorListener();
      detachStartupListeningListener();
    };
    transportErrorListener = (error: Error): void => {
      if (phase === "ready") {
        if (onRuntimeError) reportNodeRuntimeError(onRuntimeError, error);
        return;
      }
      if (phase === "startup-cleanup") {
        if (nativeListenOutcomePending) {
          nativeListenOutcomePending = false;
          retainTransportErrorListener = false;
          detachTransportErrorListener();
          detachStartupListeningListener();
        }
        return;
      }
      nativeListenOutcomePending = false;
      // A transport error raised synchronously by work inside onListen must
      // interrupt that callback. Otherwise its caller can commit readiness
      // after this adapter has already started rollback.
      if (invokingOnListen) {
        phase = "startup-cleanup";
        rejectAfterCleanup(error, cleanupStartup(nodeServer.stop()));
        throw error;
      }
      phase = "startup-cleanup";
      rejectAfterCleanup(
        error,
        cleanupStartup(nodeServer.stop()),
      );
    };

    abortListener = () => {
      const error = abortError();
      if (phase === "ready") {
        void nodeServer.stop().catch((cleanupError) => {
          logContainedNodeRuntimeError(
            "Node server abort cleanup failed",
            cleanupError,
          );
        });
        return;
      }
      if (phase === "startup-cleanup") return;
      phase = "startup-cleanup";
      retainTransportErrorListener = nativeListenOutcomePending;
      rejectAfterCleanup(error, cleanupStartup(nodeServer.stop()));
    };
    signal?.addEventListener("abort", abortListener, { once: true });
    // `ownStartupServer` can synchronously abort after the pre-import signal
    // checks but before this listener exists. Registration plus an immediate
    // state check closes that window without starting the native listener.
    if (signal?.aborted) {
      abortListener();
      return;
    }
    server.on("error", transportErrorListener);

    const onListening = (): void => {
      startupListeningListener = undefined;
      nativeListenOutcomePending = false;
      if (phase !== "starting") {
        retireLateNodeListener(server, () => {
          retainTransportErrorListener = false;
          detachTransportErrorListener();
        });
        return;
      }
      const address = server.address();
      const listeningPort = typeof address === "object" && address !== null ? address.port : port;
      nodeServer.setListeningPort(listeningPort);
      try {
        invokingOnListen = true;
        onListen?.({ hostname, port: listeningPort });
      } catch (error) {
        if (phase !== "starting") return;
        phase = "startup-cleanup";
        rejectAfterCleanup(error, cleanupStartup(nodeServer.stop()));
        return;
      } finally {
        invokingOnListen = false;
      }
      if (phase !== "starting") return;
      phase = "ready";
      if (!onRuntimeError) detachTransportErrorListener();
      resolve(nodeServer);
    };
    startupListeningListener = onListening;
    server.once("listening", onListening);
    try {
      server.listen(port, hostname);
      nativeListenOutcomePending = true;
      nodeServer.markListenStarted();
    } catch (error) {
      transportErrorListener(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
