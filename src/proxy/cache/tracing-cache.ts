/**
 * TracingTokenCache
 *
 * Wraps a {@link TokenCache} implementation and emits an OpenTelemetry span
 * around each public method. This keeps extension-provided caches (such as
 * `@veryfront/ext-redis`) tracer-agnostic: the extension implements the
 * contract only, and the proxy applies observability at the factory boundary.
 *
 * Span names default to `cache.redis.<op>` to preserve the pre-extraction
 * behavior of the in-tree RedisCache. Callers may override via
 * {@link TracingTokenCacheOptions.spanPrefix} when wrapping a different
 * backend.
 */

import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";
import { withSpan } from "../tracing.ts";

export interface TracingTokenCacheOptions {
  /** Span name prefix, e.g. "cache.redis" produces "cache.redis.get". */
  spanPrefix?: string;
}

const DEFAULT_SPAN_PREFIX = "cache.redis";

export class TracingTokenCache implements TokenCache {
  private readonly inner: TokenCache;
  private readonly prefix: string;

  constructor(inner: TokenCache, options: TracingTokenCacheOptions = {}) {
    this.inner = inner;
    this.prefix = options.spanPrefix ?? DEFAULT_SPAN_PREFIX;
  }

  get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      `${this.prefix}.get`,
      () => this.inner.get(key),
      { "cache.key": key },
    );
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      `${this.prefix}.set`,
      () => this.inner.set(key, entry),
      { "cache.key": key },
    );
  }

  delete(key: string): Promise<void> {
    return withSpan(
      `${this.prefix}.delete`,
      () => this.inner.delete(key),
      { "cache.key": key },
    );
  }

  clear(): Promise<void> {
    return withSpan(`${this.prefix}.clear`, () => this.inner.clear());
  }

  has(key: string): Promise<boolean> {
    return withSpan(
      `${this.prefix}.has`,
      () => this.inner.has(key),
      { "cache.key": key },
    );
  }

  stats(): Promise<CacheStats> {
    return withSpan(`${this.prefix}.stats`, () => this.inner.stats());
  }

  close(): Promise<void> {
    return withSpan(`${this.prefix}.close`, () => this.inner.close());
  }
}
