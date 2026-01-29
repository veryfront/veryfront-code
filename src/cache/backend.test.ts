/**
 * Cache Backend Tests
 *
 * Tests MemoryCacheBackend, ApiCacheBackend, RedisCacheBackend,
 * isDistributedBackend, createDistributedCacheAccessor, and
 * CacheBackends factory functions.
 *
 * @module cache/backend.test
 */

import { assertEquals, assertExists } from "@std/assert";

Deno.test({
  name: "backend.ts imports without circular dependency",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const mod = await import("./backend.ts");

    assertExists(mod.MemoryCacheBackend);
    assertExists(mod.RedisCacheBackend);
    assertExists(mod.ApiCacheBackend);
    assertExists(mod.createCacheBackend);
    assertExists(mod.CacheBackends);
    assertExists(mod.isApiCacheAvailable);
  },
});

Deno.test("MemoryCacheBackend basic operations", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);
  assertEquals(cache.type, "memory");

  await cache.set("key1", "value1", 60);
  assertEquals(await cache.get("key1"), "value1");

  await cache.del("key1");
  assertEquals(await cache.get("key1"), null);

  await cache.set("a", "1");
  await cache.set("b", "2");
  assertEquals(cache.size, 2);

  cache.clear();
  assertEquals(cache.size, 0);
});

Deno.test("MemoryCacheBackend TTL expiration", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);

  await cache.set("expires", "soon", 1);
  assertEquals(await cache.get("expires"), "soon");

  await new Promise((resolve) => setTimeout(resolve, 1100));

  assertEquals(await cache.get("expires"), null);
});

Deno.test("MemoryCacheBackend evicts oldest on capacity", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(3);

  await cache.set("a", "1");
  await cache.set("b", "2");
  await cache.set("c", "3");
  assertEquals(cache.size, 3);

  await cache.set("d", "4");
  assertEquals(cache.size, 3);
  assertEquals(await cache.get("a"), null);
  assertEquals(await cache.get("d"), "4");
});

Deno.test("MemoryCacheBackend delByPattern", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);

  await cache.set("http:mod1", "v1");
  await cache.set("http:mod2", "v2");
  await cache.set("other:key", "v3");

  assertEquals(await cache.delByPattern("http:*"), 2);
  assertEquals(await cache.get("http:mod1"), null);
  assertEquals(await cache.get("http:mod2"), null);
  assertEquals(await cache.get("other:key"), "v3");
});

Deno.test("MemoryCacheBackend getBatch returns all requested keys", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);
  await cache.set("k1", "v1");
  await cache.set("k2", "v2");

  const results = await cache.getBatch(["k1", "k2", "missing"]);
  assertEquals(results.get("k1"), "v1");
  assertEquals(results.get("k2"), "v2");
  assertEquals(results.get("missing"), null);
});

Deno.test("MemoryCacheBackend getBatch handles expired entries", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);
  await cache.set("exp", "val", 0); // TTL of 0 means expires immediately

  // Slight delay to ensure expiration
  await new Promise((r) => setTimeout(r, 10));

  const results = await cache.getBatch(["exp"]);
  assertEquals(results.get("exp"), null);
});

Deno.test("MemoryCacheBackend setBatch sets multiple entries", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);
  await cache.setBatch([
    { key: "a", value: "1" },
    { key: "b", value: "2", ttl: 60 },
    { key: "c", value: "3" },
  ]);

  assertEquals(await cache.get("a"), "1");
  assertEquals(await cache.get("b"), "2");
  assertEquals(await cache.get("c"), "3");
  assertEquals(cache.size, 3);
});

Deno.test("MemoryCacheBackend setBatch evicts when at capacity", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(2);
  await cache.set("existing", "old");

  await cache.setBatch([
    { key: "new1", value: "v1" },
    { key: "new2", value: "v2" },
  ]);

  assertEquals(cache.size, 2);
});

Deno.test("MemoryCacheBackend delByPattern uses regex cache", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(20);
  await cache.set("prefix:a", "1");
  await cache.set("prefix:b", "2");
  await cache.set("other:c", "3");

  // First call creates regex
  assertEquals(await cache.delByPattern("prefix:*"), 2);

  // Add more matching entries
  await cache.set("prefix:d", "4");

  // Second call reuses cached regex
  assertEquals(await cache.delByPattern("prefix:*"), 1);
});

