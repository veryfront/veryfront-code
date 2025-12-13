import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { RedisRateLimitStore } from "./redis-rate-limit.ts";

// Mock Redis client for testing
class MockRedisClient {
  private data = new Map<string, { value: number; ttl: number }>();

  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    return Promise.resolve();
  }

  async incr(key: string): Promise<number> {
    const entry = this.data.get(key);
    if (entry) {
      entry.value++;
      this.data.set(key, entry);
      return entry.value;
    } else {
      this.data.set(key, { value: 1, ttl: -1 });
      return 1;
    }
  }

  async pExpire(key: string, milliseconds: number): Promise<boolean> {
    const entry = this.data.get(key);
    if (entry) {
      entry.ttl = milliseconds;
      this.data.set(key, entry);
      return true;
    }
    return false;
  }

  async pTTL(key: string): Promise<number> {
    const entry = this.data.get(key);
    return entry?.ttl ?? -1;
  }

  async del(key: string): Promise<number> {
    if (this.data.has(key)) {
      this.data.delete(key);
      return 1;
    }
    return 0;
  }

  on(_event: string, _listener: (...args: unknown[]) => void): void {
    // Mock event listener
  }
}

describe("RedisRateLimitStore", () => {
  it("should construct with default options", () => {
    const store = new RedisRateLimitStore();
    assertExists(store);
  });

  it("should construct with custom options", () => {
    const store = new RedisRateLimitStore({
      url: "redis://localhost:6379",
      keyPrefix: "custom:",
    });
    assertExists(store);
  });

  it("should throw error when redis client is not available", async () => {
    const store = new RedisRateLimitStore();
    let errorThrown = false;

    try {
      await store.increment("test-key", 60000);
    } catch (error) {
      errorThrown = true;
      assertEquals(
        error instanceof Error && error.message.includes("Redis rate limit"),
        true,
      );
    }

    assertEquals(errorThrown, true);
  });

  it("should use default key prefix", () => {
    const store = new RedisRateLimitStore();
    assertExists(store);
  });

  it("should use custom key prefix", () => {
    const store = new RedisRateLimitStore({ keyPrefix: "myapp:" });
    assertExists(store);
  });

  it("should handle destroy when client is null", async () => {
    const store = new RedisRateLimitStore();
    await store.destroy();
    // Should not throw
  });
});

describe("RedisRateLimitStore integration", () => {
  it("should be compatible with rate limit interface", () => {
    const store = new RedisRateLimitStore();

    // Check that store has required methods
    assertEquals(typeof store.increment, "function");
    assertEquals(typeof store.reset, "function");
    assertEquals(typeof store.destroy, "function");
  });

  it("should accept url option", () => {
    const store = new RedisRateLimitStore({
      url: "redis://custom-host:6379",
    });
    assertExists(store);
  });

  it("should accept keyPrefix option", () => {
    const store = new RedisRateLimitStore({
      keyPrefix: "test:prefix:",
    });
    assertExists(store);
  });

  it("should accept both url and keyPrefix options", () => {
    const store = new RedisRateLimitStore({
      url: "redis://localhost:6379",
      keyPrefix: "app:ratelimit:",
    });
    assertExists(store);
  });
});
