import { serverLogger } from "#veryfront/utils";
import type { WebSocketConnection } from "#veryfront/platform/adapters/base.ts";

const logger = serverLogger.component("hmr-handler");

export const HMR_MAX_CLIENTS = 256;
export const HMR_MAX_CLIENTS_PER_SCOPE = 32;
export const HMR_MAX_SCOPE_VALUE_BYTES = 1024;

const HMR_MAX_CLIENT_ID_BYTES = 128;
const HMR_CLOSE_POLICY_VIOLATION = 1008;
const HMR_CLOSE_GOING_AWAY = 1001;
const HMR_CLOSE_TRY_AGAIN_LATER = 1013;
const textEncoder = new TextEncoder();

/** Bounded client metadata used for routing and lifecycle management. */
export interface HMRClientInfo {
  readonly id: string;
  readonly socket: WebSocketConnection;
  readonly connectedAt: number;
  readonly projectSlug?: string;
  readonly projectId?: string;
  readonly projectDir?: string;
  readonly environment?: "preview" | "production";
  readonly branch?: string | null;
  readonly userAgent?: string;
  lastActivity: number;
}

/** Project identity used to route HMR traffic without crossing project boundaries. */
export interface HMRClientScope {
  projectSlug?: string;
  projectId?: string;
  projectDir?: string;
  environment?: "preview" | "production";
  branch?: string | null;
}

interface ManagedHMRClientInfo extends HMRClientInfo {
  readonly admissionScopeKey: string;
}

/**
 * Single source of truth for all HMR WebSocket clients.
 * Previous architecture had separate clientsMap + clientSockets that drifted
 * out of sync when errors occurred without close events.
 */
const clientsMap = new Map<string, ManagedHMRClientInfo>();

function pruneClosedClients(): void {
  for (const [clientId, client] of clientsMap) {
    if (
      client.socket.readyState === WebSocket.CLOSING ||
      client.socket.readyState === WebSocket.CLOSED
    ) {
      clientsMap.delete(clientId);
    }
  }
}

function hasValidByteLength(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum &&
    textEncoder.encode(value).byteLength <= maximum;
}

function isValidScopeValue(value: string | undefined | null): boolean {
  return value === undefined || value === null ||
    hasValidByteLength(value, HMR_MAX_SCOPE_VALUE_BYTES);
}

function isValidScope(scope: HMRClientScope): boolean {
  return isValidScopeValue(scope.projectSlug) &&
    isValidScopeValue(scope.projectId) &&
    isValidScopeValue(scope.projectDir) &&
    isValidScopeValue(scope.branch) &&
    (scope.environment === undefined ||
      scope.environment === "preview" ||
      scope.environment === "production");
}

function getAdmissionScopeKey(scope: HMRClientScope): string | null {
  if (!isValidScope(scope)) return null;
  return JSON.stringify([
    scope.projectId ?? null,
    scope.projectSlug ?? null,
    scope.projectDir ?? null,
    scope.environment ?? null,
    scope.branch ?? null,
  ]);
}

function rejectClient(
  socket: WebSocketConnection,
  code: number,
  reason: string,
): false {
  try {
    socket.close(code, reason);
  } catch (_) {
    /* expected: socket may already be closed */
  }
  return false;
}

function normalizeClient(info: HMRClientInfo): ManagedHMRClientInfo | null {
  if (
    !hasValidByteLength(info.id, HMR_MAX_CLIENT_ID_BYTES) ||
    (info.socket?.readyState !== WebSocket.CONNECTING &&
      info.socket?.readyState !== WebSocket.OPEN) ||
    typeof info.socket.send !== "function" ||
    typeof info.socket.close !== "function" ||
    typeof info.socket.addEventListener !== "function" ||
    typeof info.socket.removeEventListener !== "function" ||
    !Number.isFinite(info.connectedAt) ||
    info.connectedAt < 0 ||
    !Number.isFinite(info.lastActivity) ||
    info.lastActivity < 0
  ) {
    return null;
  }

  const scope: HMRClientScope = {
    projectSlug: info.projectSlug,
    projectId: info.projectId,
    projectDir: info.projectDir,
    environment: info.environment,
    branch: info.branch,
  };
  const admissionScopeKey = getAdmissionScopeKey(scope);
  if (admissionScopeKey === null) return null;

  // User-Agent is intentionally not retained. It is unnecessary for routing and
  // turns a bounded connection registry into a source of user-controlled data.
  return {
    id: info.id,
    socket: info.socket,
    connectedAt: info.connectedAt,
    lastActivity: info.lastActivity,
    projectSlug: info.projectSlug,
    projectId: info.projectId,
    projectDir: info.projectDir,
    environment: info.environment,
    branch: info.branch,
    admissionScopeKey,
  };
}

