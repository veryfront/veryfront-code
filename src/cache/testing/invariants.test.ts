import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  type MinimalCache,
  runCacheInvariantTests,
  testConcurrentAccess,
  testKeyCollisionResistance,
  testMemoryBounds,
} from "./invariants.ts";

// Simple in-memory cache for testing the test utilities
class SimpleCache implements MinimalCache<string> {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private maxEntries: number;

  constructor(maxEntries: number = Infinity) {
    this.maxEntries = maxEntries;
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Move to end for LRU
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds: number = 300): void {
    // LRU eviction
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value as string;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }
}

// Simple cache without TTL for testing skipTtlTests
class SimpleCacheNoTTL implements MinimalCache<string> {
  private store = new Map<string, string>();

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

Deno.test("cache/testing/invariants - runCacheInvariantTests", async (t) => {
  await runCacheInvariantTests(t, {
    createCache: () => new SimpleCache(),
    createValue: () => `value-${Date.now()}-${Math.random()}`,
    name: "SimpleCache",
  });
});

Deno.test("cache/testing/invariants - async cache factory", async (t) => {
  await runCacheInvariantTests(t, {
    createCache: async () => {
      await new Promise((r) => setTimeout(r, 1)); // Simulate async init
      return new SimpleCache();
    },
    createValue: () => "async-value",
    name: "AsyncCache",
  });
});

Deno.test("cache/testing/invariants - skip TTL tests", async (t) => {
  await runCacheInvariantTests(t, {
    createCache: () => new SimpleCacheNoTTL(),
    createValue: () => "value",
    name: "NoTTLCache",
    skipTtlTests: true,
  });
});

Deno.test("cache/testing/invariants - testKeyCollisionResistance", async (t) => {
  await testKeyCollisionResistance(t, {
    createCache: () => new SimpleCache(),
    createValue: () => `value-${Date.now()}`,
    name: "SimpleCache",
  });
});

Deno.test("cache/testing/invariants - testConcurrentAccess", async (t) => {
  await testConcurrentAccess(t, {
    createCache: () => new SimpleCache(),
    createValue: () => `concurrent-${Date.now()}`,
    name: "SimpleCache",
  });
});

Deno.test("cache/testing/invariants - testMemoryBounds", async (t) => {
  await testMemoryBounds(t, {
    createCache: () => new SimpleCache(10),
    createValue: () => `bounded-${Date.now()}`,
    maxEntries: 10,
    name: "BoundedCache",
  });
});

// Verify that the invariant tests actually catch bugs
Deno.test("cache/testing/invariants - detects buggy cache", async () => {
  // Buggy cache that loses values
  const buggyCache: MinimalCache<string> = {
    get: () => null, // Always returns null!
    set: () => {},
  };

  let failed = false;
  try {
    // Create a mini test context
    const steps: Array<{ name: string; fn: () => Promise<void> }> = [];
    const mockContext = {
      step: async (name: string, fn: () => Promise<void>) => {
        steps.push({ name, fn });
      },
    } as unknown as Deno.TestContext;

    await runCacheInvariantTests(mockContext, {
      createCache: () => buggyCache,
      createValue: () => "value",
      skipTtlTests: true,
    });

    // Run the "set then get" test
    const setThenGet = steps.find((s) => s.name.includes("set then get"));
    if (setThenGet) {
      await setThenGet.fn();
    }
  } catch {
    failed = true;
  }

  assertEquals(failed, true, "Should detect buggy cache that loses values");
});
