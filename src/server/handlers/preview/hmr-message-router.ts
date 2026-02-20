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

// Server-side debounce to batch rapid-fire file saves into a single broadcast
const BROADCAST_DEBOUNCE_MS = 200;
let pendingPaths = new Set<string>();
let pendingFullReload = false;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function flushBroadcast(): void {
  broadcastTimer = null;
  const timestamp = Date.now();

  metrics.broadcastsSent++;
  metrics.lastBroadcastTime = timestamp;

  if (pendingFullReload) {
    const message = JSON.stringify({ type: "reload", timestamp });
    logger.debug("Broadcasting full reload (debounced)");
    broadcastMessage(message);
    metrics.messagesForwarded++;
  } else {
    // Deduplicate: send one message per unique path
    for (const path of pendingPaths) {
      const message = JSON.stringify({ type: "update", path, timestamp });
      logger.debug("Broadcasting update message (debounced)", { path });
      broadcastMessage(message);
      metrics.messagesForwarded++;
    }
  }

  logger.debug("Debounced broadcast complete", {
    changedPaths: pendingPaths.size,
    fullReload: pendingFullReload,
    totalClients: getClientCount(),
  });

  pendingPaths = new Set<string>();
  pendingFullReload = false;
}

export function broadcastUpdate(changedPaths?: string[]): void {
  logger.debug("broadcastUpdate called", {
    changedPaths,
    totalClients: getClientCount(),
  });

  const needsFullReload = !changedPaths?.length ||
    changedPaths.some((path) => requiresFullReload(path));

  if (needsFullReload) {
    pendingFullReload = true;
  } else {
    for (const path of changedPaths) {
      pendingPaths.add(path);
    }
  }

  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
  }
  broadcastTimer = setTimeout(flushBroadcast, BROADCAST_DEBOUNCE_MS);
}

export function broadcastMessage(message: string): void {
  let sentCount = 0;
  let skippedCount = 0;

  logger.debug("broadcastMessage starting", {
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

  logger.debug("broadcastMessage complete", {
    sentCount,
    skippedCount,
  });
}

export function resetMetrics(): void {
  metrics.broadcastsSent = 0;
  metrics.messagesForwarded = 0;
  metrics.lastBroadcastTime = 0;
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  pendingPaths = new Set<string>();
  pendingFullReload = false;
}
