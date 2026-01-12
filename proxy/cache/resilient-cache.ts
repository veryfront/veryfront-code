/**
 * Resilient Token Cache
 *
 * Wraps a primary cache (Redis) with a fallback cache (Memory).
 * Automatically falls back to memory cache when Redis operations fail.
 * Provides graceful degradation instead of hard failures.
 */

import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";

const CIRCUIT_OPEN_DURATION_MS = 30_000; // 30 seconds
const FAILURE_THRESHOLD = 3; // failures before circuit opens

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
        console.log("[ResilientCache] Circuit half-open, trying primary again");
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
      console.log("[ResilientCache] Primary recovered, switching back from fallback");
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
    console.warn(
      `[ResilientCache] Primary cache error (${this.failureCount}/${FAILURE_THRESHOLD}):`,
      error instanceof Error ? error.message : error
    );

    if (this.failureCount >= FAILURE_THRESHOLD && !this.usingFallback) {
      console.warn("[ResilientCache] Opening circuit, switching to fallback cache");
      this.usingFallback = true;
      this.circuitOpenedAt = Date.now();
    }
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
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
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
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
  }

  async delete(key: string): Promise<void> {
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
  }

  async clear(): Promise<void> {
    await this.fallback.clear();

    if (this.shouldTryPrimary()) {
      try {
        await this.primary.clear();
        this.recordSuccess();
      } catch (error) {
        this.recordFailure(error);
      }
    }
  }

  async has(key: string): Promise<boolean> {
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
  }

  async stats(): Promise<CacheStats> {
    const fallbackStats = await this.fallback.stats();

    if (this.shouldTryPrimary()) {
      try {
        const primaryStats = await this.primary.stats();
        this.recordSuccess();
        return {
          ...primaryStats,
          type: this.usingFallback ? "memory" : "redis",
        };
      } catch (error) {
        this.recordFailure(error);
      }
    }

    return {
      ...fallbackStats,
      type: "memory",
    };
  }

  async close(): Promise<void> {
    await Promise.all([this.primary.close(), this.fallback.close()]);
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
