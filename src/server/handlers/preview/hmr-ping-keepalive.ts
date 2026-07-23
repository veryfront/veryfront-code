import { serverLogger } from "#veryfront/utils";
import { closeIdleClients, disconnectClient, getOpenClients } from "./hmr-client-manager.ts";

const logger = serverLogger.component("hmr-handler");

const PING_INTERVAL_MS = 45_000;
const CLIENT_IDLE_TIMEOUT_MS = 120_000;
const HMR_CLOSE_CONNECTION_FAILED = 1011;

let pingInterval: ReturnType<typeof setInterval> | null = null;

export function startPingInterval(afterSweep?: () => void): void {
  if (pingInterval) return;
  pingInterval = setInterval(() => {
    sendPingToAllClients();
    afterSweep?.();
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
  const idleClientsClosed = closeIdleClients(Date.now(), CLIENT_IDLE_TIMEOUT_MS);
  const clients = getOpenClients();
  if (clients.length === 0) {
    if (idleClientsClosed > 0) logger.debug("Closed idle HMR clients", { idleClientsClosed });
    return;
  }

  const pingMessage = JSON.stringify({ type: "ping", timestamp: Date.now() });
  let sentCount = 0;

  for (const client of clients) {
    try {
      client.socket.send(pingMessage);
      sentCount++;
    } catch (_) {
      disconnectClient(client.id, HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
    }
  }

  logger.debug("Sent ping to clients", {
    sentCount,
    totalClients: clients.length,
    idleClientsClosed,
  });
}
