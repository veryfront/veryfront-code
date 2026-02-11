import { serverLogger as logger } from "#veryfront/utils";

const log = logger.component("hmr-handler");

/** Client metadata for observability */
export interface HMRClientInfo {
  id: string;
  socket: WebSocket;
  connectedAt: number;
  projectSlug?: string;
  userAgent?: string;
  lastActivity: number;
}

/** Detailed client info for the status endpoint (no socket reference) */
export interface HMRClientDetail {
  id: string;
  connectedAt: number;
  projectSlug?: string;
  lastActivity: number;
  connectionDurationMs: number;
}

const clientsMap = new Map<string, HMRClientInfo>();

/**
 * WebSocket set kept in sync for backward compat with setupWebSocketHandlers.
 * setupWebSocketHandlers manages add/remove on open/close internally,
 * so we expose the set directly.
 */
export const clientSockets = new Set<WebSocket>();

export function getClientCount(): number {
  return clientsMap.size;
}

export function addClient(info: HMRClientInfo): void {
  clientsMap.set(info.id, info);
}

export function removeClient(clientId: string): void {
  const client = clientsMap.get(clientId);
  if (!client) return;

  log.debug("Client disconnected", {
    clientId,
    projectSlug: client.projectSlug,
    connectionDurationMs: Date.now() - client.connectedAt,
    totalClients: clientsMap.size - 1,
  });

  clientsMap.delete(clientId);
}

export function getClient(clientId: string): HMRClientInfo | undefined {
  return clientsMap.get(clientId);
}

export function getClientDetails(): HMRClientDetail[] {
  const now = Date.now();
  return Array.from(clientsMap.values()).map((client) => ({
    id: client.id,
    connectedAt: client.connectedAt,
    projectSlug: client.projectSlug,
    lastActivity: client.lastActivity,
    connectionDurationMs: now - client.connectedAt,
  }));
}

export function clearAll(): void {
  for (const client of clientsMap.values()) {
    try {
      client.socket.close();
    } catch {
      // Ignore close errors
    }
  }
  clientsMap.clear();
  clientSockets.clear();
}
