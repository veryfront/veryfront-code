import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("hmr-handler");

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
interface HMRClientDetail {
  id: string;
  connectedAt: number;
  projectSlug?: string;
  lastActivity: number;
  connectionDurationMs: number;
}

/**
 * Single source of truth for all HMR WebSocket clients.
 * Previous architecture had separate clientsMap + clientSockets that drifted
 * out of sync when errors occurred without close events.
 */
const clientsMap = new Map<string, HMRClientInfo>();

export function getClientCount(): number {
  return clientsMap.size;
}

export function addClient(info: HMRClientInfo): void {
  clientsMap.set(info.id, info);
}

export function removeClient(clientId: string): void {
  const client = clientsMap.get(clientId);
  if (!client) return;

  logger.debug("Client disconnected", {
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

/**
 * Get all open WebSocket connections, optionally filtered by projectSlug.
 * This replaces the old exported `clientSockets` Set that drifted out of sync.
 */
export function getOpenSockets(projectSlug?: string): WebSocket[] {
  const sockets: WebSocket[] = [];
  for (const client of clientsMap.values()) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    if (projectSlug && client.projectSlug !== projectSlug) continue;
    sockets.push(client.socket);
  }
  return sockets;
}

export function clearAll(): void {
  for (const client of clientsMap.values()) {
    try {
      client.socket.close();
    } catch (_) {
      /* expected: socket may already be closed */
    }
  }
  clientsMap.clear();
}
