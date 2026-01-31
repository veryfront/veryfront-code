import { HMR_RATE_LIMIT_WINDOW_MS } from "#veryfront/utils";

export class RateLimiter {
  private readonly messageCounts = new Map<WebSocket, { count: number; resetTime: number }>();
  private readonly windowMs = HMR_RATE_LIMIT_WINDOW_MS;

  constructor(private readonly maxMessages: number) {}

  check(socket: WebSocket): boolean {
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

  cleanup(socket: WebSocket): void {
    this.messageCounts.delete(socket);
  }
}
