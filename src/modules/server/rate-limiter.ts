import { HMR_RATE_LIMIT_WINDOW_MS } from "#veryfront/utils";
import type { WebSocketConnection } from "#veryfront/platform/adapters/base.ts";

export class RateLimiter {
  private readonly messageCounts = new WeakMap<
    WebSocketConnection,
    { count: number; resetTime: number }
  >();
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly maxMessages: number,
    options: { windowMs?: number; now?: () => number } = {},
  ) {
    const windowMs = options.windowMs ?? HMR_RATE_LIMIT_WINDOW_MS;
    if (!Number.isSafeInteger(maxMessages) || maxMessages <= 0) {
      throw new RangeError("maxMessages must be a positive safe integer");
    }
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new RangeError("windowMs must be a positive safe integer");
    }

    this.windowMs = windowMs;
    this.now = options.now ?? Date.now;
  }

  check(socket: WebSocketConnection): boolean {
    const now = this.now();
    const record = this.messageCounts.get(socket);

    if (record && now < record.resetTime) {
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
