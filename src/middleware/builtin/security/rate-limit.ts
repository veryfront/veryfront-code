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
import { resolveRateLimitClientKey } from "#veryfront/security/rate-limit/client-key.ts";

const DEFAULT_RATE_LIMIT_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;

function createRateLimitEntry(windowMs: number): RateLimitEntry {
  return { count: 1, resetAt: Date.now() + windowMs };
}

function defaultKeyGenerator(req: Request, trustProxy: boolean): string {
  return resolveRateLimitClientKey(req, trustProxy, "anonymous");
}

/** Implement memory rate limit store. */
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
    const existing = this.counts.get(key);
    const now = Date.now();

    if (!existing || existing.resetAt < now) {
      const entry = createRateLimitEntry(windowMs);
      this.counts.set(key, entry);
      return Promise.resolve(entry);
    }

    existing.count++;
    return Promise.resolve(existing);
  }

  reset(key: string): Promise<void> {
    this.counts.delete(key);
    return Promise.resolve();
  }

  destroy(): void {
    if (!this.cleanupInterval) return;
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;
  }
}

/** Options accepted by rate limit. */
export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
  keyGenerator?: (req: Request) => string;
  /**
   * Trust proxy-set forwarding headers (X-Forwarded-For) for keying. Defaults to
   * false so forwarded headers are ignored and cannot be used to evade limits.
   * Enable only when a trusted proxy that appends the real client IP sits in
   * front of this middleware.
   */
  trustProxy?: boolean;
}

/** Options accepted by the authentication rate-limit preset. */
export interface AuthRateLimitOptions {
  /** Storage backend. Existing callers can also pass the store directly. */
  store?: RateLimitStore;
  /** Function to derive a stable client key from the request. */
  keyGenerator?: (req: Request) => string;
  /**
   * Trust X-Forwarded-For and X-Real-IP for client identification.
   * Enable this only behind a trusted reverse proxy.
   */
  trustProxy?: boolean;
}

function isRateLimitStore(
  value: RateLimitStore | AuthRateLimitOptions,
): value is RateLimitStore {
  return "increment" in value && typeof value.increment === "function";
}

/** Create rate-limit middleware. */
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
  const trustProxy = options.trustProxy ?? false;
  const keyGenerator = options.keyGenerator ??
    ((req: Request) => defaultKeyGenerator(req, trustProxy));

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const key = keyGenerator(req);
    const entry = await store.increment(key, windowMs);

    if (entry.count <= maxRequests) return next();

    const retryAfterSeconds = Math.ceil(
      (entry.resetAt - Date.now()) / MS_PER_SECOND,
    );

    return new Response("Too Many Requests", {
      status: HTTP_TOO_MANY_REQUESTS,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  };
}

/** Pre-configured rate limiter for authentication endpoints (5 req/15min). */
export function authRateLimit(
  storeOrOptions?: RateLimitStore | AuthRateLimitOptions,
): Middleware {
  const options = !storeOrOptions
    ? {}
    : isRateLimitStore(storeOrOptions)
    ? { store: storeOrOptions }
    : storeOrOptions;

  return rateLimit({
    maxRequests: 5,
    windowMs: 15 * MS_PER_MINUTE,
    ...options,
  });
}
