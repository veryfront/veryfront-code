/**
 * Unified Cache Metrics System
 *
 * Provides consistent observability across ALL cache domains.
 * Each cache domain reports to this centralized metrics collector,
 * enabling unified dashboards and debugging regardless of cache implementation.
 *
 * @module cache/metrics
 */

import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import type { Span } from "@opentelemetry/api";

/**
 * Cache operation types for metrics tracking.
 */
export type CacheOperation = "get" | "set" | "delete" | "clear" | "evict" | "expire";

/**
 * Cache domains - each has different correctness invariants.
 */
export type CacheDomain =
  | "http-module" // External dependency bundles (esm.sh, etc.)
  | "transform" // Code compilation results
  | "file" // Filesystem I/O deduplication
  | "render" // SSR output caching
  | "mdx" // MDX compilation
  | "css" // CSS bundle caching
  | "data" // Data fetching cache
  | "config" // Configuration caching
  | "module-resolve"; // Module resolution caching

/**
 * Eviction reason for metrics tracking.
 */
export type EvictionReason = "lru" | "ttl" | "size" | "manual" | "memory-pressure";

/**
 * Statistics for a single cache domain.
 */
export interface CacheDomainStats {
  readonly domain: CacheDomain;
  readonly gets: number;
  readonly hits: number;
  readonly misses: number;
  readonly sets: number;
  readonly deletes: number;
  readonly evictions: number;
  readonly errors: number;
  readonly hitRate: number;
  readonly avgLatencyMs: number;
  readonly lastAccessTime: number;
}

/**
 * Aggregated stats across all domains.
 */
export interface CacheAggregateStats {
  readonly totalGets: number;
  readonly totalHits: number;
  readonly totalMisses: number;
  readonly totalSets: number;
  readonly totalEvictions: number;
  readonly totalErrors: number;
  readonly overallHitRate: number;
  readonly domainStats: Map<CacheDomain, CacheDomainStats>;
}

/**
 * Internal state for a single domain.
 */
interface DomainMetrics {
  gets: number;
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  errors: number;
  totalLatencyMs: number;
  lastAccessTime: number;
}

/**
 * Centralized cache metrics collector.
 * Singleton pattern to aggregate metrics across all cache instances.
 */
class CacheMetricsCollector {
  private metrics = new Map<CacheDomain, DomainMetrics>();
  private listeners: Array<(domain: CacheDomain, op: CacheOperation, key: string) => void> = [];

  private getOrCreateDomain(domain: CacheDomain): DomainMetrics {
    let dm = this.metrics.get(domain);
    if (!dm) {
      dm = {
        gets: 0,
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        evictions: 0,
        errors: 0,
        totalLatencyMs: 0,
        lastAccessTime: 0,
      };
      this.metrics.set(domain, dm);
    }
    return dm;
  }

  /**
   * Record a cache hit.
   */
  recordHit(domain: CacheDomain, key: string, latencyMs: number = 0): void {
    const dm = this.getOrCreateDomain(domain);
    dm.gets++;
    dm.hits++;
    dm.totalLatencyMs += latencyMs;
    dm.lastAccessTime = Date.now();
    this.notifyListeners(domain, "get", key);
  }

  /**
   * Record a cache miss.
   */
  recordMiss(domain: CacheDomain, key: string, latencyMs: number = 0): void {
    const dm = this.getOrCreateDomain(domain);
    dm.gets++;
    dm.misses++;
    dm.totalLatencyMs += latencyMs;
    dm.lastAccessTime = Date.now();
    this.notifyListeners(domain, "get", key);
  }

  /**
   * Record a cache set operation.
   */
  recordSet(domain: CacheDomain, key: string, latencyMs: number = 0): void {
    const dm = this.getOrCreateDomain(domain);
    dm.sets++;
    dm.totalLatencyMs += latencyMs;
    dm.lastAccessTime = Date.now();
    this.notifyListeners(domain, "set", key);
  }

  /**
   * Record a cache delete operation.
   */
  recordDelete(domain: CacheDomain, key: string): void {
    const dm = this.getOrCreateDomain(domain);
    dm.deletes++;
    dm.lastAccessTime = Date.now();
    this.notifyListeners(domain, "delete", key);
  }

  /**
   * Record a cache eviction.
   */
  recordEviction(domain: CacheDomain, reason: EvictionReason, key?: string): void {
    const dm = this.getOrCreateDomain(domain);
    dm.evictions++;
    dm.lastAccessTime = Date.now();
    this.notifyListeners(domain, "evict", key ?? `eviction:${reason}`);
  }

  /**
   * Record an error during cache operation.
   */
  recordError(domain: CacheDomain, _operation: CacheOperation, _error: Error): void {
    const dm = this.getOrCreateDomain(domain);
    dm.errors++;
    dm.lastAccessTime = Date.now();
  }

  /**
   * Get stats for a specific domain.
   */
  getDomainStats(domain: CacheDomain): CacheDomainStats | null {
    const dm = this.metrics.get(domain);
    if (!dm) return null;

    const hitRate = dm.gets > 0 ? dm.hits / dm.gets : 0;
    const avgLatencyMs = dm.gets > 0 ? dm.totalLatencyMs / dm.gets : 0;

    return {
      domain,
      gets: dm.gets,
      hits: dm.hits,
      misses: dm.misses,
      sets: dm.sets,
      deletes: dm.deletes,
      evictions: dm.evictions,
      errors: dm.errors,
      hitRate,
      avgLatencyMs,
      lastAccessTime: dm.lastAccessTime,
    };
  }

