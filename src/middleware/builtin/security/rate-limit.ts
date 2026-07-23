import type { MiddlewareHandler } from "../../core/types.ts";
import { getRequest } from "../types.ts";
import { calculateRateLimitResetAt, type RateLimitEntry, type RateLimitStore } from "./types.ts";
import {
  HTTP_TOO_MANY_REQUESTS,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from "#veryfront/utils/constants/http.ts";
import { CLEANUP_INTERVAL_MULTIPLIER } from "#veryfront/utils/constants/cache.ts";
import { resolveRateLimitClientKey } from "#veryfront/security/rate-limit/client-key.ts";

const DEFAULT_RATE_LIMIT_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;
const DEFAULT_MAX_CLIENT_KEYS = 10_000;
const MAX_RATE_LIMIT_KEY_LENGTH = 1_024;
const MAX_CLEANUP_INTERVAL_MS = 2_147_483_647;
const OVERFLOW_CLIENT_KEY = Symbol("rate-limit-overflow");

function assertPositiveSafeInteger(name: string, value: number): void {
  if (Number.isSafeInteger(value) && value > 0) return;
  throw new TypeError(`${name} must be a positive safe integer`);
}

function assertRateLimitKey(key: unknown): asserts key is string {
  if (typeof key === "string" && key.length <= MAX_RATE_LIMIT_KEY_LENGTH) return;
  throw new TypeError(
    `Rate limit keys must be strings no longer than ${MAX_RATE_LIMIT_KEY_LENGTH} characters`,
  );
}

function assertRateLimitStore(value: unknown): asserts value is RateLimitStore {
  if (
    (typeof value === "object" || typeof value === "function") && value !== null &&
    typeof (value as Partial<RateLimitStore>).increment === "function" &&
    typeof (value as Partial<RateLimitStore>).reset === "function"
  ) {
    return;
  }
  throw new TypeError("store must implement increment() and reset()");
}

function assertRateLimitEntry(value: unknown): asserts value is RateLimitEntry {
  if (
    typeof value === "object" && value !== null &&
    Number.isSafeInteger((value as RateLimitEntry).count) &&
    (value as RateLimitEntry).count > 0 &&
    Number.isSafeInteger((value as RateLimitEntry).resetAt) &&
    (value as RateLimitEntry).resetAt > 0
  ) {
    return;
  }
  throw new TypeError("Rate limit stores must return a positive count and reset timestamp");
}

function createRateLimitEntry(now: number, windowMs: number): RateLimitEntry {
  return { count: 1, resetAt: calculateRateLimitResetAt(now, windowMs) };
}

function defaultKeyGenerator(req: Request, trustProxy: boolean): string {
  return resolveRateLimitClientKey(req, trustProxy, "anonymous");
}

/** Store rate-limit counters in bounded process memory. */
export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string | typeof OVERFLOW_CLIENT_KEY, RateLimitEntry>();
  private readonly maxClientKeys: number;
  private readonly cleanupIntervalMs: number;
  private nextCleanupAt: number;

  /** Create a bounded in-memory store for counters with the given window. */
  constructor(windowMs: number, maxClientKeys = DEFAULT_MAX_CLIENT_KEYS) {
    assertPositiveSafeInteger("windowMs", windowMs);
    assertPositiveSafeInteger("maxClientKeys", maxClientKeys);
    this.maxClientKeys = maxClientKeys;
    this.cleanupIntervalMs = Math.min(
      windowMs * CLEANUP_INTERVAL_MULTIPLIER,
      MAX_CLEANUP_INTERVAL_MS,
    );
    this.nextCleanupAt = Date.now() + this.cleanupIntervalMs;
  }

  /** Remove expired counters during opportunistic maintenance. */
  private cleanupExpired(now: number): void {
    for (const [key, entry] of this.counts.entries()) {
      if (entry.resetAt <= now) this.counts.delete(key);
    }
    this.nextCleanupAt = now + this.cleanupIntervalMs;
  }

  /** Increment a key and return a detached snapshot of its window state. */
  increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    assertRateLimitKey(key);
    assertPositiveSafeInteger("windowMs", windowMs);
    const now = Date.now();
    if (now >= this.nextCleanupAt) this.cleanupExpired(now);
    let storageKey: string | typeof OVERFLOW_CLIENT_KEY = key;
    let existing = this.counts.get(storageKey);

    if (!existing && this.counts.size >= this.maxClientKeys) {
      storageKey = OVERFLOW_CLIENT_KEY;
      existing = this.counts.get(storageKey);
    }

    if (!existing || existing.resetAt <= now) {
      const entry = createRateLimitEntry(now, windowMs);
      this.counts.set(storageKey, entry);
      return Promise.resolve({ ...entry });
    }

    existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1);
    return Promise.resolve({ ...existing });
  }

  /** Remove the counter for a key. */
  reset(key: string): Promise<void> {
    assertRateLimitKey(key);
    this.counts.delete(key);
    return Promise.resolve();
  }

  /** Release all counters held by this store. */
  destroy(): void {
    this.counts.clear();
  }
}

