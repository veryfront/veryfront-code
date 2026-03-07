import { serverLogger } from "#veryfront/utils";
import { getOpenSockets } from "./hmr-client-manager.ts";

const logger = serverLogger.component("hmr-handler");

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
  const sockets = getOpenSockets();
  if (sockets.length === 0) return;

  const pingMessage = JSON.stringify({ type: "ping", timestamp: Date.now() });
  let sentCount = 0;

  for (const socket of sockets) {
    try {
      socket.send(pingMessage);
      sentCount++;
    } catch (_) {
      /* expected: client will be cleaned up when socket closes */
    }
  }

  logger.debug("Sent ping to clients", {
    sentCount,
    totalClients: sockets.length,
  });
}
