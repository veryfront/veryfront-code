import { HMR_RATE_LIMIT_WINDOW_MS } from "#veryfront/utils";
import type { WebSocketConnection } from "#veryfront/platform/adapters/base.ts";

export class RateLimiter {
  private readonly messageCounts = new Map<
    WebSocketConnection,
    { count: number; resetTime: number }
  >();
  private readonly windowMs = HMR_RATE_LIMIT_WINDOW_MS;

  constructor(private readonly maxMessages: number) {}

  check(socket: WebSocketConnection): boolean {
    const now = Date.now();
    const record = this.messageCounts.get(socket);

    if (record && now <= record.resetTime) {
      if (record.count >= this.maxMessages) return false;
      record.count++;
      return true;
    }

    this.messageCounts.set(socket, { count: 1, resetTime: now + this.windowMs });
    return true;
  }

  cleanup(socket: WebSocketConnection): void {
    this.messageCounts.delete(socket);
  }
}
