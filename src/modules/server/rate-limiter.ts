import { HMR_RATE_LIMIT_WINDOW_MS } from "#veryfront/utils";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import type { WebSocketConnection } from "#veryfront/platform/adapters/base.ts";

export interface RateLimiterOptions {
  windowMs?: number;
  now?: () => number;
}

interface RateLimitRecord {
  count: number;
  windowStart: number;
  resetTime: number;
}

export class RateLimiter {
  private readonly messageCounts = new WeakMap<WebSocketConnection, RateLimitRecord>();
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(maxMessages: number, options: RateLimiterOptions = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Rate limiter options must be an object");
    }
    if (!Number.isSafeInteger(maxMessages) || maxMessages <= 0) {
      throw new RangeError("maxMessages must be a positive safe integer");
    }
    const windowMs = options.windowMs ?? HMR_RATE_LIMIT_WINDOW_MS;
    if (
      !Number.isSafeInteger(windowMs) ||
      windowMs <= 0 ||
      windowMs > MAX_TIMER_DELAY_MS
    ) {
      throw new RangeError(
        `windowMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
      );
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new TypeError("now must be a function");
    }

    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
    this.now = options.now ?? (() => performance.now());
  }

  check(socket: WebSocketConnection): boolean {
    const now = this.now();
    if (!Number.isFinite(now)) return false;
    const record = this.messageCounts.get(socket);

    if (record && now >= record.windowStart && now < record.resetTime) {
      if (record.count >= this.maxMessages) return false;
      record.count++;
      return true;
    }

    const resetTime = now + this.windowMs;
    if (!Number.isFinite(resetTime)) return false;
    this.messageCounts.set(socket, { count: 1, windowStart: now, resetTime });
    return true;
  }

  cleanup(socket: WebSocketConnection): void {
    this.messageCounts.delete(socket);
  }
}
