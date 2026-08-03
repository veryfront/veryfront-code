import type { Middleware } from "../types.ts";
import { getRequest } from "../types.ts";
import type { RateLimitEntry, RateLimitStore } from "./types.ts";
import {
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAVAILABLE,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from "#veryfront/utils/constants/http.ts";
import { CLEANUP_INTERVAL_MULTIPLIER } from "#veryfront/utils/constants/cache.ts";
import { getHostEnv, unrefTimer } from "#veryfront/platform/compat/process.ts";
import { resolveRateLimitClientKey } from "#veryfront/security/rate-limit/client-key.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { serverLogger } from "#veryfront/utils";
import {
  requireRateLimitEntry,
  requireRateLimitKey,
  requireRateLimitWindowMs,
} from "./rate-limit-validation.ts";

const DEFAULT_RATE_LIMIT_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;
const DEFAULT_MEMORY_RATE_LIMIT_MAX_ENTRIES = 10_000;
const STORE_FAILURE_RETRY_AFTER_SECONDS = 60;
const STORE_FAILURE_LOG_INTERVAL_MS = MS_PER_MINUTE;
const logger = serverLogger.component("rate-limit");

class MemoryRateLimitCapacityError extends Error {
  override readonly name = "MemoryRateLimitCapacityError";

  constructor(readonly capacity: number) {
    super(`Memory rate limit store capacity of ${capacity} entries is exhausted`);
  }
}

function createRateLimitEntry(now: number, windowMs: number): RateLimitEntry {
  return { count: 1, resetAt: now + windowMs };
}

function defaultKeyGenerator(req: Request, trustProxy: boolean): string {
  return resolveRateLimitClientKey(req, trustProxy, "anonymous");
}

/** Implement memory rate limit store. */
export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, RateLimitEntry>();
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private readonly maxEntries: number;

  constructor(
    windowMs: number,
    options: MemoryRateLimitStoreOptions = {},
  ) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Memory rate limit store options must be an object");
    }
    const normalizedWindowMs = requireRateLimitWindowMs(windowMs);
    const maxEntries = options.maxEntries ??
      DEFAULT_MEMORY_RATE_LIMIT_MAX_ENTRIES;
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError(
        "Memory rate limit maxEntries must be a positive safe integer",
      );
    }
    this.maxEntries = maxEntries;

    const shouldSkipInterval =
      (globalThis as Record<string, unknown>).__vfDisableLruInterval === true ||
      getHostEnv("VF_DISABLE_LRU_INTERVAL") === "1";

    if (shouldSkipInterval) return;

    this.cleanupInterval = setInterval(
      () => {
        this.removeExpired(Date.now());
      },
      Math.min(
        normalizedWindowMs * CLEANUP_INTERVAL_MULTIPLIER,
        MAX_TIMER_DELAY_MS,
      ),
    );

    unrefTimer(this.cleanupInterval);
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const normalizedKey = requireRateLimitKey(key);
    const normalizedWindowMs = requireRateLimitWindowMs(windowMs);
    const existing = this.counts.get(normalizedKey);
    const now = Date.now();

    if (!existing || existing.resetAt <= now) {
      if (existing) this.counts.delete(normalizedKey);

      if (this.counts.size >= this.maxEntries) {
        this.removeExpired(now);
      }
      if (this.counts.size >= this.maxEntries) {
        throw new MemoryRateLimitCapacityError(this.maxEntries);
      }

      const entry = createRateLimitEntry(now, normalizedWindowMs);
      this.counts.set(normalizedKey, entry);
      return { ...entry };
    }

    if (existing.count < Number.MAX_SAFE_INTEGER) existing.count++;
    return { ...existing };
  }

  async reset(key: string): Promise<void> {
    this.counts.delete(requireRateLimitKey(key));
  }

  destroy(): void {
    this.counts.clear();
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.counts) {
      if (entry.resetAt <= now) this.counts.delete(key);
    }
  }
}

/** Options accepted by the in-memory rate limit store. */
export interface MemoryRateLimitStoreOptions {
  /**
   * Maximum number of active identities retained by the store.
   * Defaults to 10,000. Size this above the peak number of distinct identities
   * expected during one complete rate-limit window, including burst headroom.
   * At capacity, increments for identities without an active entry fail.
   * Active entries are never evicted because identity flooding could otherwise
   * reset an attacker's quota. When used through `rateLimit()`, capacity
   * exhaustion logs `stage=store-increment`,
   * `failureKind=capacity-exhausted`, and the configured `capacity`.
   */
  maxEntries?: number;
}

/** Options accepted by rate limit. */
export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  store?: RateLimitStore;
  /**
   * Maximum active identities retained by the default in-memory store.
   * Defaults to 10,000. At capacity, requests for identities without an active
   * entry receive HTTP 503. Active entries are not evicted because doing so
   * would let identity floods reset quotas. Capacity failures log
   * `stage=store-increment`, `failureKind=capacity-exhausted`, and the
   * configured `capacity`. Incompatible with a caller-provided `store`.
   */
  maxEntries?: number;
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
  /**
   * Maximum active identities retained by the preset's default in-memory store.
   * See `RateLimitOptions.maxEntries` for capacity behavior and defaults.
   */
  maxEntries?: number;
  /** Function to derive a stable client key from the request. */
  keyGenerator?: (req: Request) => string;
  /**
   * Trust X-Forwarded-For and X-Real-IP for client identification.
   * Enable this only behind a trusted reverse proxy.
   */
  trustProxy?: boolean;
}

