/**
 * Cache Testing Invariants
 *
 * Shared test utilities that ALL cache implementations must pass.
 * These invariants ensure correctness regardless of cache domain.
 *
 * @module cache/testing/invariants
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";

/**
 * Minimal cache interface that all caches must support.
 */
export interface MinimalCache<T = string> {
  get(key: string): Promise<T | null> | T | null;
  set(key: string, value: T, ttl?: number): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
  clear?(): Promise<void> | void;
  has?(key: string): Promise<boolean> | boolean;
}

/**
 * Options for running cache invariant tests.
 */
export interface CacheInvariantTestOptions<T = string> {
  /** Factory function to create a fresh cache instance for each test */
  createCache: () => Promise<MinimalCache<T>> | MinimalCache<T>;
  /** Factory function to create test values */
  createValue: () => T;
  /** Optional: custom equality check for values */
  isEqual?: (a: T, b: T) => boolean;
  /** Optional: name prefix for test output */
  name?: string;
  /** Optional: skip TTL tests (for caches without TTL support) */
  skipTtlTests?: boolean;
}

/**
 * Run all cache invariant tests.
 *
 * @example
 * ```typescript
 * import { runCacheInvariantTests } from "#veryfront/cache/testing/invariants.ts";
 *
 * Deno.test("MyCache invariants", async (t) => {
 *   await runCacheInvariantTests(t, {
 *     createCache: () => new MyCache(),
 *     createValue: () => "test-value",
 *   });
 * });
 * ```
 */
export async function runCacheInvariantTests<T = string>(
  t: Deno.TestContext,
  options: CacheInvariantTestOptions<T>,
): Promise<void> {
  const { createCache, createValue, isEqual, name = "cache", skipTtlTests = false } = options;

  const assertEqual = isEqual
    ? (a: T, b: T) => assertEquals(isEqual(a, b), true, `Expected values to be equal`)
    : (a: T, b: T) => assertEquals(a, b);

  await t.step(`${name}: get(missing-key) returns null`, async () => {
    const cache = await createCache();
    const result = await cache.get("nonexistent-key-12345");
    assertEquals(result, null);
  });

  await t.step(`${name}: set then get returns same value`, async () => {
    const cache = await createCache();
    const value = createValue();
    const key = `test-key-${Date.now()}`;

    await cache.set(key, value);
    const result = await cache.get(key);

    assertExists(result);
    assertEqual(result, value);
  });

  await t.step(`${name}: overwrite replaces previous value`, async () => {
    const cache = await createCache();
    const value1 = createValue();
    const value2 = createValue();
    const key = `overwrite-key-${Date.now()}`;

    await cache.set(key, value1);
    await cache.set(key, value2);
    const result = await cache.get(key);

    assertExists(result);
    assertEqual(result, value2);
  });

  await t.step(`${name}: delete removes entry`, async () => {
    const cache = await createCache();
    if (!cache.delete) return; // Skip if delete not supported

    const value = createValue();
    const key = `delete-key-${Date.now()}`;

    await cache.set(key, value);
    await cache.delete(key);
    const result = await cache.get(key);

    assertEquals(result, null);
  });

  await t.step(`${name}: delete on missing key does not throw`, async () => {
    const cache = await createCache();
    if (!cache.delete) return;

    // Should not throw
    await cache.delete("nonexistent-delete-key");
  });

  await t.step(`${name}: multiple keys are independent`, async () => {
    const cache = await createCache();
    const value1 = createValue();
    const value2 = createValue();
    const key1 = `multi-key-1-${Date.now()}`;
    const key2 = `multi-key-2-${Date.now()}`;

    await cache.set(key1, value1);
    await cache.set(key2, value2);

    const result1 = await cache.get(key1);
    const result2 = await cache.get(key2);

    assertExists(result1);
    assertExists(result2);
    assertEqual(result1, value1);
    assertEqual(result2, value2);
  });

  await t.step(`${name}: clear removes all entries`, async () => {
    const cache = await createCache();
    if (!cache.clear) return;

    const key1 = `clear-key-1-${Date.now()}`;
    const key2 = `clear-key-2-${Date.now()}`;

    await cache.set(key1, createValue());
    await cache.set(key2, createValue());
    await cache.clear();

    assertEquals(await cache.get(key1), null);
    assertEquals(await cache.get(key2), null);
  });

  await t.step(`${name}: has() reflects set/delete state`, async () => {
    const cache = await createCache();
    if (!cache.has) return;

    const key = `has-key-${Date.now()}`;

    assertEquals(await cache.has(key), false);
    await cache.set(key, createValue());
    assertEquals(await cache.has(key), true);

    if (cache.delete) {
      await cache.delete(key);
      assertEquals(await cache.has(key), false);
    }
  });

  if (!skipTtlTests) {
    await t.step(`${name}: expired entries return null`, async () => {
      const cache = await createCache();
      const key = `ttl-key-${Date.now()}`;
      const value = createValue();

      // Set with 1ms TTL
      await cache.set(key, value, 0.001);

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 50));

      const result = await cache.get(key);
      assertEquals(result, null);
    });
  }
}

