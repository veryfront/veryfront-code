export interface WebSocketContext {
  clients: Set<WebSocket>;
  rateLimiter: RateLimiter;
  maxMessageSize: number;
  reactRefresh?: boolean;
}

export interface RateLimiter {
  check(socket: WebSocket): boolean;
  cleanup(socket: WebSocket): void;
}
