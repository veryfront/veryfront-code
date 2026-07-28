import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_NORMAL,
  HMR_CLOSE_RATE_LIMIT,
  MAX_TIMER_DELAY_MS,
  serverLogger as logger,
} from "#veryfront/utils";
import type { WebSocketContext } from "#veryfront/server/dev-server/hmr-types.ts";
import { getWebSocketMessageSizeBytes } from "#veryfront/utils/websocket-message-size.ts";

const DEFAULT_CLOSE_TIMEOUT_MS = 500;

export interface CloseAllConnectionsOptions {
  timeoutMs?: number;
}

export function setupWebSocketHandlers(
  socket: WebSocket,
  context: WebSocketContext,
): void {
  if (!Number.isSafeInteger(context.maxMessageSize) || context.maxMessageSize <= 0) {
    throw new RangeError("WebSocket maxMessageSize must be a positive safe integer");
  }
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

  function cleanup(): void {
    context.clients.delete(socket);
    try {
      context.rateLimiter.cleanup(socket);
    } catch (error) {
      logger.debug("Error cleaning up HMR rate-limit state", error);
    }
  }

  function closeAndCleanup(code: number, reason: string): void {
    cleanup();
    try {
      socket.close(code, reason);
    } catch (error) {
      logger.debug("Error closing HMR WebSocket client", error);
    }
  }

  socket.onmessage = (event) => {
    try {
      const messageSize = getWebSocketMessageSizeBytes(event.data);

      if (messageSize > context.maxMessageSize) {
        logger.warn("HMR message too large, closing connection", {
          size: messageSize,
          max: context.maxMessageSize,
        });
        closeAndCleanup(
          HMR_CLOSE_MESSAGE_TOO_LARGE,
          "Message too large",
        );
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch (parseError) {
        logger.warn("Failed to parse HMR message", { error: parseError });
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        logger.warn("Ignored malformed HMR message envelope");
        return;
      }
      const type = typeof (parsed as { type?: unknown }).type === "string"
        ? (parsed as { type: string }).type
        : undefined;

      if (type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }

      logger.debug("Received HMR message from client", {
        type,
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
  options: CloseAllConnectionsOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `WebSocket close timeoutMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  if (clients.size === 0) {
    return;
  }

  const snapshot = [...clients];
  const closeWaiters = snapshot
    .filter((client) => client.readyState !== WebSocket.CLOSED)
    .map((client) => {
      let settle!: () => void;
      const promise = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const onClose = () => settle();
      client.addEventListener("close", onClose, { once: true });
      return {
        promise,
        dispose: () => client.removeEventListener("close", onClose),
      };
    });

  for (const client of snapshot) {
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

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (closeWaiters.length > 0) {
      const allClosed = Promise.all(closeWaiters.map(({ promise }) => promise));
      const closeTimeout = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([allClosed, closeTimeout]);
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    for (const waiter of closeWaiters) waiter.dispose();
  }

  for (const client of snapshot) {
    try {
      rateLimiter.cleanup(client);
    } catch (error) {
      logger.debug("Error cleaning up WebSocket rate-limit state", error);
    }
    clients.delete(client);
  }
}
