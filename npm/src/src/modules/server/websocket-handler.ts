import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT,
} from "../../utils/index.js";
import type { WebSocketContext } from "../../server/dev-server/hmr-types.js";

export function setupWebSocketHandlers(
  socket: WebSocket,
  context: WebSocketContext,
): void {
  context.clients.add(socket);

  function sendConnectedMessage(): void {
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

  socket.onmessage = (event) => {
    try {
      const messageSize = typeof event.data === "string"
        ? event.data.length
        : event.data.byteLength ?? 0;

      if (messageSize > context.maxMessageSize) {
        logger.warn("HMR message too large, closing connection", {
          size: messageSize,
          max: context.maxMessageSize,
        });
        socket.close(HMR_CLOSE_MESSAGE_TOO_LARGE, "Message too large");
        return;
      }

      if (!context.rateLimiter.check(socket)) {
        logger.warn("HMR rate limit exceeded, closing connection");
        socket.close(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
        return;
      }

      if (typeof event.data !== "string") {
        logger.debug("Received binary HMR message from client (unexpected)");
        return;
      }

      try {
        const message = JSON.parse(event.data);

        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
          return;
        }

        logger.debug("Received HMR message from client", {
          type: message.type,
          data: event.data.slice(0, 100),
        });
      } catch (parseError) {
        logger.warn("Failed to parse HMR message", { error: parseError });
      }
    } catch (error) {
      logger.error("Error processing HMR message", error);
    }
  };

  function cleanup(): void {
    context.clients.delete(socket);
    context.rateLimiter.cleanup(socket);
  }

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
    await new Promise((resolve) => dntShim.setTimeout(resolve, 50));
  }

  for (const client of clients) {
    rateLimiter.cleanup(client);
  }
  clients.clear();
}