Deno.test("MemoryCacheBackend delByPattern with ? wildcard", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);
  await cache.set("key-a", "1");
  await cache.set("key-b", "2");
  await cache.set("key-ab", "3");

  assertEquals(await cache.delByPattern("key-?"), 2);
  assertEquals(await cache.get("key-ab"), "3");
});

Deno.test("MemoryCacheBackend set overwrites existing entry without eviction", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(2);
  await cache.set("a", "1");
  await cache.set("b", "2");

  // Overwrite existing key - should not evict
  await cache.set("a", "updated");
  assertEquals(cache.size, 2);
  assertEquals(await cache.get("a"), "updated");
  assertEquals(await cache.get("b"), "2");
});

Deno.test("ApiCacheBackend requires auth and project context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  assertEquals(await cache.get("test-key"), null);
});

Deno.test("ApiCacheBackend type property", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  assertEquals(cache.type, "api");
});

Deno.test("ApiCacheBackend set returns without auth context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  await cache.set("key", "value"); // Should not throw
});

Deno.test("ApiCacheBackend del returns without auth context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  await cache.del("key"); // Should not throw
});

Deno.test("ApiCacheBackend delByPattern returns 0 without auth context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  assertEquals(await cache.delByPattern("prefix:*"), 0);
});

Deno.test("ApiCacheBackend getBatch returns nulls without auth context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  const results = await cache.getBatch(["k1", "k2"]);
  // Should return empty map or map with nulls
  assertEquals(results.size === 0 || results.get("k1") === null, true);
});

Deno.test("ApiCacheBackend getBatch returns empty map for empty keys", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  const results = await cache.getBatch([]);
  assertEquals(results.size, 0);
});

Deno.test("ApiCacheBackend setBatch returns without auth context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  await cache.setBatch([{ key: "k", value: "v" }]); // Should not throw
});

Deno.test("ApiCacheBackend setBatch returns for empty entries", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  await cache.setBatch([]); // Should not throw
});

Deno.test("ApiCacheBackend uses custom keyPrefix", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  // Just verify it can be constructed with a prefix
  const cache = new ApiCacheBackend({ keyPrefix: "custom-prefix" });
  assertExists(cache);
  assertEquals(cache.type, "api");
});

Deno.test("RedisCacheBackend type property", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  assertEquals(cache.type, "redis");
});

Deno.test("RedisCacheBackend returns null without client", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  assertEquals(await cache.get("any-key"), null);
});

Deno.test("RedisCacheBackend set is no-op without client", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  await cache.set("key", "value"); // Should not throw
});

Deno.test("RedisCacheBackend del is no-op without client", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  await cache.del("key"); // Should not throw
});

Deno.test("RedisCacheBackend delByPattern returns 0 without client", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  assertEquals(await cache.delByPattern("*"), 0);
});

Deno.test("RedisCacheBackend getBatch returns nulls without client", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  const results = await cache.getBatch(["k1", "k2"]);
  assertEquals(results.get("k1"), null);
  assertEquals(results.get("k2"), null);
});

Deno.test("RedisCacheBackend getBatch returns empty map for empty keys", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  const results = await cache.getBatch([]);
  assertEquals(results.size, 0);
});

Deno.test("RedisCacheBackend setBatch is no-op without client", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  await cache.setBatch([{ key: "k", value: "v" }]); // Should not throw
});

Deno.test("RedisCacheBackend setBatch is no-op for empty entries", async () => {
  const { RedisCacheBackend } = await import("./backend.ts");

  const cache = new RedisCacheBackend();
  await cache.setBatch([]); // Should not throw
});

Deno.test("CacheBackends factory functions exist", async () => {
  const { CacheBackends } = await import("./backend.ts");

  assertEquals(typeof CacheBackends.transform, "function");
  assertEquals(typeof CacheBackends.file, "function");
  assertEquals(typeof CacheBackends.module, "function");
  assertEquals(typeof CacheBackends.render, "function");
  assertEquals(typeof CacheBackends.userKv, "function");
  assertEquals(typeof CacheBackends.httpModule, "function");
  assertEquals(typeof CacheBackends.ssrModule, "function");
  assertEquals(typeof CacheBackends.projectCSS, "function");
});

