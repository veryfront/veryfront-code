import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

const CIRCUIT_OPEN_DURATION_MS = 30_000;
const FAILURE_THRESHOLD = 3;

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

  private shouldTryPrimary(): boolean {
    if (!this.usingFallback) return true;

    const openedAt = this.circuitOpenedAt;
    if (openedAt == null) return false;

    const elapsed = Date.now() - openedAt;
    if (elapsed < CIRCUIT_OPEN_DURATION_MS) return false;

    logger.info("[ResilientCache] Circuit half-open, trying primary again");
    return true;
  }

  private recordSuccess(): void {
    if (!this.usingFallback) return;

    logger.info("[ResilientCache] Primary recovered, switching back from fallback");
    this.usingFallback = false;
    this.failureCount = 0;
    this.circuitOpenedAt = null;
  }

  private recordFailure(error: unknown): void {
    this.failureCount++;
    logger.warn(
      `[ResilientCache] Primary cache error (${this.failureCount}/${FAILURE_THRESHOLD}):`,
      { error: error instanceof Error ? error.message : error },
    );

    if (this.usingFallback) return;
    if (this.failureCount < FAILURE_THRESHOLD) return;

    logger.warn("[ResilientCache] Opening circuit, switching to fallback cache");
    this.usingFallback = true;
    this.circuitOpenedAt = Date.now();
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      "cache.resilient.get",
      async () => {
        if (this.shouldTryPrimary()) {
          try {
            const result = await this.primary.get(key);
            this.recordSuccess();
            return result;
          } catch (error) {
            this.recordFailure(error);
          }
        }

        return this.fallback.get(key);
      },
      { "cache.key": key, "cache.usingFallback": this.usingFallback },
    );
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      "cache.resilient.set",
      async () => {
        await this.fallback.set(key, entry);

        if (!this.shouldTryPrimary()) return;

        try {
          await this.primary.set(key, entry);
          this.recordSuccess();
        } catch (error) {
          this.recordFailure(error);
        }
      },
      { "cache.key": key, "cache.usingFallback": this.usingFallback },
    );
  }

  async delete(key: string): Promise<void> {
    return withSpan(
      "cache.resilient.delete",
      async () => {
        await this.fallback.delete(key);

        if (!this.shouldTryPrimary()) return;

        try {
          await this.primary.delete(key);
          this.recordSuccess();
        } catch (error) {
          this.recordFailure(error);
        }
      },
      { "cache.key": key },
    );
  }

  async clear(): Promise<void> {
    return withSpan("cache.resilient.clear", async () => {
      await this.fallback.clear();

      if (!this.shouldTryPrimary()) return;

      try {
        await this.primary.clear();
        this.recordSuccess();
      } catch (error) {
        this.recordFailure(error);
      }
    });
  }

  async has(key: string): Promise<boolean> {
    return withSpan(
      "cache.resilient.has",
      async () => {
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
      },
      { "cache.key": key },
    );
  }

  async stats(): Promise<CacheStats> {
    return withSpan(
      "cache.resilient.stats",
      async () => {
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

        return { ...fallbackStats, type: "memory" };
      },
      { "cache.usingFallback": this.usingFallback },
    );
  }

  async close(): Promise<void> {
    return withSpan("cache.resilient.close", async () => {
      await Promise.all([this.primary.close(), this.fallback.close()]);
    });
  }

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
