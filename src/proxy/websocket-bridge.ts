type BridgePeer = Pick<WebSocket, "close" | "readyState">;

export type ServerWebSocketErrorLogLevel = "warn" | "error";

const TRANSIENT_SERVER_ERROR_PATTERNS = [
  /unexpected eof/i,
  /connection reset/i,
  /connection closed/i,
  /socket closed/i,
];

export function getServerWebSocketErrorLogLevel(message: string): ServerWebSocketErrorLogLevel {
  return TRANSIENT_SERVER_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? "warn"
    : "error";
}

export function closeBridgePeer(peer: BridgePeer | null, code: number, reason: string): void {
  if (!peer) return;
  if (peer.readyState !== WebSocket.OPEN && peer.readyState !== WebSocket.CONNECTING) return;
  peer.close(code, reason);
}
