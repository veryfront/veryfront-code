import { serverLogger as logger } from "#veryfront/utils";
import { clientSockets } from "./hmr-client-manager.ts";

const PING_INTERVAL_MS = 45000;

let pingInterval: ReturnType<typeof setInterval> | null = null;

export function startPingInterval(): void {
  if (pingInterval) return;
  pingInterval = setInterval(() => {
    sendPingToAllClients();
  }, PING_INTERVAL_MS);
}

export function stopPingInterval(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

export function getPingIntervalMs(): number {
  return PING_INTERVAL_MS;
}

function sendPingToAllClients(): void {
  if (clientSockets.size === 0) return;

  const pingMessage = JSON.stringify({ type: "ping", timestamp: Date.now() });
  let sentCount = 0;

  for (const client of clientSockets) {
    if (client.readyState !== WebSocket.OPEN) continue;

    try {
      client.send(pingMessage);
      sentCount++;
    } catch {
      // Client will be cleaned up on close event
    }
  }

  logger.debug("[HMRHandler] Sent ping to clients", {
    sentCount,
    totalClients: clientSockets.size,
  });
}
