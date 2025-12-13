import { serverLogger as logger } from "@veryfront/utils";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT,
} from "@veryfront/utils";
import type { WebSocketContext } from "../../server/dev-server/hmr-types.ts";

/** Number of iterations to wait for WebSocket close during graceful shutdown */
const WEBSOCKET_CLOSE_ITERATIONS = 10;
/** Delay between close iterations in milliseconds */
const WEBSOCKET_CLOSE_DELAY_MS = 50;

export function setupWebSocketHandlers(
  socket: WebSocket,
  context: WebSocketContext,
): void {
  context.clients.add(socket);

  const sendConnectedMessage = () => {
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
  };

  if (socket.readyState === WebSocket.OPEN) {
    sendConnectedMessage();
  } else {
    socket.onopen = () => {
      sendConnectedMessage();
    };
  }

  socket.onmessage = (event) => {
    try {
      const messageSize = typeof event.data === "string"
        ? event.data.length
        : event.data.byteLength || 0;

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

      if (typeof event.data === "string") {
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
      } else {
        logger.debug("Received binary HMR message from client (unexpected)");
      }
    } catch (error) {
      logger.error("Error processing HMR message", error);
    }
  };

  socket.onclose = () => {
    context.clients.delete(socket);
    context.rateLimiter.cleanup(socket);
    logger.debug("HMR client disconnected", { totalClients: context.clients.size });
  };

  socket.onerror = (error) => {
    logger.error("HMR WebSocket error:", error);
    context.clients.delete(socket);
    context.rateLimiter.cleanup(socket);
  };
}

export async function closeAllConnections(
  clients: Set<WebSocket>,
  rateLimiter: { cleanup(socket: WebSocket): void },
): Promise<void> {
  const clientCount = clients.size;

  if (clientCount === 0) {
    return;
  }

  for (const client of clients) {
    try {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(HMR_CLOSE_NORMAL, "Server shutting down");
      }
    } catch (error) {
      logger.debug("Error closing WebSocket client", error);
    }
  }

  // Wait for WebSocket connections to close gracefully
  for (let i = 0; i < WEBSOCKET_CLOSE_ITERATIONS; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, WEBSOCKET_CLOSE_DELAY_MS));
  }

  for (const client of clients) {
    rateLimiter.cleanup(client);
  }
  clients.clear();
}
