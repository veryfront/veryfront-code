/**
 * TracingTokenCache
 *
 * Wraps a {@link TokenCache} implementation and emits an OpenTelemetry span
 * around each public method. The wrapped operation set is snapshotted at
 * construction so later property replacement or accessor behavior cannot
 * change the cache boundary underneath the proxy.
 */

import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";
import { withSpan } from "../tracing.ts";
import {
  assertCacheOptionsObject,
  requireTokenCacheKey,
  snapshotTokenCacheEntry,
  snapshotTokenCacheOperations,
  snapshotTokenCacheStats,
  type TokenCacheOperations,
} from "./validation.ts";

export interface TracingTokenCacheOptions {
  /** Span name prefix, e.g. "cache.redis" produces "cache.redis.get". */
  spanPrefix?: string;
}

const DEFAULT_SPAN_PREFIX = "cache.redis";
const MAX_SPAN_PREFIX_CODE_UNITS = 128;
const SPAN_PREFIX_PATTERN = /^[a-z][a-z0-9_.-]*$/u;

function resolveSpanPrefix(options: TracingTokenCacheOptions): string {
  const descriptor = Object.getOwnPropertyDescriptor(options, "spanPrefix");
  if (descriptor && !("value" in descriptor)) {
    throw new TypeError("Tracing cache spanPrefix must be a data property");
  }
  const configured = descriptor && "value" in descriptor ? descriptor.value : undefined;
  const value = configured ?? DEFAULT_SPAN_PREFIX;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SPAN_PREFIX_CODE_UNITS ||
    !SPAN_PREFIX_PATTERN.test(value)
  ) {
    throw new TypeError("Tracing cache spanPrefix is invalid");
  }
  return value;
}

export class TracingTokenCache implements TokenCache {
  private readonly operations: TokenCacheOperations;
  private readonly prefix: string;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(inner: TokenCache, options: TracingTokenCacheOptions = {}) {
    if (!inner || typeof inner !== "object") {
      throw new TypeError("Tracing cache requires a cache object");
    }
    assertCacheOptionsObject(
      options,
      "Tracing cache options",
      ["spanPrefix"],
    );
    this.prefix = resolveSpanPrefix(options);
    this.operations = snapshotTokenCacheOperations(inner);
  }

  get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(`${this.prefix}.get`, async () => {
      this.assertOpen();
      const result = await this.operations.get(requireTokenCacheKey(key));
      return result === null ? null : snapshotTokenCacheEntry(result);
    });
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(`${this.prefix}.set`, async () => {
      this.assertOpen();
      const cacheKey = requireTokenCacheKey(key);
      const cachedEntry = snapshotTokenCacheEntry(entry);
      if (Date.now() >= cachedEntry.expiresAt) {
        await this.operations.delete(cacheKey);
        return;
      }
      await this.operations.set(
        cacheKey,
        cachedEntry,
      );
    });
  }

  delete(key: string): Promise<void> {
    return withSpan(`${this.prefix}.delete`, async () => {
      this.assertOpen();
      await this.operations.delete(requireTokenCacheKey(key));
    });
  }

  clear(): Promise<void> {
    return withSpan(`${this.prefix}.clear`, async () => {
      this.assertOpen();
      await this.operations.clear();
    });
  }

  has(key: string): Promise<boolean> {
    return withSpan(`${this.prefix}.has`, async () => {
      this.assertOpen();
      const result = await this.operations.has(requireTokenCacheKey(key));
      if (typeof result !== "boolean") {
        throw new TypeError("Token cache returned an invalid has result");
      }
      return result;
    });
  }

  stats(): Promise<CacheStats> {
    return withSpan(`${this.prefix}.stats`, async () => {
      this.assertOpen();
      return snapshotTokenCacheStats(await this.operations.stats());
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = withSpan(`${this.prefix}.close`, () => this.operations.close());
    return this.closePromise;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Tracing cache is closed");
  }
}
