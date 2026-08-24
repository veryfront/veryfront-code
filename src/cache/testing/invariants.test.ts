import "#veryfront/schemas/_test-setup.ts";
import { assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import {
  type MinimalCache,
  runCacheInvariantTests,
  testConcurrentAccess,
  testKeyCollisionResistance,
  testMemoryBounds,
} from "./invariants.ts";

// Date.now() alone repeats within a millisecond, which would blunt every
// per-key equality assertion in the shared invariants.
let valueSequence = 0;
function uniqueValue(prefix: string): string {
  valueSequence++;
  return `${prefix}-${valueSequence}`;
}

// Collect the steps an invariant helper would register without running them.
function collectSteps(): {
  steps: Array<{ name: string; fn: () => Promise<void> }>;
  context: Deno.TestContext;
} {
  const steps: Array<{ name: string; fn: () => Promise<void> }> = [];
  const context = {
    step: (name: string, fn: () => Promise<void>) => {
      steps.push({ name, fn });
      return Promise.resolve(true);
    },
  } as unknown as Deno.TestContext;
  return { steps, context };
}

function findStep(
  steps: Array<{ name: string; fn: () => Promise<void> }>,
  fragment: string,
): { name: string; fn: () => Promise<void> } {
  const step = steps.find((candidate) => candidate.name.includes(fragment));
  assertExists(step, `invariant helper must register a "${fragment}" step`);
  return step;
}

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
    createValue: () => uniqueValue("value"),
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
    createValue: () => uniqueValue("value"),
    name: "SimpleCache",
  });
});

Deno.test("cache/testing/invariants - testConcurrentAccess", async (t) => {
  await testConcurrentAccess(t, {
    createCache: () => new SimpleCache(),
    createValue: () => uniqueValue("concurrent"),
    name: "SimpleCache",
  });
});

Deno.test("cache/testing/invariants - testMemoryBounds", async (t) => {
  await testMemoryBounds(t, {
    createCache: () => new SimpleCache(10),
    createValue: () => uniqueValue("bounded"),
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

  const { steps, context } = collectSteps();
  await runCacheInvariantTests(context, {
    createCache: () => buggyCache,
    createValue: () => "value",
    skipTtlTests: true,
  });

  const setThenGet = findStep(steps, "set then get");
  await assertRejects(
    () => setThenGet.fn(),
    Error,
    undefined,
    "invariants must reject a cache that loses values",
  );
});

// The null cache above only proves the assertExists half fires. A cache that
// returns a foreign value is what pins the value-equality half.
Deno.test("cache/testing/invariants - detects a cache returning a foreign value", async () => {
  const wrongValueCache: MinimalCache<string> = {
    get: () => "other",
    set: () => {},
  };

  const { steps, context } = collectSteps();
  await runCacheInvariantTests(context, {
    createCache: () => wrongValueCache,
    createValue: () => "value",
    skipTtlTests: true,
  });

  await assertRejects(
    () => findStep(steps, "set then get").fn(),
    Error,
    "get must return the value that was set",
    "invariants must reject a cache that returns a foreign value",
  );
  await assertRejects(
    () => findStep(steps, "overwrite replaces previous value").fn(),
    Error,
    "overwrite must replace the previous value",
    "invariants must reject a cache that never replaces the previous value",
  );
});

// A cache that funnels every key into one slot must not pass the
// collision-resistance or concurrency invariants.
function singleSlotCache(): MinimalCache<string> {
  let latest: string | null = null;
  return {
    get: () => latest,
    set: (_key: string, value: string) => {
      latest = value;
    },
  };
}

Deno.test("cache/testing/invariants - detects an aliasing cache", async () => {
  const aliasingCache = singleSlotCache();

  const { steps, context } = collectSteps();
  await testKeyCollisionResistance(context, {
    createCache: () => aliasingCache,
    createValue: () => uniqueValue("aliasing"),
  });

  await assertRejects(
    () => findStep(steps, "similar keys are distinct").fn(),
    Error,
    "must return its own value",
    "invariants must reject a cache in which similar keys alias one slot",
  );
});

Deno.test("cache/testing/invariants - detects concurrent writes sharing one slot", async () => {
  const sharedSlotCache = singleSlotCache();

  const { steps, context } = collectSteps();
  await testConcurrentAccess(context, {
    createCache: () => sharedSlotCache,
    createValue: () => uniqueValue("shared"),
  });

  await assertRejects(
    () => findStep(steps, "concurrent sets don't corrupt data").fn(),
    Error,
    "must round-trip its own value",
    "invariants must reject a cache whose concurrent writes share one slot",
  );
});

// A cache that stores an envelope reconstructs an equivalent — not structurally
// identical — value, and declares that through `isEqual`. The concurrent
// invariant must honor the comparator exactly as the sequential and
// collision invariants do, rather than demanding structural identity.
Deno.test("cache/testing/invariants - honors isEqual under concurrency", async () => {
  type Entry = { id: string; revision?: number };

  const envelopeCache = (): MinimalCache<Entry> => {
    const store = new Map<string, Entry>();
    return {
      get: (key: string) => {
        const stored = store.get(key);
        return stored ? { id: stored.id, revision: 1 } : null;
      },
      set: (key: string, value: Entry) => {
        store.set(key, { id: value.id });
      },
    };
  };

  const { steps, context } = collectSteps();
  await testConcurrentAccess<Entry>(context, {
    createCache: envelopeCache,
    createValue: () => ({ id: uniqueValue("envelope") }),
    isEqual: (a, b) => a.id === b.id,
  });

  // Runs clean: a structural comparison would reject the added `revision`.
  await findStep(steps, "concurrent sets don't corrupt data").fn();
});