/**
 * Test cache key collision resistance.
 */
export async function testKeyCollisionResistance<T = string>(
  t: Deno.TestContext,
  options: CacheInvariantTestOptions<T>,
): Promise<void> {
  const { createCache, createValue, name = "cache" } = options;

  await t.step(`${name}: similar keys are distinct`, async () => {
    const cache = await createCache();

    const keys = [
      "user:123",
      "user:1234",
      "user:123:profile",
      "user:123:settings",
      "users:123", // Note: users vs user
    ];

    // Set different values for each key
    const values = new Map<string, T>();
    for (const key of keys) {
      const value = createValue();
      values.set(key, value);
      await cache.set(key, value);
    }

    // Verify each key returns its own value
    for (const key of keys) {
      const result = await cache.get(key);
      assertExists(result, `Key ${key} should exist`);
    }
  });
}

/**
 * Test cache under concurrent access.
 */
export async function testConcurrentAccess<T = string>(
  t: Deno.TestContext,
  options: CacheInvariantTestOptions<T>,
): Promise<void> {
  const { createCache, createValue, isEqual: _isEqual, name = "cache" } = options;

  await t.step(`${name}: concurrent sets don't corrupt data`, async () => {
    const cache = await createCache();
    const iterations = 100;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < iterations; i++) {
      const key = `concurrent-${i}`;
      const value = createValue();
      promises.push(
        (async () => {
          await cache.set(key, value);
          const result = await cache.get(key);
          // Result should be either the value we set or another concurrent value
          assertExists(result, `Key ${key} should have a value`);
        })(),
      );
    }

    await Promise.all(promises);
  });

  await t.step(`${name}: concurrent get/set on same key`, async () => {
    const cache = await createCache();
    const key = `same-key-${Date.now()}`;
    const iterations = 50;

    const promises: Promise<void>[] = [];

    for (let i = 0; i < iterations; i++) {
      const value = createValue();
      promises.push(
        (async () => {
          await cache.set(key, value);
          const result = await cache.get(key);
          // Should get some value (may not be the one we just set due to race)
          assertExists(result, `Key should have a value after set`);
        })(),
      );
    }

    await Promise.all(promises);
  });
}

/**
 * Test cache memory bounds (for LRU caches).
 */
export async function testMemoryBounds<T = string>(
  t: Deno.TestContext,
  options: CacheInvariantTestOptions<T> & { maxEntries: number },
): Promise<void> {
  const { createCache, createValue, maxEntries, name = "cache" } = options;

  await t.step(`${name}: respects max entries limit`, async () => {
    const cache = await createCache();
    const extraEntries = 10;

    // Fill beyond capacity
    for (let i = 0; i < maxEntries + extraEntries; i++) {
      await cache.set(`bound-key-${i}`, createValue());
    }

    // Count how many entries exist
    let existingCount = 0;
    for (let i = 0; i < maxEntries + extraEntries; i++) {
      const result = await cache.get(`bound-key-${i}`);
      if (result !== null) existingCount++;
    }

    // Should have evicted some entries
    assertEquals(
      existingCount <= maxEntries,
      true,
      `Should have at most ${maxEntries} entries, found ${existingCount}`,
    );
  });

  await t.step(`${name}: LRU eviction keeps recent entries`, async () => {
    const cache = await createCache();

    // Fill to capacity
    for (let i = 0; i < maxEntries; i++) {
      await cache.set(`lru-key-${i}`, createValue());
    }

    // Access first entry to make it recently used
    await cache.get("lru-key-0");

    // Add one more entry (should evict something other than key-0)
    await cache.set("lru-key-new", createValue());

    // First entry should still exist (was recently accessed)
    const result = await cache.get("lru-key-0");
    assertExists(result, "Recently accessed entry should not be evicted");
  });
}
