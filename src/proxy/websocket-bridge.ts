import type { WebSocketUpgradeOptions } from "#veryfront/platform/compat/http/index.ts";
import type { ProxyContext, ProxyRequestOptions } from "./handler.ts";
import {
  closeBridgePeer,
  type CreateProxyWebSocketBridgeOptions,
  detachProxyWebSocketHandlers,
  type PreparedProxyWebSocketMessage,
  prepareProxyWebSocketMessage,
  PROXY_WS_CLOSE_GOING_AWAY,
  PROXY_WS_CLOSE_INTERNAL_ERROR,
  PROXY_WS_CLOSE_MESSAGE_TOO_BIG,
  PROXY_WS_CLOSE_TRY_AGAIN_LATER,
  PROXY_WS_CLOSE_UNSUPPORTED_DATA,
  PROXY_WS_CLOSED,
  PROXY_WS_CLOSING,
  PROXY_WS_CONNECTING,
  PROXY_WS_OPEN,
  type ProxyBridgeSocket,
  type ProxyWebSocketBridge,
  proxyWebSocketCloseEventDetails,
  proxyWebSocketEventErrorMessage,
  requireProxyBridgeSocket,
  resolveProxyWebSocketBridgeOptions,
  sendPreparedProxyWebSocketMessage,
  type SendProxyWebSocketMessageResult,
} from "./websocket-bridge-protocol.ts";

export {
  closeBridgePeer,
  type CreateProxyWebSocketBridgeOptions,
  PROXY_WEBSOCKET_CONNECTION_TIMEOUT_MS,
  type ProxyBridgeSocket,
  type ProxyWebSocketBridge,
} from "./websocket-bridge-protocol.ts";
export { ProxyWebSocketBridgeRegistry } from "./websocket-bridge-registry.ts";
export { createProxyWebSocketTargetUrl } from "./websocket-target.ts";

type ProxyError = NonNullable<ProxyContext["error"]>;

export type WebSocketAuthorization =
  | { readonly allowed: true; readonly context: ProxyContext }
  | { readonly allowed: false; readonly error: ProxyError };

export async function authorizeWebSocketRequest(
  req: Request,
  url: URL,
  resolveContext: (req: Request, options: ProxyRequestOptions) => Promise<ProxyContext>,
): Promise<WebSocketAuthorization> {
  const context = await resolveContext(req, { url });
  return context.error
    ? Object.freeze({ allowed: false, error: context.error })
    : Object.freeze({ allowed: true, context });
}

export function isProxyWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export type ServerWebSocketErrorLogLevel = "warn" | "error";

const TRANSIENT_SERVER_ERROR_PATTERNS = [
  /unexpected eof/i,
  /connection reset/i,
  /connection closed/i,
  /socket closed/i,
];

const TRANSIENT_CLIENT_ERROR_PATTERNS = [
  /unexpected eof/i,
  /no response from ping frame/i,
  /connection reset/i,
  /connection closed/i,
  /socket closed/i,
];

