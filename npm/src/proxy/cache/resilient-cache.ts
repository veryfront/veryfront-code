/**
 * Resilient Token Cache
 *
 * Wraps a primary cache (Redis) with a fallback cache (Memory).
 * Automatically falls back to memory cache when Redis operations fail.
 * Provides graceful degradation instead of hard failures.
 */

import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.js";
import { proxyLogger } from "../logger.js";
import { withSpan } from "../tracing.js";

const CIRCUIT_OPEN_DURATION_MS = 30_000; // 30 seconds
const FAILURE_THRESHOLD = 3; // failures before circuit opens

const logger = proxyLogger.child({ module: "cache" });

export class ResilientCache implements TokenCache {
  private primary: TokenCache;
  private fallback: TokenCache;
  private usingFallback = false;
  private failureCount = 0;
  private circuitOpenedAt: number | null = null;

  constructor(primary: TokenCache, fallback: TokenCache) {
    this.primary = primary;
    this.fallback = fallback;
  }

  /**
   * Check if we should try primary again after circuit was opened.
   */
  private shouldTryPrimary(): boolean {
    if (!this.usingFallback) return true;

    // If circuit was opened, check if enough time has passed
    if (this.circuitOpenedAt) {
      const elapsed = Date.now() - this.circuitOpenedAt;
      if (elapsed >= CIRCUIT_OPEN_DURATION_MS) {
        logger.info("[ResilientCache] Circuit half-open, trying primary again");
        return true;
      }
    }

    return false;
  }

  /**
   * Record a successful primary operation - reset failure state.
   */
  private recordSuccess(): void {
    if (this.usingFallback) {
      logger.info("[ResilientCache] Primary recovered, switching back from fallback");
      this.usingFallback = false;
      this.failureCount = 0;
      this.circuitOpenedAt = null;
    }
  }

  /**
   * Record a primary failure - may trigger fallback.
   */
  private recordFailure(error: unknown): void {
    this.failureCount++;
    logger.warn(
      `[ResilientCache] Primary cache error (${this.failureCount}/${FAILURE_THRESHOLD}):`,
      { error: error instanceof Error ? error.message : error },
    );

    if (this.failureCount >= FAILURE_THRESHOLD && !this.usingFallback) {
      logger.warn("[ResilientCache] Opening circuit, switching to fallback cache");
      this.usingFallback = true;
      this.circuitOpenedAt = Date.now();
    }
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan("cache.resilient.get", async () => {
      // Try primary if circuit allows
      if (this.shouldTryPrimary()) {
        try {
          const result = await this.primary.get(key);
          this.recordSuccess();
          return result;
        } catch (error) {
          this.recordFailure(error);
          // Don't return here - try fallback
        }
      }

      // Use fallback
      return this.fallback.get(key);
    }, { "cache.key": key, "cache.usingFallback": this.usingFallback });
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan("cache.resilient.set", async () => {
      // Always try to set in fallback (local cache)
      await this.fallback.set(key, entry);

      // Try primary if circuit allows
      if (this.shouldTryPrimary()) {
        try {
          await this.primary.set(key, entry);
          this.recordSuccess();
        } catch (error) {
          this.recordFailure(error);
          // Fallback already set above, no need to retry
        }
      }
    }, { "cache.key": key, "cache.usingFallback": this.usingFallback });
  }

  async delete(key: string): Promise<void> {
    return withSpan("cache.resilient.delete", async () => {
      // Delete from both
      await this.fallback.delete(key);

      if (this.shouldTryPrimary()) {
        try {
          await this.primary.delete(key);
          this.recordSuccess();
        } catch (error) {
          this.recordFailure(error);
        }
      }
    }, { "cache.key": key });
  }

  async clear(): Promise<void> {
    return withSpan("cache.resilient.clear", async () => {
      await this.fallback.clear();

      if (this.shouldTryPrimary()) {
        try {
          await this.primary.clear();
          this.recordSuccess();
        } catch (error) {
          this.recordFailure(error);
        }
      }
    });
  }

  async has(key: string): Promise<boolean> {
    return withSpan("cache.resilient.has", async () => {
      if (this.shouldTryPrimary()) {
        try {
          const result = await this.primary.has(key);
          this.recordSuccess();
          return result;
        } catch (error) {
          this.recordFailure(error);
        }
      }

      return this.fallback.has(key);
    }, { "cache.key": key });
  }

  async stats(): Promise<CacheStats> {
    return withSpan("cache.resilient.stats", async () => {
      const fallbackStats = await this.fallback.stats();

      if (this.shouldTryPrimary()) {
        try {
          const primaryStats = await this.primary.stats();
          this.recordSuccess();
          return {
            ...primaryStats,
            type: this.usingFallback ? "memory" as const : "redis" as const,
          };
        } catch (error) {
          this.recordFailure(error);
        }
      }

      return {
        ...fallbackStats,
        type: "memory" as const,
      };
    }, { "cache.usingFallback": this.usingFallback });
  }

  async close(): Promise<void> {
    return withSpan("cache.resilient.close", async () => {
      await Promise.all([this.primary.close(), this.fallback.close()]);
    });
  }

  /**
   * Get current resilience status for debugging/health checks.
   */
  getStatus(): {
    usingFallback: boolean;
    failureCount: number;
    circuitOpenedAt: number | null;
  } {
    return {
      usingFallback: this.usingFallback,
      failureCount: this.failureCount,
      circuitOpenedAt: this.circuitOpenedAt,
    };
  }
}
