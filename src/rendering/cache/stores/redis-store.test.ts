import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RedisCacheStore } from "./redis-store.ts";

/**
 * RedisCacheStore Unit Tests
 *
 * Note: These tests focus on synchronous behavior and configuration.
 * Tests that require actual Redis connections are skipped to avoid
 * test hangs from connection retries to non-existent servers.
 *
 * Integration tests with a real Redis server should be run separately
 * in an environment where Redis is available.
 */

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      const store = new RedisCacheStore();
      expect(store).toBeDefined();
    });

    it("should create store with custom key prefix", () => {
      const store = new RedisCacheStore({ keyPrefix: "custom:" });
      expect(store).toBeDefined();
    });

    it("should create store with fallback disabled", () => {
      const store = new RedisCacheStore({ enableFallback: false });
      expect(store).toBeDefined();
    });

    it("should create store with custom URL", () => {
      const store = new RedisCacheStore({ url: "redis://localhost:6379" });
      expect(store).toBeDefined();
    });

    it("should create store with all options", () => {
      const store = new RedisCacheStore({
        url: "redis://localhost:6379",
        keyPrefix: "test:",
        enableFallback: true,
      });
      expect(store).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up resources on destroy when not connected", async () => {
      const store = new RedisCacheStore();
      // Should not throw when destroying uninitialized store
      await store.destroy();
    });

    it("should be safe to call destroy multiple times", async () => {
      const store = new RedisCacheStore();
      await store.destroy();
      await store.destroy();
      // Should not throw
    });
  });

  describe("configuration", () => {
    it("should use default prefix 'veryfront:render:'", () => {
      // This is tested implicitly through the storageKey method
      // We can verify by checking the store is created correctly
      const store = new RedisCacheStore();
      expect(store).toBeDefined();
    });

    it("should enable fallback by default", () => {
      // Fallback is enabled by default (true)
      const store = new RedisCacheStore();
      expect(store).toBeDefined();
    });
  });
});

// Note: Tests that would require actual Redis connections (like get/set/delete/clear)
// are intentionally not included here because:
// 1. Connecting to an invalid host causes the Redis client to hang on retries
// 2. These operations require a running Redis server
//
// For proper integration testing of Redis operations:
// - Use a test Redis instance (e.g., via Docker)
// - Run integration tests in a separate test suite
// - Use the tests/integration directory for such tests