/** Options accepted by rate limit. */
export interface RateLimitOptions {
  /** Maximum requests allowed in each window. */
  maxRequests?: number;
  /** Window duration in milliseconds. */
  windowMs?: number;
  /** Counter storage backend. */
  store?: RateLimitStore;
  /** Derive a stable, non-sensitive key no longer than 1024 characters. */
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
  value: unknown,
): value is RateLimitStore {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null &&
    "increment" in value && typeof (value as Partial<RateLimitStore>).increment === "function"
  );
}

/** Create rate-limit middleware. */
export function rateLimit(
  optionsOrMaxRequests?: number | RateLimitOptions,
  windowMsArg?: number,
): MiddlewareHandler {
  if (
    optionsOrMaxRequests !== undefined && typeof optionsOrMaxRequests !== "number" &&
    (optionsOrMaxRequests === null || typeof optionsOrMaxRequests !== "object" ||
      Array.isArray(optionsOrMaxRequests))
  ) {
    throw new TypeError("rateLimit options must be an object or request limit");
  }
  const options: RateLimitOptions = typeof optionsOrMaxRequests === "number"
    ? { maxRequests: optionsOrMaxRequests, windowMs: windowMsArg }
    : optionsOrMaxRequests ?? {};

  const maxRequests = options.maxRequests ?? DEFAULT_RATE_LIMIT_REQUESTS;
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  assertPositiveSafeInteger("maxRequests", maxRequests);
  assertPositiveSafeInteger("windowMs", windowMs);
  const store = options.store ?? new MemoryRateLimitStore(windowMs);
  assertRateLimitStore(store);
  if (options.keyGenerator !== undefined && typeof options.keyGenerator !== "function") {
    throw new TypeError("keyGenerator must be a function");
  }
  if (options.trustProxy !== undefined && typeof options.trustProxy !== "boolean") {
    throw new TypeError("trustProxy must be a boolean");
  }
  const trustProxy = options.trustProxy ?? false;
  const keyGenerator = options.keyGenerator ??
    ((req: Request) => defaultKeyGenerator(req, trustProxy));

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const key = keyGenerator(req);
    assertRateLimitKey(key);
    const entry = await store.increment(key, windowMs);
    assertRateLimitEntry(entry);

    if (entry.count <= maxRequests) return next();

    const retryAfterSeconds = Math.max(
      0,
      Math.ceil(
        (entry.resetAt - Date.now()) / MS_PER_SECOND,
      ),
    );

    return new Response("Too Many Requests", {
      status: HTTP_TOO_MANY_REQUESTS,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  };
}

/** Create a rate limiter for authentication endpoints (5 requests per 15 minutes). */
export function authRateLimit(
  storeOrOptions?: RateLimitStore | AuthRateLimitOptions,
): MiddlewareHandler {
  if (
    storeOrOptions !== undefined &&
    (storeOrOptions === null || typeof storeOrOptions !== "object" || Array.isArray(storeOrOptions))
  ) {
    throw new TypeError("authRateLimit options must be an object");
  }
  const options = !storeOrOptions
    ? {}
    : isRateLimitStore(storeOrOptions)
    ? { store: storeOrOptions }
    : storeOrOptions;

  return rateLimit({
    ...options,
    maxRequests: 5,
    windowMs: 15 * MS_PER_MINUTE,
  });
}
