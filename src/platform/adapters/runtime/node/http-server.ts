import {
  isWebSocketUpgradeResponse,
  type RuntimeRequestHandler,
  type RuntimeResponse,
  type ServeOptions,
  type Server,
} from "../../base.ts";
import type {
  NodeHttpServer,
  NodeIncomingMessage,
  NodeUpgradeSocket,
  WSWebSocketServer,
} from "./types.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import { convertNodeRequestToWebRequest } from "../../../compat/http/request-adapter.ts";
import { writeNodeResponse } from "../../../compat/http/node-server.ts";
import { PORT_IN_USE, SERVER_START_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { INVALID_ARGUMENT, TIMEOUT_ERROR } from "#veryfront/errors/error-registry/general.ts";
import type { VeryfrontError } from "#veryfront/errors/types.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { getSystemErrorCode } from "../shared/filesystem-errors.ts";
import {
  type RegisteredNodeWebSocketUpgrade,
  runWithNodeWebSocketRequest,
} from "./websocket-adapter.ts";

const logger = serverLogger.component("node");
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
const MAX_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_147_483_647;
const FORCED_SHUTDOWN_SETTLE_MS = 250;
interface PendingUpgrade {
  socket: NodeUpgradeSocket;
  upgrade?: RegisteredNodeWebSocketUpgrade;
}

export interface NodeWebSocketUpgradeController {
  handle(
    request: NodeIncomingMessage,
    socket: NodeUpgradeSocket,
    head: Uint8Array,
  ): Promise<void>;
  close(): Promise<void>;
}

function createRequestUrl(
  request: NodeIncomingMessage,
  hostname: string,
  port: number,
): string {
  const host = request.headers.host;
  const requestHost = Array.isArray(host) ? host[0] : host;
  return new URL(
    request.url ?? "/",
    `http://${requestHost || `${hostname}:${port}`}`,
  ).toString();
}

function responseMustNotHaveBody(method: string | undefined, status: number): boolean {
  return method?.toUpperCase() === "HEAD" || status === 204 || status === 304 ||
    (status >= 100 && status < 200);
}

function waitForSocketDrain(socket: NodeUpgradeSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.off("drain", onDrain);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("Upgrade response socket closed"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    socket.once("drain", onDrain);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function writeSocket(
  socket: NodeUpgradeSocket,
  chunk: string | Uint8Array,
): Promise<void> {
  if (socket.destroyed || socket.writableEnded) {
    throw new Error("Upgrade response socket is unavailable");
  }
  if (!socket.write(chunk)) await waitForSocketDrain(socket);
}

function getHeaderLines(
  response: Response,
  hasBody: boolean,
  chunked: boolean,
): string[] {
  const lines: string[] = [];
  for (const [name, value] of response.headers) {
    const normalized = name.toLowerCase();
    if (
      normalized === "connection" || normalized === "upgrade" ||
      normalized === "transfer-encoding" || normalized === "set-cookie" ||
      (!hasBody && normalized === "content-length")
    ) continue;
    lines.push(`${name}: ${value}`);
  }

  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  for (const cookie of headers.getSetCookie?.() ?? []) lines.push(`set-cookie: ${cookie}`);
  lines.push("connection: close");
  if (chunked) lines.push("transfer-encoding: chunked");
  else if (!hasBody) lines.push("content-length: 0");
  return lines;
}

async function writeUpgradeRejection(
  request: NodeIncomingMessage,
  socket: NodeUpgradeSocket,
  response: Response,
): Promise<void> {
  const hasBody = response.body !== null &&
    !responseMustNotHaveBody(request.method, response.status);
  const chunked = hasBody && !response.headers.has("content-length");
  const statusText = response.statusText || "Request Rejected";
  const headerLines = getHeaderLines(response, hasBody, chunked);
  await writeSocket(
    socket,
    `HTTP/1.1 ${response.status} ${statusText}\r\n${headerLines.join("\r\n")}\r\n\r\n`,
  );

  if (!response.body || !hasBody) {
    if (response.body) await response.body.cancel("Upgrade response does not permit a body");
    if (!socket.destroyed && !socket.writableEnded) socket.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (!socket.destroyed && !socket.writableEnded) {
      const { done, value } = await reader.read();
      if (done) break;
      if (chunked) {
        await writeSocket(socket, `${value.byteLength.toString(16)}\r\n`);
        await writeSocket(socket, value);
        await writeSocket(socket, "\r\n");
      } else {
        await writeSocket(socket, value);
      }
    }
    if (!socket.destroyed && !socket.writableEnded) {
      socket.end(chunked ? "0\r\n\r\n" : undefined);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have released its reader after cancellation.
    }
  }
}

function appendUpgradeHeaders(
  target: string[],
  headers: Headers,
): void {
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "set-cookie") target.push(`${name}: ${value}`);
  }
  const withCookies = headers as Headers & { getSetCookie?: () => string[] };
  for (const cookie of withCookies.getSetCookie?.() ?? []) target.push(`set-cookie: ${cookie}`);
}

export async function createNodeWebSocketUpgradeController(
  handler: RuntimeRequestHandler,
  hostname: string,
  port: number,
): Promise<NodeWebSocketUpgradeController> {
  const { WebSocketServer } = await import("npm:ws@8.21.0");
  const registrationByRequest = new WeakMap<object, RegisteredNodeWebSocketUpgrade>();
  const wsServer = new WebSocketServer({
    noServer: true,
    handleProtocols(_protocols: ReadonlySet<string>, request: object) {
      return registrationByRequest.get(request)?.protocol ?? false;
    },
  }) as unknown as WSWebSocketServer;
  const pending = new Set<PendingUpgrade>();
  let closePromise: Promise<void> | null = null;
  let closing = false;

  wsServer.on("headers", (headers, request) => {
    const upgrade = registrationByRequest.get(request);
    if (upgrade) appendUpgradeHeaders(headers, upgrade.headers);
  });
  wsServer.on("error", () => logger.error("WebSocket server failed"));

  const handle = async (
    nativeRequest: NodeIncomingMessage,
    socket: NodeUpgradeSocket,
    head: Uint8Array,
  ): Promise<void> => {
    if (closing) {
      socket.destroy();
      return;
    }

    const pendingUpgrade: PendingUpgrade = { socket };
    pending.add(pendingUpgrade);
    try {
      const request = convertNodeRequestToWebRequest(
        nativeRequest,
        createRequestUrl(nativeRequest, hostname, port),
      );
      let execution: Awaited<ReturnType<typeof runWithNodeWebSocketRequest<RuntimeResponse>>>;
      try {
        execution = await runWithNodeWebSocketRequest(
          request,
          () => handler(request),
          (upgrade) => {
            pendingUpgrade.upgrade = upgrade;
          },
        );
      } catch {
        pendingUpgrade.upgrade?.socket._failUpgrade();
        await writeUpgradeRejection(
          nativeRequest,
          socket,
          new Response("Internal Server Error", { status: 500 }),
        );
        return;
      }

      const upgrade = execution.upgrade;
      if (
        !upgrade || !isWebSocketUpgradeResponse(execution.value) ||
        execution.value !== upgrade.result.response
      ) {
        upgrade?.socket._failUpgrade();
        const response = execution.value instanceof Response
          ? execution.value
          : new Response("Internal Server Error", { status: 500 });
        await writeUpgradeRejection(nativeRequest, socket, response);
        return;
      }
      if (closing || socket.destroyed) {
        upgrade.socket._failUpgrade();
        socket.destroy();
        return;
      }

      registrationByRequest.set(nativeRequest, upgrade);
      try {
        wsServer.handleUpgrade(nativeRequest, socket, head, (webSocket) => {
          registrationByRequest.delete(nativeRequest);
          if (closing) {
            webSocket.terminate();
            upgrade.socket._failUpgrade();
            return;
          }
          upgrade.socket._attachRealSocket(webSocket);
          wsServer.emit("connection", webSocket, nativeRequest);
        });
      } catch {
        registrationByRequest.delete(nativeRequest);
        upgrade.socket._failUpgrade();
        socket.destroy();
      }
    } catch {
      pendingUpgrade.upgrade?.socket._failUpgrade();
      socket.destroy();
    } finally {
      pending.delete(pendingUpgrade);
    }
  };

  const close = (): Promise<void> => {
    if (!closePromise) {
      closing = true;
      for (const entry of pending) {
        entry.upgrade?.socket._failUpgrade();
        entry.socket.destroy();
      }
      for (const socket of wsServer.clients) socket.terminate();
      const closeOperation = new Promise<void>((resolve, reject) => {
        try {
          wsServer.close((error) => error ? reject(error) : resolve());
        } catch (error) {
          reject(error);
        }
      });
      const retryable = closeOperation.catch((error) => {
        if (closePromise === retryable) closePromise = null;
        throw error;
      });
      closePromise = retryable;
    }
    return closePromise;
  };

  return { close, handle };
}

function validateGracefulShutdownTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 0 ||
    timeoutMs > MAX_GRACEFUL_SHUTDOWN_TIMEOUT_MS
  ) {
    throw INVALID_ARGUMENT.create({
      message:
        `Node graceful shutdown timeout must be an integer between 0 and ${MAX_GRACEFUL_SHUTDOWN_TIMEOUT_MS}`,
    });
  }
  return timeoutMs;
}

