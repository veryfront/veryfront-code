/**
 * Additional coverage tests for MultiTierCache.
 *
 * Focuses on the backfill TTL-preservation path (getRemainingTtlSeconds),
 * the remaining-TTL <= 0 early-exit that prevents resurrections, and
 * explicit TTL propagation through set().
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type CacheTier, MultiTierCache } from "./multi-tier.ts";

/**
 * Mock tier that records the TTL received in each set() call and optionally
 * implements getRemainingTtlSeconds so backfill TTL-preservation can be tested.
 */
function createCapturingTier(
  name: string,
  opts: {
    remainingTtl?: number | null;
    throwOnRemainingTtl?: boolean;
  } = {},
): CacheTier<string> & {
  store: Map<string, string>;
  setTtls: Map<string, number | undefined>;
} {
  const store = new Map<string, string>();
  const setTtls = new Map<string, number | undefined>();

  const tier: CacheTier<string> & {
    store: Map<string, string>;
    setTtls: Map<string, number | undefined>;
  } = {
    name,
    store,
    setTtls,
    get(key: string) {
      return Promise.resolve(store.get(key) ?? null);
    },
    set(key: string, value: string, ttl?: number) {
      store.set(key, value);
      setTtls.set(key, ttl);
      return Promise.resolve();
    },
    delete(key: string) {
      store.delete(key);
      return Promise.resolve();
    },
  };

  // Only attach getRemainingTtlSeconds when the caller passed remainingTtl or
  // throwOnRemainingTtl — otherwise the tier correctly has no such method.
  if ("remainingTtl" in opts || opts.throwOnRemainingTtl) {
    tier.getRemainingTtlSeconds = (_key: string) => {
      if (opts.throwOnRemainingTtl) {
        return Promise.reject(new Error("TTL lookup failed (test)"));
      }
      return Promise.resolve(opts.remainingTtl ?? null);
    };
  }

  return tier;
}

describe("MultiTierCache - backfill TTL preservation", () => {
  it("backfill to L1 uses source L3 remaining TTL rather than defaultTtlSeconds", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3", { remainingTtl: 30 });
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 300,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.store.get("key"), "value");
    // Must be 30 (source remaining TTL), not 300 (default)
    assertEquals(l1.setTtls.get("key"), 30);
  });

  it("caps backfill TTL at defaultTtlSeconds when remaining exceeds it", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3", { remainingTtl: 9_999 });
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 60,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.setTtls.get("key"), 60);
  });

  it("skips backfill entirely when source remaining TTL is 0", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3", { remainingTtl: 0 });
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 300,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    // Backfill must be skipped — no entry written to L1
    assertEquals(l1.store.has("key"), false);
  });

  it("skips backfill when source remaining TTL is negative", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3", { remainingTtl: -5 });
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 300,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.store.has("key"), false);
  });

  it("skips backfill when getRemainingTtlSeconds throws", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3", { throwOnRemainingTtl: true });
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 120,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.store.has("key"), false);
    assertEquals(l1.setTtls.has("key"), false);
  });

  it("falls back to defaultTtlSeconds when source tier has no getRemainingTtlSeconds", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3"); // no getRemainingTtlSeconds
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 90,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.store.get("key"), "value");
    assertEquals(l1.setTtls.get("key"), 90);
  });

  it("skips backfill when getRemainingTtlSeconds returns null", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3", { remainingTtl: null });
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 150,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.store.has("key"), false);
    assertEquals(l1.setTtls.has("key"), false);
  });

  it("preserves source remaining TTL when backfilling from L2 to L1", async () => {
    const l1 = createCapturingTier("l1");
    const l2 = createCapturingTier("l2", { remainingTtl: 45 });
    l2.store.set("key", "v2");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l2,
      defaultTtlSeconds: 300,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(l1.store.get("key"), "v2");
    assertEquals(l1.setTtls.get("key"), 45);
  });

  it("increments backfill stat counter on L3 hit", async () => {
    const l1 = createCapturingTier("l1");
    const l2 = createCapturingTier("l2");
    const l3 = createCapturingTier("l3");
    l3.store.set("key", "value");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l2,
      l3,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    await cache.get("key");

    assertEquals(cache.getStats().backfills, 1);
  });

  it("does not let an older read backfill over a newer write", async () => {
    let resolveTtl!: (value: number) => void;
    let markTtlStarted!: () => void;
    const ttl = new Promise<number>((resolve) => {
      resolveTtl = resolve;
    });
    const ttlStarted = new Promise<void>((resolve) => {
      markTtlStarted = resolve;
    });
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3");
    l3.store.set("key", "old");
    l3.getRemainingTtlSeconds = () => {
      markTtlStarted();
      return ttl;
    };
    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      asyncBackfill: false,
      backfillOnHit: true,
    });

    const staleRead = cache.get("key");
    await ttlStarted;
    await cache.set("key", "new");
    resolveTtl(60);
    assertEquals(await staleRead, "old");

    assertEquals(l1.store.get("key"), "new");
  });
});

describe("MultiTierCache - set() TTL propagation", () => {
  it("explicit TTL is passed to all tiers", async () => {
    const l1 = createCapturingTier("l1");
    const l3 = createCapturingTier("l3");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      l3,
      defaultTtlSeconds: 300,
      asyncBackfill: false,
    });

    await cache.set("key", "value", 42);

    assertEquals(l1.setTtls.get("key"), 42);
    assertEquals(l3.setTtls.get("key"), 42);
  });

  it("defaultTtlSeconds is used when no explicit TTL passed to set()", async () => {
    const l1 = createCapturingTier("l1");

    const cache = new MultiTierCache({
      name: "test",
      l1,
      defaultTtlSeconds: 77,
      asyncBackfill: false,
    });

    await cache.set("key", "value");

    assertEquals(l1.setTtls.get("key"), 77);
  });
});
