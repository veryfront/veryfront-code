import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";
import {
  HTTP_TOO_MANY_REQUESTS,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from "#veryfront/utils/constants/http.ts";
import { CLEANUP_INTERVAL_MULTIPLIER } from "#veryfront/utils/constants/cache.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";

const DEFAULT_RATE_LIMIT_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;

export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, RateLimitEntry>();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(windowMs: number) {
    const shouldSkipInterval =
      (globalThis as Record<string, unknown>).__vfDisableLruInterval === true;

    if (shouldSkipInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.counts.entries()) {
        if (entry.resetAt < now) this.counts.delete(key);
      }
    }, windowMs * CLEANUP_INTERVAL_MULTIPLIER);

    unrefTimer(this.cleanupInterval);
  }

  increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    let entry = this.counts.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.counts.set(key, entry);
    }

    entry.count++;
    return Promise.resolve(entry);
  }

  reset(key: string): Promise<void> {
    this.counts.delete(key);
    return Promise.resolve();
  }

  destroy(): void {
    if (!this.cleanupInterval) return;
    clearInterval(this.cleanupInterval);
  }
}

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
  keyGenerator?: (req: Request) => string;
}

export function rateLimit(
  optionsOrMaxRequests?: number | RateLimitOptions,
  windowMsArg?: number,
): Middleware {
  const options: RateLimitOptions = typeof optionsOrMaxRequests === "number"
    ? { maxRequests: optionsOrMaxRequests, windowMs: windowMsArg }
    : optionsOrMaxRequests ?? {};

  const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const store = options.store ?? new MemoryRateLimitStore(windowMs);
  const keyGenerator = options.keyGenerator ??
    ((req: Request) => req.headers.get("x-forwarded-for") || "anonymous");

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const key = keyGenerator(req);
    const entry = await store.increment(key, windowMs);

    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.ceil(
        (entry.resetAt - Date.now()) / MS_PER_SECOND,
      );

      return new Response("Too Many Requests", {
        status: HTTP_TOO_MANY_REQUESTS,
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }

    return next();
  };
}