export function getClientCount(scope?: HMRClientScope): number {
  pruneClosedClients();
  if (!scope) return clientsMap.size;
  if (!isValidScope(scope)) return 0;
  let count = 0;
  for (const client of clientsMap.values()) {
    if (matchesScope(client, scope)) count++;
  }
  return count;
}

export function canAcceptClient(scope: HMRClientScope): boolean {
  pruneClosedClients();
  if (clientsMap.size >= HMR_MAX_CLIENTS) return false;
  const admissionScopeKey = getAdmissionScopeKey(scope);
  if (admissionScopeKey === null) return false;

  let scopeCount = 0;
  for (const client of clientsMap.values()) {
    if (client.admissionScopeKey !== admissionScopeKey) continue;
    scopeCount++;
    if (scopeCount >= HMR_MAX_CLIENTS_PER_SCOPE) return false;
  }
  return true;
}

export function addClient(info: HMRClientInfo): boolean {
  const normalized = normalizeClient(info);
  if (!normalized || clientsMap.has(info.id)) {
    return rejectClient(info.socket, HMR_CLOSE_POLICY_VIOLATION, "Invalid client metadata");
  }

  if (!canAcceptClient(normalized)) {
    return rejectClient(info.socket, HMR_CLOSE_TRY_AGAIN_LATER, "Server busy");
  }

  clientsMap.set(normalized.id, normalized);
  return true;
}

export function removeClient(clientId: string): void {
  const client = clientsMap.get(clientId);
  if (!client) return;

  clientsMap.delete(clientId);

  logger.debug("Client disconnected", {
    connectionDurationMs: Math.max(0, Date.now() - client.connectedAt),
    totalClients: clientsMap.size,
  });
}

export function getClient(clientId: string): HMRClientInfo | undefined {
  return clientsMap.get(clientId);
}

function matchesScope(client: HMRClientInfo, scope?: HMRClientScope): boolean {
  if (!scope) return true;
  if (scope.projectId !== undefined && client.projectId !== scope.projectId) return false;
  if (scope.projectSlug !== undefined && client.projectSlug !== scope.projectSlug) return false;
  if (scope.projectDir !== undefined && client.projectDir !== scope.projectDir) return false;
  if (scope.environment !== undefined && client.environment !== scope.environment) return false;
  if (scope.branch !== undefined && client.branch !== scope.branch) return false;
  return true;
}

/**
 * Get all open WebSocket connections, optionally filtered by project identity.
 * This replaces the old exported `clientSockets` Set that drifted out of sync.
 */
export function getOpenSockets(scope?: HMRClientScope): WebSocketConnection[] {
  return getOpenClients(scope).map((client) => client.socket);
}

export function getOpenClients(
  scope?: HMRClientScope,
): Array<Pick<HMRClientInfo, "id" | "socket">> {
  pruneClosedClients();
  const clients: Array<Pick<HMRClientInfo, "id" | "socket">> = [];
  if (scope && !isValidScope(scope)) return clients;
  for (const client of clientsMap.values()) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    if (!matchesScope(client, scope)) continue;
    clients.push({ id: client.id, socket: client.socket });
  }
  return clients;
}

export function disconnectClient(
  clientId: string,
  code: number,
  reason: string,
): boolean {
  const client = clientsMap.get(clientId);
  if (!client) return false;
  clientsMap.delete(clientId);
  try {
    client.socket.close(code, reason);
  } catch (_) {
    /* expected: socket may already be closed */
  }
  return true;
}

/** Close clients that have not sent a message within the configured idle window. */
export function closeIdleClients(now: number, maxIdleMs: number): number {
  if (!Number.isFinite(now)) throw new RangeError("now must be finite");
  if (!Number.isFinite(maxIdleMs) || maxIdleMs <= 0) {
    throw new RangeError("maxIdleMs must be positive");
  }

  let closed = 0;
  for (const [clientId, client] of clientsMap) {
    if (now - client.lastActivity <= maxIdleMs) continue;
    clientsMap.delete(clientId);
    try {
      client.socket.close(HMR_CLOSE_GOING_AWAY, "Idle timeout");
    } catch (_) {
      /* expected: socket may already be closed */
    }
    closed++;
  }
  return closed;
}

export function clearAll(): void {
  const clients = Array.from(clientsMap.values());
  clientsMap.clear();
  for (const client of clients) {
    try {
      client.socket.close(HMR_CLOSE_GOING_AWAY, "Server shutting down");
    } catch (_) {
      /* expected: socket may already be closed */
    }
  }
}
