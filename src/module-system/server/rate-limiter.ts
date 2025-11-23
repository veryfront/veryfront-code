/**
 * Rate Limiter for WebSocket Connections
 * Prevents message flooding and abuse
 */

import { HMR_RATE_LIMIT_WINDOW_MS } from "@veryfront/utils";

/**
 * Rate limiter for WebSocket connections
 * Tracks message counts per socket and enforces rate limits
 */
export class RateLimiter {
  private messageCounts = new Map<WebSocket, { count: number; resetTime: number }>();
  private readonly windowMs = HMR_RATE_LIMIT_WINDOW_MS;
  private readonly maxMessages: number;

  constructor(maxMessages: number) {
    this.maxMessages = maxMessages;
  }

  /**
   * Check if a socket can send a message
   * @returns true if message is allowed, false if rate limit exceeded
   */
  check(socket: WebSocket): boolean {
    const now = Date.now();
    const record = this.messageCounts.get(socket);

    if (!record || now > record.resetTime) {
      this.messageCounts.set(socket, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (record.count >= this.maxMessages) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Clean up rate limit tracking for a socket
   * Should be called when socket closes
   */
  cleanup(socket: WebSocket): void {
    this.messageCounts.delete(socket);
  }
}