function isRateLimitStore(value: unknown): value is RateLimitStore {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Partial<RateLimitStore>).increment === "function" &&
    typeof (value as Partial<RateLimitStore>).reset === "function"
  );
}

function hasRateLimitStoreMethod(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    ("increment" in value || "reset" in value)
  );
}

function requireRateLimitStore(value: unknown): RateLimitStore {
  if (!isRateLimitStore(value)) {
    throw new TypeError(
      "Rate limit store must implement increment() and reset()",
    );
  }
  return value as RateLimitStore;
}

function requireMaxRequests(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      `Rate limit maxRequests must be an integer between 0 and ${Number.MAX_SAFE_INTEGER - 1}`,
    );
  }
  return value;
}

function storeUnavailableResponse(): Response {
  return new Response("Service temporarily unavailable", {
    status: HTTP_UNAVAILABLE,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(STORE_FAILURE_RETRY_AFTER_SECONDS),
    },
  });
}

/** Create rate-limit middleware. */
export function rateLimit(
  optionsOrMaxRequests?: number | RateLimitOptions,
  windowMsArg?: number,
): Middleware {
  if (
    optionsOrMaxRequests !== undefined &&
    typeof optionsOrMaxRequests !== "number" &&
    (typeof optionsOrMaxRequests !== "object" ||
      optionsOrMaxRequests === null ||
      Array.isArray(optionsOrMaxRequests))
  ) {
    throw new TypeError(
      "Rate limit configuration must be a number or options object",
    );
  }

  const options: RateLimitOptions = typeof optionsOrMaxRequests === "number"
    ? { maxRequests: optionsOrMaxRequests, windowMs: windowMsArg }
    : optionsOrMaxRequests ?? {};

  const maxRequests = requireMaxRequests(
    options.maxRequests ?? DEFAULT_RATE_LIMIT_REQUESTS,
  );
  const windowMs = requireRateLimitWindowMs(
    options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  if (options.store !== undefined && options.maxEntries !== undefined) {
    throw new TypeError("Rate limit maxEntries cannot be combined with a custom store");
  }
  const store = options.store === undefined
    ? new MemoryRateLimitStore(windowMs, { maxEntries: options.maxEntries })
    : requireRateLimitStore(options.store);
  if (
    options.trustProxy !== undefined &&
    typeof options.trustProxy !== "boolean"
  ) {
    throw new TypeError("Rate limit trustProxy must be a boolean");
  }
  const trustProxy = options.trustProxy ?? false;
  if (
    options.keyGenerator !== undefined &&
    typeof options.keyGenerator !== "function"
  ) {
    throw new TypeError("Rate limit keyGenerator must be a function");
  }
  const keyGenerator = options.keyGenerator ??
    ((req: Request) => defaultKeyGenerator(req, trustProxy));
  const lastFailureLogAt = new Map<string, number>();

  return async (ctx, next) => {
    const req = getRequest(ctx);
    let entry: RateLimitEntry;
    let stage: "key-resolution" | "store-increment" = "key-resolution";
    try {
      const key = requireRateLimitKey(keyGenerator(req));
      stage = "store-increment";
      entry = requireRateLimitEntry(await store.increment(key, windowMs));
    } catch (error) {
      const failureKind = error instanceof MemoryRateLimitCapacityError
        ? "capacity-exhausted"
        : stage === "key-resolution"
        ? "key-resolution"
        : "store-unavailable";
      const now = performance.now();
      const lastLogAt = lastFailureLogAt.get(failureKind);
      if (
        lastLogAt === undefined ||
        now - lastLogAt >= STORE_FAILURE_LOG_INTERVAL_MS
      ) {
        lastFailureLogAt.set(failureKind, now);
        const message = failureKind === "capacity-exhausted"
          ? "Rate limit store capacity exhausted; request denied"
          : failureKind === "key-resolution"
          ? "Rate limit key resolution failed; request denied"
          : "Rate limit store failed; request denied";
        logger.error(message, {
          failureKind,
          stage,
          errorName: error instanceof Error ? error.name : typeof error,
          ...(error instanceof MemoryRateLimitCapacityError ? { capacity: error.capacity } : {}),
        });
      }
      return storeUnavailableResponse();
    }

    if (entry.count <= maxRequests) return next();

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - Date.now()) / MS_PER_SECOND),
    );

    return new Response("Too Many Requests", {
      status: HTTP_TOO_MANY_REQUESTS,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
      },
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
    : hasRateLimitStoreMethod(storeOrOptions)
    ? { store: requireRateLimitStore(storeOrOptions) }
    : storeOrOptions;

  return rateLimit({
    maxRequests: 5,
    windowMs: 15 * MS_PER_MINUTE,
    ...options,
  });
}