export function getServerWebSocketErrorLogLevel(
  message: string,
): ServerWebSocketErrorLogLevel {
  return TRANSIENT_SERVER_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

export function getClientWebSocketErrorLogLevel(
  message: string,
): ServerWebSocketErrorLogLevel {
  return TRANSIENT_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

/**
 * Create a bounded, symmetric bridge between an accepted client socket and an
 * upstream renderer socket.
 */
export function createProxyWebSocketBridge(
  rawOptions: CreateProxyWebSocketBridgeOptions,
): ProxyWebSocketBridge {
  const options = resolveProxyWebSocketBridgeOptions(rawOptions);
  const {
    clientSocket,
    connectTimeoutMs,
    createServerSocket,
    logger,
    maxBufferedBytes,
    maxMessageBytes,
    maxQueuedBytes,
    maxQueuedMessages,
    targetUrl,
  } = options;
  const parsedTarget = new URL(targetUrl);
  const targetLogContext = Object.freeze({
    targetOrigin: parsedTarget.origin,
    targetPathname: parsedTarget.pathname,
  });

  let serverSocket: ProxyBridgeSocket | null = null;
  let connectTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let terminated = false;
  let serverOpen = false;
  let queuedBytes = 0;
  const queue: PreparedProxyWebSocketMessage[] = [];
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const log = (
    level: "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void => {
    try {
      if (level === "error" && error !== undefined) {
        logger?.error(message, context, error);
      } else {
        logger?.[level](message, context);
      }
    } catch {
      // Diagnostic callbacks cannot own the bridge lifecycle.
    }
  };

  const clearConnectTimeout = (): void => {
    if (connectTimeoutId === undefined) return;
    clearTimeout(connectTimeoutId);
    connectTimeoutId = undefined;
  };

  const armConnectTimeout = (peer: "client" | "server"): void => {
    clearConnectTimeout();
    connectTimeoutId = setTimeout(() => {
      connectTimeoutId = undefined;
      if (terminated || (peer === "server" && serverOpen)) return;
      const peerName = peer === "client" ? "Client" : "Server";
      log("error", `[WebSocket] ${peerName} connection timeout`, {
        ...targetLogContext,
        timeoutMs: connectTimeoutMs,
      });
      terminate(
        PROXY_WS_CLOSE_TRY_AGAIN_LATER,
        `${peerName} connection timeout`,
      );
    }, connectTimeoutMs);
  };

  const terminate = (code: number, reason: string): void => {
    if (terminated) return;
    terminated = true;
    serverOpen = false;
    clearConnectTimeout();
    queue.length = 0;
    queuedBytes = 0;
    detachProxyWebSocketHandlers(clientSocket);
    detachProxyWebSocketHandlers(serverSocket);
    closeBridgePeer(clientSocket, code, reason);
    closeBridgePeer(serverSocket, code, reason);
    resolveClosed();
  };

  const rejectMessage = (
    direction: "client-to-server" | "server-to-client",
    failure: "too-large" | "unreadable" | "unsupported",
  ): void => {
    const code = failure === "unsupported"
      ? PROXY_WS_CLOSE_UNSUPPORTED_DATA
      : failure === "too-large"
      ? PROXY_WS_CLOSE_MESSAGE_TOO_BIG
      : PROXY_WS_CLOSE_INTERNAL_ERROR;
    const reason = failure === "unsupported"
      ? "Unsupported WebSocket message"
      : failure === "too-large"
      ? "WebSocket message is too large"
      : "Unreadable WebSocket message";
    log("warn", "[WebSocket] Rejected message at bridge boundary", {
      direction,
      failure,
      maxMessageBytes,
    });
    terminate(code, reason);
  };

  const handleSendFailure = (
    direction: "client-to-server" | "server-to-client",
    result: SendProxyWebSocketMessageResult & { ok: false },
  ): void => {
    const backpressure = result.failure === "backpressure";
    log(
      result.failure === "send-failed" ? "error" : "warn",
      "[WebSocket] Failed to forward bridge message",
      {
        direction,
        failure: result.failure,
        maxBufferedBytes,
      },
      result.error,
    );
    terminate(
      backpressure ? PROXY_WS_CLOSE_TRY_AGAIN_LATER : PROXY_WS_CLOSE_INTERNAL_ERROR,
      backpressure ? "WebSocket bridge is overloaded" : "WebSocket forwarding failed",
    );
  };

  const forward = (
    direction: "client-to-server" | "server-to-client",
    destination: ProxyBridgeSocket,
    prepared: PreparedProxyWebSocketMessage,
  ): boolean => {
    const result = sendPreparedProxyWebSocketMessage(
      destination,
      prepared,
      maxBufferedBytes,
    );
    if (result.ok) return true;
    handleSendFailure(direction, result);
    return false;
  };

  const prepareEventMessage = (
    event: MessageEvent<unknown>,
    direction: "client-to-server" | "server-to-client",
  ): PreparedProxyWebSocketMessage | null => {
    let data: unknown;
    try {
      data = event.data;
    } catch {
      rejectMessage(direction, "unreadable");
      return null;
    }
    const prepared = prepareProxyWebSocketMessage(data, maxMessageBytes);
    if (!prepared.ok) {
      rejectMessage(direction, prepared.failure);
      return null;
    }
    return prepared.message;
  };

  const handleServerOpen = (): void => {
    if (terminated || serverOpen || !serverSocket) return;
    let readyState: number;
    try {
      readyState = serverSocket.readyState;
    } catch {
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid upstream WebSocket");
      return;
    }
    if (readyState !== PROXY_WS_OPEN) return;

    clearConnectTimeout();
    serverOpen = true;
    while (queue.length > 0 && !terminated) {
      const message = queue.shift()!;
      queuedBytes -= message.byteLength;
      if (!forward("client-to-server", serverSocket, message)) return;
    }
    queuedBytes = 0;
    if (!terminated) {
      log("info", "[WebSocket] Server connected, bridge established");
    }
  };

  const startServerConnection = (): void => {
    if (terminated || serverSocket) return;
    let clientReadyState: number;
    try {
      clientReadyState = clientSocket.readyState;
    } catch {
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid client WebSocket");
      return;
    }
    if (clientReadyState !== PROXY_WS_OPEN) {
      if (
        clientReadyState === PROXY_WS_CLOSING ||
        clientReadyState === PROXY_WS_CLOSED
      ) {
        terminate(
          PROXY_WS_CLOSE_GOING_AWAY,
          "Client connection closed during startup",
        );
      } else if (clientReadyState !== PROXY_WS_CONNECTING) {
        terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid client WebSocket");
      }
      return;
    }
    clearConnectTimeout();
    log("info", "[WebSocket] Client connected, bridging to server", {
      ...targetLogContext,
    });

    try {
      serverSocket = requireProxyBridgeSocket(
        createServerSocket(targetUrl),
        "server",
      );
      if (serverSocket === clientSocket) {
        throw new TypeError(
          "Proxy WebSocket server socket must be distinct from the client socket",
        );
      }
    } catch (error) {
      log(
        "error",
        "[WebSocket] Failed to create server WebSocket",
        targetLogContext,
        error,
      );
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Failed to connect to server");
      return;
    }

    try {
      serverSocket.onopen = handleServerOpen;
      serverSocket.onmessage = (event) => {
        if (terminated) return;
        const prepared = prepareEventMessage(event, "server-to-client");
        if (prepared) forward("server-to-client", clientSocket, prepared);
      };
      serverSocket.onerror = (event) => {
        if (terminated) return;
        const error = proxyWebSocketEventErrorMessage(event);
        const level = getServerWebSocketErrorLogLevel(error);
        log(level, "[WebSocket] Server connection error", {
          error,
          ...targetLogContext,
        });
        terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Server connection error");
      };
      serverSocket.onclose = (event) => {
        if (terminated) return;
        const details = proxyWebSocketCloseEventDetails(event);
        log("info", "[WebSocket] Server connection closed", details);
        terminate(details.code, details.reason);
      };
    } catch (error) {
      log(
        "error",
        "[WebSocket] Failed to attach server WebSocket handlers",
        targetLogContext,
        error,
      );
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid upstream WebSocket");
      return;
    }

    if (terminated) {
      detachProxyWebSocketHandlers(clientSocket);
      detachProxyWebSocketHandlers(serverSocket);
      return;
    }

    try {
      const readyState = serverSocket.readyState;
      if (readyState === PROXY_WS_OPEN) queueMicrotask(handleServerOpen);
      else if (readyState === PROXY_WS_CONNECTING) armConnectTimeout("server");
      else if (
        readyState === PROXY_WS_CLOSING ||
        readyState === PROXY_WS_CLOSED
      ) {
        terminate(
          PROXY_WS_CLOSE_INTERNAL_ERROR,
          "Server connection closed during startup",
        );
      } else {
        terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid upstream WebSocket");
      }
    } catch {
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid upstream WebSocket");
    }
  };

  try {
    clientSocket.onopen = startServerConnection;
    clientSocket.onmessage = (event) => {
      if (terminated) return;
      const prepared = prepareEventMessage(event, "client-to-server");
      if (!prepared) return;

      if (serverSocket && serverOpen) {
        forward("client-to-server", serverSocket, prepared);
        return;
      }
      if (
        queue.length >= maxQueuedMessages ||
        queuedBytes > maxQueuedBytes - prepared.byteLength
      ) {
        log("warn", "[WebSocket] Pre-open message queue limit exceeded", {
          maxQueuedBytes,
          maxQueuedMessages,
          queuedBytes,
          queuedMessages: queue.length,
        });
        terminate(
          PROXY_WS_CLOSE_MESSAGE_TOO_BIG,
          "WebSocket message queue limit exceeded",
        );
        return;
      }
      queue.push(prepared);
      queuedBytes += prepared.byteLength;
    };
    clientSocket.onerror = (event) => {
      if (terminated) return;
      const error = proxyWebSocketEventErrorMessage(event);
      const level = getClientWebSocketErrorLogLevel(error);
      log(level, "[WebSocket] Client connection error", { error });
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Client connection error");
    };
    clientSocket.onclose = (event) => {
      if (terminated) return;
      const details = proxyWebSocketCloseEventDetails(event);
      log("info", "[WebSocket] Client connection closed", details);
      terminate(details.code, details.reason);
    };
  } catch (error) {
    log(
      "error",
      "[WebSocket] Failed to attach client WebSocket handlers",
      undefined,
      error,
    );
    terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid client WebSocket");
  }

  if (terminated) {
    detachProxyWebSocketHandlers(clientSocket);
    detachProxyWebSocketHandlers(serverSocket);
  } else {
    try {
      const readyState = clientSocket.readyState;
      if (readyState === PROXY_WS_OPEN) {
        queueMicrotask(startServerConnection);
      } else if (readyState === PROXY_WS_CONNECTING) {
        armConnectTimeout("client");
      } else if (
        readyState === PROXY_WS_CLOSING ||
        readyState === PROXY_WS_CLOSED
      ) {
        terminate(
          PROXY_WS_CLOSE_GOING_AWAY,
          "Client connection is already closed",
        );
      } else {
        terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid client WebSocket");
      }
    } catch {
      terminate(PROXY_WS_CLOSE_INTERNAL_ERROR, "Invalid client WebSocket");
    }
  }

  return Object.freeze({
    closed,
    close(
      code = PROXY_WS_CLOSE_GOING_AWAY,
      reason = "Proxy WebSocket bridge closed",
    ): void {
      terminate(code, reason);
    },
  });
}

export function createProxyClientWebSocketUpgradeOptions(): WebSocketUpgradeOptions {
  // Proxied project sockets use app-level heartbeats; Deno's transport idle
  // timeout can close otherwise healthy bridges before the browser sends data.
  return { idleTimeout: 0 };
}
