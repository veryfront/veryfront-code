import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT,
  serverLogger as logger,
} from "#veryfront/utils";
import type { WebSocketContext } from "#veryfront/server/dev-server/hmr-types.ts";
import { getWebSocketMessageAdmission } from "#veryfront/utils/websocket-message-size.ts";

export function setupWebSocketHandlers(
  socket: WebSocket,
  context: WebSocketContext,
): void {
  context.clients.add(socket);
  let cleanupComplete = false;

  function sendConnectedMessage(): void {
    if (cleanupComplete) return;
    logger.debug("HMR client connected", { totalClients: context.clients.size });

    try {
      socket.send(
        JSON.stringify({
          type: "connected",
          reactRefresh: context.reactRefresh,
        }),
      );
    } catch (error) {
      logger.error("Failed to send connection message", error);
    }
  }

  if (socket.readyState === WebSocket.OPEN) {
    sendConnectedMessage();
  } else {
    socket.onopen = sendConnectedMessage;
  }

  function cleanup(): void {
    if (cleanupComplete) return;
    cleanupComplete = true;
    socket.onopen = null;
    socket.onmessage = null;
    context.clients.delete(socket);
    try {
      context.rateLimiter.cleanup(socket);
    } catch (error) {
      logger.debug("Error cleaning up HMR rate-limit state", error);
    }
  }

  /**
   * Release server-side state before asking the peer to close. A client that
   * stalls the close handshake must not be able to keep its registration and
   * rate-limit entry alive by never letting `onclose` fire.
   */
  function closeAndCleanup(code: number, reason: string): void {
    cleanup();
    try {
      socket.close(code, reason);
    } catch (error) {
      logger.debug("Error closing HMR WebSocket client", error);
    }
  }

  socket.onmessage = (event) => {
    if (cleanupComplete) return;
    try {
      const admission = getWebSocketMessageAdmission(
        event.data,
        context.maxMessageSize,
      );

      if (!admission.accepted) {
        logger.warn("HMR message too large, closing connection", {
          sizeAtLeast: admission.sizeBytes,
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
        message = JSON.parse(event.data);
      } catch (parseError) {
        logger.warn("Failed to parse HMR message", { error: parseError });
        return;
      }

      if (message.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      logger.debug("Received HMR message from client", {
        type: message.type,
        data: event.data.slice(0, 100),
      });
    } catch (error) {
      logger.error("Error processing HMR message", error);
    }
  };

  socket.onclose = () => {
    cleanup();
    logger.debug("HMR client disconnected", { totalClients: context.clients.size });
  };

  socket.onerror = (error) => {
    logger.error("HMR WebSocket error:", error);
    cleanup();
  };
}

export async function closeAllConnections(
  clients: Set<WebSocket>,
  rateLimiter: { cleanup(socket: WebSocket): void },
): Promise<void> {
  if (clients.size === 0) {
    return;
  }

  for (const client of clients) {
    try {
      if (
        client.readyState === WebSocket.OPEN ||
        client.readyState === WebSocket.CONNECTING
      ) {
        client.close(HMR_CLOSE_NORMAL, "Server shutting down");
      }
    } catch (error) {
      logger.debug("Error closing WebSocket client", error);
    }
  }

  // WebSocket close handshake requires multiple round trips through the event loop.
  // Alternate between microtasks and macrotasks to ensure all I/O completes.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50)); // no cleanup needed: one-shot
  }

  for (const client of clients) {
    rateLimiter.cleanup(client);
  }
  clients.clear();
}
