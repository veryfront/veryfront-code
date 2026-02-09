import { serverLogger as logger } from "#veryfront/utils";
import { clientSockets, getClientCount } from "./hmr-client-manager.ts";

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

  logger.info("[HMRHandler] broadcastUpdate called", {
    changedPaths,
    totalClients: getClientCount(),
    clientsSetSize: clientSockets.size,
  });

  const needsFullReload = !changedPaths?.length ||
    changedPaths.some((path) => requiresFullReload(path));

  if (needsFullReload) {
    const message = JSON.stringify({ type: "reload", timestamp });
    logger.debug("[HMRHandler] Broadcasting full reload", {
      reason: changedPaths?.length ? "server-rendered content" : "no paths",
    });
    broadcastMessage(message);
    metrics.messagesForwarded++;
    return;
  }

  for (const path of changedPaths) {
    const message = JSON.stringify({ type: "update", path, timestamp });
    logger.debug("[HMRHandler] Broadcasting update message", { path });
    broadcastMessage(message);
    metrics.messagesForwarded++;
  }

  logger.debug("[HMRHandler] Broadcast update complete", {
    changedPaths: changedPaths.length,
    totalClients: getClientCount(),
  });
}

export function broadcastMessage(message: string): void {
  let sentCount = 0;
  let skippedCount = 0;

  logger.info("[HMRHandler] broadcastMessage starting", {
    message: message.substring(0, 100),
    totalClients: clientSockets.size,
  });

  for (const client of clientSockets) {
    if (client.readyState !== WebSocket.OPEN) {
      skippedCount++;
      logger.debug("[HMRHandler] Skipping client - not open", {
        readyState: client.readyState,
      });
      continue;
    }

    try {
      client.send(message);
      sentCount++;
    } catch (error) {
      logger.warn("[HMRHandler] Failed to send to client", { error });
    }
  }

  logger.info("[HMRHandler] broadcastMessage complete", {
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
