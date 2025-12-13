
import type { RateLimitState, RateLimitStore } from "./types.ts";

export class MemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, RateLimitState> = new Map();
  private cleanupInterval: number | null = null;

  constructor(
    private cleanupIntervalMs = 60000, // 1 minute
  ) {
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(
        () => this.cleanup(),
        cleanupIntervalMs,
      ) as unknown as number;
    }
  }

  increment(key: string): Promise<number> {
    const state = this.store.get(key);
    const now = Date.now();

    if (!state || now > state.resetTime) {
      this.store.set(key, {
        count: 1,
        resetTime: now + 60000, // Default 1 minute window
        requestTimestamps: [now],
      });
      return Promise.resolve(1);
    }

    state.count++;
    if (state.requestTimestamps) {
      state.requestTimestamps.push(now);
    }

    return Promise.resolve(state.count);
  }

  get(key: string): Promise<number> {
    const state = this.store.get(key);
    if (!state || Date.now() > state.resetTime) {
      return Promise.resolve(0);
    }
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
    for (const [key, state] of this.store.entries()) {
      if (now > state.resetTime) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  size(): number {
    return this.store.size;
  }
}
