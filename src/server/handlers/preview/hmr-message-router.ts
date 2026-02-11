import { serverLogger } from "#veryfront/utils";
import { clientSockets, getClientCount } from "./hmr-client-manager.ts";

const logger = serverLogger.component("hmr-handler");

export interface HMRMetrics {
  broadcastsSent: number;
  messagesForwarded: number;
  lastBroadcastTime: number;
}

const metrics: HMRMetrics = {
  broadcastsSent: 0,
  messagesForwarded: 0,
  lastBroadcastTime: 0,
};

export function getMetrics(): { clients: number } & HMRMetrics {
  return { clients: getClientCount(), ...metrics };
}

export function requiresFullReload(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "mdx" || ext === "md" || path.includes("veryfront.config");
}

export function broadcastUpdate(changedPaths?: string[]): void {
  const timestamp = Date.now();
  metrics.broadcastsSent++;
  metrics.lastBroadcastTime = timestamp;

  logger.info("broadcastUpdate called", {
    changedPaths,
    totalClients: getClientCount(),
    clientsSetSize: clientSockets.size,
  });

  const needsFullReload = !changedPaths?.length ||
    changedPaths.some((path) => requiresFullReload(path));

  if (needsFullReload) {
    const message = JSON.stringify({ type: "reload", timestamp });
    logger.debug("Broadcasting full reload", {
      reason: changedPaths?.length ? "server-rendered content" : "no paths",
    });
    broadcastMessage(message);
    metrics.messagesForwarded++;
    return;
  }

  for (const path of changedPaths) {
    const message = JSON.stringify({ type: "update", path, timestamp });
    logger.debug("Broadcasting update message", { path });
    broadcastMessage(message);
    metrics.messagesForwarded++;
  }

  logger.debug("Broadcast update complete", {
    changedPaths: changedPaths.length,
    totalClients: getClientCount(),
  });
}

export function broadcastMessage(message: string): void {
  let sentCount = 0;
  let skippedCount = 0;

  logger.info("broadcastMessage starting", {
    message: message.substring(0, 100),
    totalClients: clientSockets.size,
  });

  for (const client of clientSockets) {
    if (client.readyState !== WebSocket.OPEN) {
      skippedCount++;
      logger.debug("Skipping client - not open", {
        readyState: client.readyState,
      });
      continue;
    }

    try {
      client.send(message);
      sentCount++;
    } catch (error) {
      logger.warn("Failed to send to client", { error });
    }
  }

  logger.info("broadcastMessage complete", {
    sentCount,
    skippedCount,
    totalClients: clientSockets.size,
  });
}

export function resetMetrics(): void {
  metrics.broadcastsSent = 0;
  metrics.messagesForwarded = 0;
  metrics.lastBroadcastTime = 0;
}
