/**
 * Cache Backend Tests
 *
 * @module cache/backend.test
 */

import { assertEquals, assertExists } from "@std/assert";

/**
 * Test that backend.ts can be imported without circular dependency errors.
 * This was broken when http-cache.ts imported from backend.ts because
 * backend.ts had a static import from multi-project-adapter.ts which
 * has React dependencies.
 *
 * The fix: lazy-load getCurrentRequestContext via dynamic import.
 */
Deno.test({
  name: "backend.ts imports without circular dependency",
  // Circuit breaker uses intervals for state tracking
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // This import would fail with "Cannot access 'React' before initialization"
    // if the circular dependency was not fixed
    const mod = await import("./backend.ts");

    // Verify key exports exist
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

  // Set and get
  await cache.set("key1", "value1", 60);
  const value = await cache.get("key1");
  assertEquals(value, "value1");

  // Delete
  await cache.del("key1");
  const deleted = await cache.get("key1");
  assertEquals(deleted, null);

  // Size tracking
  await cache.set("a", "1");
  await cache.set("b", "2");
  assertEquals(cache.size, 2);

  // Clear
  cache.clear();
  assertEquals(cache.size, 0);
});

Deno.test("MemoryCacheBackend TTL expiration", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(10);

  // Set with 1 second TTL
  await cache.set("expires", "soon", 1);

  // Should exist immediately
  const before = await cache.get("expires");
  assertEquals(before, "soon");

  // Wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // Should be gone
  const after = await cache.get("expires");
  assertEquals(after, null);
});

Deno.test("MemoryCacheBackend evicts oldest on capacity", async () => {
  const { MemoryCacheBackend } = await import("./backend.ts");

  const cache = new MemoryCacheBackend(3);

  await cache.set("a", "1");
  await cache.set("b", "2");
  await cache.set("c", "3");
  assertEquals(cache.size, 3);

  // Adding 4th should evict oldest (a)
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

  const deleted = await cache.delByPattern("http:*");
  assertEquals(deleted, 2);
  assertEquals(await cache.get("http:mod1"), null);
  assertEquals(await cache.get("http:mod2"), null);
  assertEquals(await cache.get("other:key"), "v3");
});

Deno.test("ApiCacheBackend requires auth and project context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  // Create backend without env (no token/project)
  const cache = new ApiCacheBackend({});

  // Should return null without auth context
  const value = await cache.get("test-key");
  assertEquals(value, null);
});

Deno.test("CacheBackends factory functions exist", async () => {
  const { CacheBackends } = await import("./backend.ts");

  // Verify all expected cache types are available
  assertEquals(typeof CacheBackends.transform, "function");
  assertEquals(typeof CacheBackends.file, "function");
  assertEquals(typeof CacheBackends.module, "function");
  assertEquals(typeof CacheBackends.render, "function");
  assertEquals(typeof CacheBackends.userKv, "function");
  assertEquals(typeof CacheBackends.httpModule, "function");
});

/**
 * Critical test: Verify http-cache.ts can import from backend.ts
 * This is the exact import that caused the circular dependency issue.
 */
Deno.test("http-cache.ts can import CacheBackends without circular dependency", async () => {
  // Simulate what http-cache.ts would do
  const { CacheBackends, createCacheBackend } = await import("./backend.ts");

  assertExists(CacheBackends);
  assertExists(createCacheBackend);

  // Create a memory backend (doesn't require external services)
  const backend = await createCacheBackend({ preferredBackend: "memory" });
  assertEquals(backend.type, "memory");
});
