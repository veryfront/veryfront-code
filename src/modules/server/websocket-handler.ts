import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT,
  serverLogger as logger,
} from "#veryfront/utils";
import type { WebSocketContext } from "#veryfront/server/dev-server/hmr-types.ts";

const WEBSOCKET_INTERNAL_ERROR = 1011;

function getMessageSize(data: unknown): number {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

export function setupWebSocketHandlers(
  socket: WebSocket,
  context: WebSocketContext,
): void {
  if (!Number.isSafeInteger(context.maxMessageSize) || context.maxMessageSize <= 0) {
    throw new RangeError("maxMessageSize must be a positive safe integer");
  }
  context.clients.add(socket);

  let cleanedUp = false;
  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    context.clients.delete(socket);
    context.rateLimiter.cleanup(socket);
  }

  function closeAndCleanup(code: number, reason: string): void {
    cleanup();
    try {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(code, reason);
      }
    } catch (error) {
      logger.debug("Failed to close HMR connection", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  function sendConnectedMessage(): void {
    if (cleanedUp || socket.readyState !== WebSocket.OPEN) return;
    logger.debug("HMR client connected", { totalClients: context.clients.size });

    try {
      socket.send(
        JSON.stringify({
          type: "connected",
          reactRefresh: context.reactRefresh,
        }),
      );
    } catch (error) {
      logger.error("Failed to send connection message", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      closeAndCleanup(WEBSOCKET_INTERNAL_ERROR, "Connection setup failed");
    }
  }

  if (socket.readyState === WebSocket.OPEN) {
    sendConnectedMessage();
  } else {
    socket.onopen = sendConnectedMessage;
  }

  socket.onmessage = (event) => {
    if (cleanedUp) return;
    try {
      const messageSize = getMessageSize(event.data);

      if (messageSize > context.maxMessageSize) {
        logger.warn("HMR message too large, closing connection", {
          size: messageSize,
          max: context.maxMessageSize,
        });
        closeAndCleanup(HMR_CLOSE_MESSAGE_TOO_LARGE, "Message too large");
        return;
      }

      if (!context.rateLimiter.check(socket)) {
        logger.warn("HMR rate limit exceeded, closing connection");
        closeAndCleanup(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
        return;
      }

      if (typeof event.data !== "string") {
        logger.debug("Received binary HMR message from client (unexpected)");
        return;
      }

      let message: { type?: string };
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
        const type = (parsed as { type?: unknown }).type;
        if (type !== undefined && typeof type !== "string") return;
        message = { type };
      } catch {
        logger.debug("Ignoring malformed HMR message");
        return;
      }

      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      logger.debug("Ignored unsupported HMR message");
    } catch (error) {
      logger.error("Error processing HMR message", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      closeAndCleanup(WEBSOCKET_INTERNAL_ERROR, "Message processing failed");
    }
  };

  socket.onclose = () => {
    cleanup();
    logger.debug("HMR client disconnected", { totalClients: context.clients.size });
  };

  socket.onerror = () => {
    logger.error("HMR WebSocket error");
    closeAndCleanup(WEBSOCKET_INTERNAL_ERROR, "WebSocket error");
  };
}

export function closeAllConnections(
  clients: Set<WebSocket>,
  rateLimiter: { cleanup(socket: WebSocket): void },
): Promise<void> {
  if (clients.size === 0) {
    return Promise.resolve();
  }

  const connections = [...clients];
  for (const client of connections) {
    try {
      if (
        client.readyState === WebSocket.OPEN ||
        client.readyState === WebSocket.CONNECTING
      ) {
        client.close(HMR_CLOSE_NORMAL, "Server shutting down");
      }
    } catch (error) {
      logger.debug("Error closing WebSocket client", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    rateLimiter.cleanup(client);
  }
  clients.clear();
  return Promise.resolve();
}
