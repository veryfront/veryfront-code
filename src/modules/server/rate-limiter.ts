import { HMR_RATE_LIMIT_WINDOW_MS } from "@veryfront/utils";

export class RateLimiter {
  private messageCounts = new Map<WebSocket, { count: number; resetTime: number }>();
  private readonly windowMs = HMR_RATE_LIMIT_WINDOW_MS;
  private readonly maxMessages: number;

  constructor(maxMessages: number) {
    this.maxMessages = maxMessages;
  }

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

  cleanup(socket: WebSocket): void {
    this.messageCounts.delete(socket);
  }
}
