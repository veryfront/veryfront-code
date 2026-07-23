/**
 * TracingTokenCache
 *
 * Wraps a {@link TokenCache} implementation and emits an OpenTelemetry span
 * around each public method. This keeps extension-provided caches (such as
 * `@veryfront/ext-cache-redis`) tracer-agnostic: the extension implements the
 * contract only, and the proxy applies observability at the factory boundary.
 *
 * Span names default to `cache.redis.<op>` to preserve the pre-extraction
 * behavior of the in-tree RedisCache. Callers may override via
 * {@link TracingTokenCacheOptions.spanPrefix} when wrapping a different
 * backend.
 */

import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";
import { withSpan } from "../tracing.ts";

/** Span naming options for {@link TracingTokenCache}. */
export interface TracingTokenCacheOptions {
  /** Span name prefix, e.g. "cache.redis" produces "cache.redis.get". */
  spanPrefix?: string;
}

const DEFAULT_SPAN_PREFIX = "cache.redis";
const MAX_SPAN_PREFIX_LENGTH = 128;

/** Cache backend failure with implementation details removed. */
export class TokenCacheOperationError extends Error {
  /** Create a sanitized failure for one cache operation. */
  constructor(operation: string) {
    super(`Token cache ${operation} failed`);
    this.name = "TokenCacheOperationError";
  }
}

async function runCacheOperation<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    throw new TokenCacheOperationError(operation);
  }
}

function requireSpanPrefix(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_SPAN_PREFIX_LENGTH ||
    !/^[a-z][a-z0-9_.-]*$/.test(value)
  ) {
    throw new TypeError(
      `spanPrefix must start with a lowercase letter and contain at most ${MAX_SPAN_PREFIX_LENGTH} lowercase letters, digits, dots, underscores, or hyphens`,
    );
  }
  return value;
}

function requireTokenCache(value: TokenCache): TokenCache {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("inner cache must implement TokenCache");
  }
  for (const method of ["get", "set", "delete", "clear", "has", "stats", "close"] as const) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`inner cache must provide ${method}()`);
    }
  }
  return value;
}

/** Adds bounded span names around a token cache without changing its storage policy. */
export class TracingTokenCache implements TokenCache {
  private readonly inner: TokenCache;
  private readonly prefix: string;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  /** Wrap a token cache. */
  constructor(inner: TokenCache, options: TracingTokenCacheOptions = {}) {
    this.inner = requireTokenCache(inner);
    this.prefix = requireSpanPrefix(options.spanPrefix ?? DEFAULT_SPAN_PREFIX);
  }

  /** Reject operations after lifecycle shutdown. */
  private assertOpen(): void {
    if (this.closed) throw new Error("TracingTokenCache is closed");
  }

  /** Trace and delegate a lookup. */
  get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      `${this.prefix}.get`,
      () => {
        this.assertOpen();
        return runCacheOperation("get", () => this.inner.get(key));
      },
    );
  }

  /** Trace and delegate a write. */
  set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      `${this.prefix}.set`,
      () => {
        this.assertOpen();
        return runCacheOperation("set", () => this.inner.set(key, entry));
      },
    );
  }

  /** Trace and delegate a deletion. */
  delete(key: string): Promise<void> {
    return withSpan(
      `${this.prefix}.delete`,
      () => {
        this.assertOpen();
        return runCacheOperation("delete", () => this.inner.delete(key));
      },
    );
  }

  /** Trace and delegate a full clear. */
  clear(): Promise<void> {
    return withSpan(`${this.prefix}.clear`, () => {
      this.assertOpen();
      return runCacheOperation("clear", () => this.inner.clear());
    });
  }

  /** Trace and delegate an existence check. */
  has(key: string): Promise<boolean> {
    return withSpan(
      `${this.prefix}.has`,
      () => {
        this.assertOpen();
        return runCacheOperation("has", () => this.inner.has(key));
      },
    );
  }

  /** Trace and delegate a statistics snapshot. */
  stats(): Promise<CacheStats> {
    return withSpan(`${this.prefix}.stats`, () => {
      this.assertOpen();
      return runCacheOperation("stats", () => this.inner.stats());
    });
  }

  /** Close the wrapped cache exactly once. */
  close(): Promise<void> {
    return withSpan(`${this.prefix}.close`, async () => {
      if (this.closePromise) return this.closePromise;
      this.closed = true;
      this.closePromise = runCacheOperation("close", () => this.inner.close());
      return this.closePromise;
    });
  }
}
