import type { RateLimitState, RateLimitStore } from "./types.ts";

const MAX_TIMESTAMPS_PER_KEY = 1000;
const WINDOW_MS = 60000;

export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitState>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private cleanupIntervalMs = WINDOW_MS) {
    if (typeof setInterval === "undefined") return;

    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  increment(key: string): Promise<number> {
    const now = Date.now();
    const state = this.store.get(key);

    if (!state || now > state.resetTime) {
      this.store.set(key, {
        count: 1,
        resetTime: now + WINDOW_MS,
        requestTimestamps: [now],
      });
      return Promise.resolve(1);
    }

    state.count++;
    state.requestTimestamps?.push(now);

    const timestamps = state.requestTimestamps;
    if (timestamps && timestamps.length > MAX_TIMESTAMPS_PER_KEY) {
      const windowStart = state.resetTime - WINDOW_MS;
      const filtered = timestamps.filter((t) => t >= windowStart);
      state.requestTimestamps = filtered.length > MAX_TIMESTAMPS_PER_KEY
        ? filtered.slice(-MAX_TIMESTAMPS_PER_KEY)
        : filtered;
    }

    return Promise.resolve(state.count);
  }

  get(key: string): Promise<number> {
    const state = this.store.get(key);
    if (!state || Date.now() > state.resetTime) return Promise.resolve(0);
    return Promise.resolve(state.count);
  }

  reset(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  resetAll(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }

  getState(key: string): RateLimitState | undefined {
    return this.store.get(key);
  }

  setState(key: string, state: RateLimitState): void {
    this.store.set(key, state);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, state] of this.store) {
      if (now > state.resetTime) this.store.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupInterval === null) return;
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }

  size(): number {
    return this.store.size;
  }
}
