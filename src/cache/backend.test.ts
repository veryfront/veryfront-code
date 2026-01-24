/**
 * Cache Backend Tests
 *
 * @module cache/backend.test
 */

import { assertEquals, assertExists } from "@std/assert";

Deno.test({
  name: "backend.ts imports without circular dependency",
  // Circuit breaker uses intervals for state tracking
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

Deno.test("ApiCacheBackend requires auth and project context", async () => {
  const { ApiCacheBackend } = await import("./backend.ts");

  const cache = new ApiCacheBackend({});
  assertEquals(await cache.get("test-key"), null);
});

Deno.test("CacheBackends factory functions exist", async () => {
  const { CacheBackends } = await import("./backend.ts");

  assertEquals(typeof CacheBackends.transform, "function");
  assertEquals(typeof CacheBackends.file, "function");
  assertEquals(typeof CacheBackends.module, "function");
  assertEquals(typeof CacheBackends.render, "function");
  assertEquals(typeof CacheBackends.userKv, "function");
  assertEquals(typeof CacheBackends.httpModule, "function");
});

Deno.test("http-cache.ts can import CacheBackends without circular dependency", async () => {
  const { CacheBackends, createCacheBackend } = await import("./backend.ts");

  assertExists(CacheBackends);
  assertExists(createCacheBackend);

  const backend = await createCacheBackend({ preferredBackend: "memory" });
  assertEquals(backend.type, "memory");
});