function closeHttpServer(
  server: NodeHttpServer,
  gracefulShutdownTimeoutMs = DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let forceSettleId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceSettleId) clearTimeout(forceSettleId);
    };
    const settle = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const shutdownTimeoutError = (cause?: unknown) =>
      TIMEOUT_ERROR.create({
        message: `Node server did not stop within ${gracefulShutdownTimeoutMs}ms`,
        cause,
      });

    const timeoutId = setTimeout(() => {
      if (typeof server.closeAllConnections !== "function") {
        settle(shutdownTimeoutError());
        return;
      }
      try {
        server.closeAllConnections();
      } catch (error) {
        settle(shutdownTimeoutError(error));
        return;
      }
      if (!settled) {
        forceSettleId = setTimeout(
          () => settle(shutdownTimeoutError()),
          FORCED_SHUTDOWN_SETTLE_MS,
        );
      }
    }, gracefulShutdownTimeoutMs);

    try {
      server.close((error) => {
        if (error && getSystemErrorCode(error) !== "ERR_SERVER_NOT_RUNNING") settle(error);
        else settle();
      });
      server.closeIdleConnections?.();
    } catch (error) {
      if (getSystemErrorCode(error) === "ERR_SERVER_NOT_RUNNING") settle();
      else settle(error);
    }
  });
}

