import type { RateLimitState, RateLimitStore } from "./types.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";

const MAX_TIMESTAMPS_PER_KEY = 1_000;
const WINDOW_MS = 60_000;

function assertPositiveSafeInteger(name: string, value: number): void {
  if (Number.isSafeInteger(value) && value > 0) return;
  throw new TypeError(`${name} must be a positive safe integer`);
}

export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitState>();
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupDueAt = 0;
  private destroyed = false;

  constructor(private cleanupIntervalMs = WINDOW_MS) {
    assertPositiveSafeInteger("cleanupIntervalMs", cleanupIntervalMs);
  }

  increment(key: string, windowMs: number = WINDOW_MS): Promise<number> {
    this.assertActive();
    assertPositiveSafeInteger("windowMs", windowMs);
    const now = Date.now();
    const state = this.store.get(key);

    if (!state || now >= state.resetTime) {
      this.store.set(key, {
        count: 1,
        resetTime: now + windowMs,
        requestTimestamps: [now],
      });
      this.scheduleCleanup();
      return Promise.resolve(1);
    }

    state.count++;
    state.requestTimestamps?.push(now);

    const timestamps = state.requestTimestamps;
    if (timestamps?.length && timestamps.length > MAX_TIMESTAMPS_PER_KEY) {
      const windowStart = state.resetTime - windowMs;
      const filtered = timestamps.filter((t) => t >= windowStart);
      state.requestTimestamps = filtered.length > MAX_TIMESTAMPS_PER_KEY
        ? filtered.slice(-MAX_TIMESTAMPS_PER_KEY)
        : filtered;
    }

    this.scheduleCleanup();
    return Promise.resolve(state.count);
  }

  get(key: string): Promise<number> {
    this.assertActive();
    const state = this.store.get(key);
    if (!state || Date.now() >= state.resetTime) return Promise.resolve(0);
    return Promise.resolve(state.count);
  }

  reset(key: string): Promise<void> {
    this.assertActive();
    this.store.delete(key);
    this.scheduleCleanup();
    return Promise.resolve();
  }

  resetAll(): Promise<void> {
    this.assertActive();
    this.store.clear();
    this.cancelCleanup();
    return Promise.resolve();
  }

  getState(key: string): RateLimitState | undefined {
    this.assertActive();
    return this.store.get(key);
  }

  setState(key: string, state: RateLimitState): void {
    this.assertActive();
    if (!Number.isFinite(state.count) || state.count < 0) {
      throw new TypeError("Rate limit state count must be a non-negative finite number");
    }
    if (!Number.isSafeInteger(state.resetTime) || state.resetTime <= 0) {
      throw new TypeError("Rate limit state resetTime must be a positive safe integer");
    }
    this.store.set(key, state);
    this.scheduleCleanup();
  }

  private cleanup(): void {
    this.cleanupTimer = null;
    this.cleanupDueAt = 0;
    if (this.destroyed) return;
    const now = Date.now();
    for (const [key, state] of this.store) {
      if (now >= state.resetTime) this.store.delete(key);
    }
    this.scheduleCleanup();
  }

  private scheduleCleanup(): void {
    if (this.destroyed || typeof setTimeout === "undefined") return;
    if (this.store.size === 0) {
      this.cancelCleanup();
      return;
    }

    const now = Date.now();
    let earliestReset = Number.POSITIVE_INFINITY;
    for (const state of this.store.values()) {
      earliestReset = Math.min(earliestReset, state.resetTime);
    }
    const dueAt = Math.min(now + this.cleanupIntervalMs, earliestReset);
    if (this.cleanupTimer !== null && this.cleanupDueAt <= dueAt) return;

    this.cancelCleanup();
    this.cleanupDueAt = dueAt;
    this.cleanupTimer = setTimeout(() => this.cleanup(), Math.max(0, dueAt - now));
    unrefTimer(this.cleanupTimer);
  }

  private cancelCleanup(): void {
    if (this.cleanupTimer !== null) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    this.cleanupDueAt = 0;
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("MemoryRateLimitStore has been destroyed");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelCleanup();
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
