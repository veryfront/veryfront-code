import { serverLogger } from "#veryfront/utils";
import { getClientCount, getOpenSockets } from "./hmr-client-manager.ts";

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

/**
 * Broadcast update to all connected HMR clients, optionally filtered by projectSlug.
 * No server-side debounce here — ReloadNotifier already debounces (300ms).
 */
export function broadcastUpdate(changedPaths?: string[], projectSlug?: string): void {
  logger.debug("broadcastUpdate called", {
    changedPaths,
    totalClients: getClientCount(),
    projectSlug,
  });

  const timestamp = Date.now();
  metrics.broadcastsSent++;
  metrics.lastBroadcastTime = timestamp;

  const needsFullReload = !changedPaths?.length ||
    changedPaths.some((path) => requiresFullReload(path));

  if (needsFullReload) {
    const message = JSON.stringify({ type: "reload", timestamp });
    broadcastMessage(message, projectSlug);
    metrics.messagesForwarded++;
  } else {
    for (const path of changedPaths) {
      const message = JSON.stringify({ type: "update", path, timestamp });
      broadcastMessage(message, projectSlug);
      metrics.messagesForwarded++;
    }
  }
}

export function broadcastMessage(message: string, projectSlug?: string): void {
  const sockets = getOpenSockets(projectSlug);
  let sentCount = 0;

  for (const socket of sockets) {
    try {
      socket.send(message);
      sentCount++;
    } catch (error) {
      logger.warn("Failed to send to client", { error });
    }
  }

  logger.debug("broadcastMessage complete", {
    sentCount,
    totalClients: getClientCount(),
    projectSlug,
  });
}

export function resetMetrics(): void {
  metrics.broadcastsSent = 0;
  metrics.messagesForwarded = 0;
  metrics.lastBroadcastTime = 0;
}