  /**
   * Get aggregated stats across all domains.
   */
  getAggregateStats(): CacheAggregateStats {
    let totalGets = 0;
    let totalHits = 0;
    let totalMisses = 0;
    let totalSets = 0;
    let totalEvictions = 0;
    let totalErrors = 0;

    const domainStats = new Map<CacheDomain, CacheDomainStats>();

    for (const [domain, dm] of this.metrics) {
      totalGets += dm.gets;
      totalHits += dm.hits;
      totalMisses += dm.misses;
      totalSets += dm.sets;
      totalEvictions += dm.evictions;
      totalErrors += dm.errors;

      const stats = this.getDomainStats(domain);
      if (stats) domainStats.set(domain, stats);
    }

    return {
      totalGets,
      totalHits,
      totalMisses,
      totalSets,
      totalEvictions,
      totalErrors,
      overallHitRate: totalGets > 0 ? totalHits / totalGets : 0,
      domainStats,
    };
  }

  /**
   * Reset all metrics (useful for testing).
   */
  reset(): void {
    this.metrics.clear();
  }

  /**
   * Reset metrics for a specific domain.
   */
  resetDomain(domain: CacheDomain): void {
    this.metrics.delete(domain);
  }

  /**
   * Add a listener for cache operations (useful for testing/debugging).
   */
  addListener(listener: (domain: CacheDomain, op: CacheOperation, key: string) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener.
   */
  removeListener(listener: (domain: CacheDomain, op: CacheOperation, key: string) => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  private notifyListeners(domain: CacheDomain, op: CacheOperation, key: string): void {
    for (const listener of this.listeners) {
      try {
        listener(domain, op, key);
      } catch (_) {
        // expected: listener errors must not disrupt metric collection
      }
    }
  }
}

/**
 * Global metrics collector instance.
 */
export const cacheMetrics = new CacheMetricsCollector();

/**
 * Instrumented cache wrapper that automatically reports metrics.
 * Wraps any cache-like object to add unified metrics collection.
 */
export interface InstrumentedCache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  readonly domain: CacheDomain;
}

/**
 * Create an instrumented cache wrapper around any cache implementation.
 */
export function instrumentCache<T>(
  domain: CacheDomain,
  cache: {
    get: (key: string) => Promise<T | null>;
    set: (key: string, value: T, ttl?: number) => Promise<void>;
    delete?: (key: string) => Promise<void>;
  },
): InstrumentedCache<T> {
  return {
    domain,

    async get(key: string): Promise<T | null> {
      const start = performance.now();
      try {
        const value = await cache.get(key);
        const latency = performance.now() - start;
        if (value !== null) {
          cacheMetrics.recordHit(domain, key, latency);
        } else {
          cacheMetrics.recordMiss(domain, key, latency);
        }
        return value;
      } catch (error) {
        cacheMetrics.recordError(domain, "get", ensureError(error));
        throw error;
      }
    },

    async set(key: string, value: T, ttl?: number): Promise<void> {
      const start = performance.now();
      try {
        await cache.set(key, value, ttl);
        cacheMetrics.recordSet(domain, key, performance.now() - start);
      } catch (error) {
        cacheMetrics.recordError(domain, "set", ensureError(error));
        throw error;
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await cache.delete?.(key);
        cacheMetrics.recordDelete(domain, key);
      } catch (error) {
        cacheMetrics.recordError(domain, "delete", ensureError(error));
        throw error;
      }
    },
  };
}

/**
 * Record a cache operation with OpenTelemetry span.
 */
export function withCacheSpan<T>(
  domain: CacheDomain,
  operation: CacheOperation,
  key: string,
  fn: (span?: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    `cache.${domain}.${operation}`,
    fn,
    {
      "cache.domain": domain,
      "cache.operation": operation,
      "cache.key": key.length > 100 ? key.slice(0, 100) + "..." : key,
    },
  );
}

/**
 * Export metrics in Prometheus format (for /metrics endpoint).
 */
export function exportPrometheusMetrics(): string {
  const stats = cacheMetrics.getAggregateStats();
  const lines: string[] = [];

  lines.push("# HELP veryfront_cache_gets_total Total cache get operations");
  lines.push("# TYPE veryfront_cache_gets_total counter");

  lines.push("# HELP veryfront_cache_hits_total Total cache hits");
  lines.push("# TYPE veryfront_cache_hits_total counter");

  lines.push("# HELP veryfront_cache_misses_total Total cache misses");
  lines.push("# TYPE veryfront_cache_misses_total counter");

  lines.push("# HELP veryfront_cache_sets_total Total cache set operations");
  lines.push("# TYPE veryfront_cache_sets_total counter");

  lines.push("# HELP veryfront_cache_evictions_total Total cache evictions");
  lines.push("# TYPE veryfront_cache_evictions_total counter");

  lines.push("# HELP veryfront_cache_hit_rate Cache hit rate (0-1)");
  lines.push("# TYPE veryfront_cache_hit_rate gauge");

  for (const [domain, domainStats] of stats.domainStats) {
    lines.push(`veryfront_cache_gets_total{domain="${domain}"} ${domainStats.gets}`);
    lines.push(`veryfront_cache_hits_total{domain="${domain}"} ${domainStats.hits}`);
    lines.push(`veryfront_cache_misses_total{domain="${domain}"} ${domainStats.misses}`);
    lines.push(`veryfront_cache_sets_total{domain="${domain}"} ${domainStats.sets}`);
    lines.push(`veryfront_cache_evictions_total{domain="${domain}"} ${domainStats.evictions}`);
    lines.push(`veryfront_cache_hit_rate{domain="${domain}"} ${domainStats.hitRate.toFixed(4)}`);
  }

  return lines.join("\n");
}
