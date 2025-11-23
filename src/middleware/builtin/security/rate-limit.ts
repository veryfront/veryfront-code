import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";
import {
  HTTP_TOO_MANY_REQUESTS,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from "@veryfront/utils/constants/http.ts";
import { CLEANUP_INTERVAL_MULTIPLIER } from "@veryfront/utils/constants/cache.ts";

const DEFAULT_RATE_LIMIT_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;

/**
 * In-memory implementation of RateLimitStore
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(windowMs: number) {
    const shouldSkipInterval =
      (globalThis as Record<string, unknown>).__vfDisableLruInterval === true;

    if (!shouldSkipInterval) {
      this.cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of this.counts.entries()) {
          if (entry.resetAt < now) {
            this.counts.delete(key);
          }
        }
      }, windowMs * CLEANUP_INTERVAL_MULTIPLIER);

      if (typeof Deno !== "undefined" && this.cleanupInterval) {
        // @ts-ignore - Deno-specific API
        Deno.unrefTimer(this.cleanupInterval);
      }
    }
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

  // Clean up resources (useful for testing)
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
  keyGenerator?: (req: Request) => string;
}

/**
 * Rate limiting middleware
 *
 * @example
 * ```ts
 * // Default: 100 requests per minute, in-memory
 * app.use(rateLimit());
 *
 * // Custom: 50 requests per hour, Redis store
 * app.use(rateLimit({
 *   maxRequests: 50,
 *   windowMs: 60 * 60 * 1000,
 *   store: new RedisRateLimitStore(...)
 * }));
 * ```
 */
export function rateLimit(
  optionsOrMaxRequests?: number | RateLimitOptions,
  windowMsArg?: number,
): Middleware {
  let options: RateLimitOptions;

  if (typeof optionsOrMaxRequests === "number") {
    options = {
      maxRequests: optionsOrMaxRequests,
      windowMs: windowMsArg,
    };
  } else {
    options = optionsOrMaxRequests || {};
  }

  const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const store = options.store ?? new MemoryRateLimitStore(windowMs);
  const keyGenerator = options.keyGenerator ??
    ((req) => req.headers.get("x-forwarded-for") || "anonymous");

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const key = keyGenerator(req);

    const entry = await store.increment(key, windowMs);

    if (entry.count > maxRequests) {
      const now = Date.now();
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / MS_PER_SECOND);
      return new Response("Too Many Requests", {
        status: HTTP_TOO_MANY_REQUESTS,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      });
    }

    return next();
  };
}