function closeWebSocketServer(
  webSockets: NodeWebSocketUpgradeController,
  gracefulShutdownTimeoutMs = DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const shutdownTimeoutMs = Math.min(
    MAX_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    gracefulShutdownTimeoutMs + FORCED_SHUTDOWN_SETTLE_MS,
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve();
    };
    const timeoutId = setTimeout(() => {
      settle(
        TIMEOUT_ERROR.create({
          message: `Node WebSocket server did not stop within ${shutdownTimeoutMs}ms`,
        }),
      );
    }, shutdownTimeoutMs);

    try {
      webSockets.close().then(
        () => settle(),
        (error) => settle(error),
      );
    } catch (error) {
      settle(error);
    }
  });
}

export class NodeServer implements Server {
  private stopPromise: Promise<void> | null = null;
  private removeAbortListener: () => void = () => {};
  private readonly onServerError = (): void => {
    logger.error("HTTP server failed");
    void this.stop().catch(() => logger.error("Failed to stop the HTTP server"));
  };

  constructor(
    private readonly server: NodeHttpServer,
    private readonly webSockets: NodeWebSocketUpgradeController,
    private readonly hostname: string,
    private readonly port: number,
    signal?: AbortSignal,
    private readonly gracefulShutdownTimeoutMs = DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  ) {
    server.on("error", this.onServerError);
    if (signal) {
      const onAbort = (): void => {
        void this.stop().catch(() => logger.error("Failed to stop an aborted server"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    }
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.removeAbortListener();
      this.server.off("error", this.onServerError);
      const pending = Promise.all([
        closeHttpServer(this.server, this.gracefulShutdownTimeoutMs),
        closeWebSocketServer(this.webSockets, this.gracefulShutdownTimeoutMs),
      ]).then(() => undefined);
      const retryable = pending.catch((error) => {
        if (this.stopPromise === retryable) {
          this.stopPromise = null;
          this.server.on("error", this.onServerError);
        }
        throw error;
      });
      this.stopPromise = retryable;
    }
    return this.stopPromise;
  }

  get addr(): { hostname: string; port: number } {
    return { hostname: this.hostname, port: this.port };
  }
}

function createStartupError(error: unknown): VeryfrontError {
  if (getSystemErrorCode(error) === "EADDRINUSE") {
    return PORT_IN_USE.create({ message: "The server port is already in use", cause: error });
  }
  return SERVER_START_ERROR.create({ message: "Unable to start the Node server", cause: error });
}

async function handleHttpRequest(
  nativeRequest: NodeIncomingMessage,
  nativeResponse: import("../../../compat/http/node-types.ts").NodeServerResponse,
  handler: RuntimeRequestHandler,
  hostname: string,
  port: number,
): Promise<void> {
  try {
    const request = convertNodeRequestToWebRequest(
      nativeRequest,
      createRequestUrl(nativeRequest, hostname, port),
    );
    const response = await handler(request);
    if (isWebSocketUpgradeResponse(response)) {
      throw new Error("WebSocket upgrade signal received on an HTTP request");
    }
    await writeNodeResponse(nativeRequest, nativeResponse, response);
  } catch {
    if (!nativeResponse.headersSent && !nativeResponse.writableEnded) {
      nativeResponse.statusCode = 500;
      nativeResponse.statusMessage = "Internal Server Error";
      nativeResponse.end("Internal Server Error");
    } else if (!nativeResponse.destroyed) {
      nativeResponse.destroy();
    }
  }
}

export async function createNodeServer(
  handler: RuntimeRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  const {
    port = DEFAULT_PORT,
    hostname = "localhost",
    onListen,
    signal,
    gracefulShutdownTimeoutMs: configuredShutdownTimeout,
  } = options;
  const gracefulShutdownTimeoutMs = validateGracefulShutdownTimeout(configuredShutdownTimeout);
  signal?.throwIfAborted();

  const [{ createServer }, webSockets] = await Promise.all([
    import("node:http"),
    createNodeWebSocketUpgradeController(handler, hostname, port),
  ]);
  if (signal?.aborted) {
    await webSockets.close();
    signal.throwIfAborted();
  }

  const nativeServer = createServer((request, response) => {
    void handleHttpRequest(
      request as unknown as NodeIncomingMessage,
      response as unknown as import("../../../compat/http/node-types.ts").NodeServerResponse,
      handler,
      hostname,
      port,
    );
  }) as unknown as NodeHttpServer;
  nativeServer.on("upgrade", (...args: unknown[]) => {
    const [request, socket, head] = args as [NodeIncomingMessage, NodeUpgradeSocket, Uint8Array];
    void webSockets.handle(request, socket, head);
  });

  return await new Promise<Server>((resolve, reject) => {
    let settled = false;
    const cleanupStartupListeners = (): void => {
      nativeServer.off("error", onStartupError);
      signal?.removeEventListener("abort", onStartupAbort);
    };
    const closeStartupResources = async (): Promise<void> => {
      await Promise.allSettled([
        closeHttpServer(nativeServer, gracefulShutdownTimeoutMs),
        closeWebSocketServer(webSockets, gracefulShutdownTimeoutMs),
      ]);
    };
    const settleError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanupStartupListeners();
      void closeStartupResources().then(() => reject(createStartupError(error)));
    };
    const onStartupError = (...args: unknown[]): void => settleError(args[0]);
    const onStartupAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanupStartupListeners();
      const reason = signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
      void closeStartupResources().then(() => reject(reason));
    };
    nativeServer.once("error", onStartupError);
    signal?.addEventListener("abort", onStartupAbort, { once: true });

    try {
      nativeServer.listen(port, hostname, () => {
        if (settled) return;
        settled = true;
        cleanupStartupListeners();
        const address = nativeServer.address();
        if (!address || typeof address === "string" || address.port <= 0) {
          const error = SERVER_START_ERROR.create({
            message: "Node did not report a valid server address",
          });
          void closeStartupResources().then(() => reject(error));
          return;
        }

        const server = new NodeServer(
          nativeServer,
          webSockets,
          hostname,
          address.port,
          signal,
          gracefulShutdownTimeoutMs,
        );
        try {
          onListen?.(server.addr);
          resolve(server);
        } catch (error) {
          void server.stop()
            .catch(() => logger.error("Failed to stop the server after onListen failed"))
            .then(() => reject(error));
        }
      });
    } catch (error) {
      settleError(error);
    }
  });
}