Deno.test("http-cache.ts can import CacheBackends without circular dependency", async () => {
  const { CacheBackends, createCacheBackend } = await import("./backend.ts");

  assertExists(CacheBackends);
  assertExists(createCacheBackend);

  const backend = await createCacheBackend({ preferredBackend: "memory" });
  assertEquals(backend.type, "memory");
});

Deno.test({
  name: "isDistributedBackend correctly identifies backend types",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { isDistributedBackend, MemoryCacheBackend, RedisCacheBackend, ApiCacheBackend } =
      await import("./backend.ts");

    assertEquals(isDistributedBackend(new MemoryCacheBackend()), false);
    assertEquals(isDistributedBackend(new RedisCacheBackend()), true);
    assertEquals(isDistributedBackend(new ApiCacheBackend({})), true);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor returns null for memory-only backend",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, MemoryCacheBackend } = await import("./backend.ts");

    const accessor = createDistributedCacheAccessor(
      () => Promise.resolve(new MemoryCacheBackend()),
      "test",
    );

    const result = await accessor();
    assertEquals(result, null);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor caches the result",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, MemoryCacheBackend } = await import("./backend.ts");

    let callCount = 0;
    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        return Promise.resolve(new MemoryCacheBackend());
      },
      "test",
    );

    await accessor();
    await accessor();
    // Factory called once, result cached
    assertEquals(callCount, 1);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor handles factory errors gracefully",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor } = await import("./backend.ts");

    const accessor = createDistributedCacheAccessor(
      () => {
        return Promise.reject(new Error("Init failed"));
      },
      "test-fail",
    );

    const result = await accessor();
    assertEquals(result, null);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor retries after failure when enough time has passed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, ApiCacheBackend } = await import("./backend.ts");

    let callCount = 0;
    const apiBackend = new ApiCacheBackend({});

    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Init failed"));
        }
        return Promise.resolve(apiBackend);
      },
      "test-retry",
    );

    // First call fails
    const result1 = await accessor();
    assertEquals(result1, null);
    assertEquals(callCount, 1);

    // Immediate second call returns cached null (no retry yet)
    const result2 = await accessor();
    assertEquals(result2, null);
    assertEquals(callCount, 1);

    // Simulate time passing by manipulating the internal state via a fresh accessor
    // We test the retry mechanism by creating a new accessor with a patched Date.now
    const originalDateNow = Date.now;
    try {
      // Advance time by 31 seconds
      Date.now = () => originalDateNow() + 31_000;

      // Now it should retry since enough time has passed
      const result3 = await accessor();
      assertEquals(result3, apiBackend);
      assertEquals(callCount, 2);
    } finally {
      Date.now = originalDateNow;
    }
  },
});

Deno.test({
  name: "createDistributedCacheAccessor does not retry for memory-only backend",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, MemoryCacheBackend } = await import("./backend.ts");

    let callCount = 0;
    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        return Promise.resolve(new MemoryCacheBackend());
      },
      "test-no-retry-memory",
    );

    const result1 = await accessor();
    assertEquals(result1, null);
    assertEquals(callCount, 1);

    // Even after time passes, memory-only result should not retry
    const originalDateNow = Date.now;
    try {
      Date.now = () => originalDateNow() + 60_000;
      const result2 = await accessor();
      assertEquals(result2, null);
      assertEquals(callCount, 1);
    } finally {
      Date.now = originalDateNow;
    }
  },
});

Deno.test({
  name: "createCacheBackend creates memory backend when preferred",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createCacheBackend } = await import("./backend.ts");

    const backend = await createCacheBackend({
      preferredBackend: "memory",
      memoryMaxEntries: 100,
    });

    assertEquals(backend.type, "memory");
  },
});

Deno.test({
  name: "createCacheBackend creates API backend when preferred",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createCacheBackend } = await import("./backend.ts");

    const backend = await createCacheBackend({ preferredBackend: "api" });
    assertEquals(backend.type, "api");
  },
});
