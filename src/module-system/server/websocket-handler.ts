import { serverLogger as logger } from "@veryfront/utils";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT,
} from "@veryfront/utils";
import type { WebSocketContext } from "../../server/dev-server/hmr-types.ts";

export function setupWebSocketHandlers(
  socket: WebSocket,
  context: WebSocketContext,
): void {
  // Add client to set immediately
  context.clients.add(socket);

  // Function to send the connected message
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

  // Server-side WebSockets may be OPEN immediately or CONNECTING
  // Check the state and send message accordingly
  if (socket.readyState === WebSocket.OPEN) {
    sendConnectedMessage();
  } else {
    // Socket is still CONNECTING, wait for onopen
    socket.onopen = () => {
      sendConnectedMessage();
    };
  }

  // Handle incoming messages from client
  socket.onmessage = (event) => {
    try {
      // Validate message size
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

      // Rate limiting
      if (!context.rateLimiter.check(socket)) {
        logger.warn("HMR rate limit exceeded, closing connection");
        socket.close(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
        return;
      }

      // Process message
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);

          // Handle ping-pong for connection keep-alive
          if (message.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
            return;
          }

          // Log other message types for debugging
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

  // Handle connection closed
  socket.onclose = () => {
    context.clients.delete(socket);
    context.rateLimiter.cleanup(socket);
    logger.debug("HMR client disconnected", { totalClients: context.clients.size });
  };

  // Handle WebSocket errors
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

  // Initiate close on all clients
  for (const client of clients) {
    try {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(HMR_CLOSE_NORMAL, "Server shutting down");
      }
    } catch (error) {
      logger.debug("Error closing WebSocket client", error);
    }
  }

  // WebSocket close handshake requires multiple round trips through the event loop:
  // 1. Server calls close() - queues close frame to be sent
  // 2. Event loop sends close frame to client
  // 3. Client receives close frame, fires its onclose
  // 4. Client sends close frame back to server
  // 5. Server receives close frame, fires its onclose
  // Each step needs an event loop cycle to process network I/O
  // Alternate between microtasks and macrotasks to ensure all I/O completes
  // Increased from 10ms to 50ms per iteration for better cleanup in batch test mode
  for (let i = 0; i < 10; i++) {
    await Promise.resolve(); // Flush microtasks
    await new Promise((resolve) => setTimeout(resolve, 50)); // Allow I/O to process
  }

  // Final cleanup for any remaining clients
  for (const client of clients) {
    rateLimiter.cleanup(client);
  }
  clients.clear();
}
