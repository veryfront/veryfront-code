import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DependencySnapshotRegistry } from "./dependency-snapshot-registry.ts";
import { createDependencyPinningSnapshot, hashDependencyPins } from "./dependency-snapshot.ts";
import type {
  DependencySnapshotRecord,
  DependencySnapshotStore,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";

function storeFixture() {
  const records = new Map<string, DependencySnapshotRecord>();
  const store: DependencySnapshotStore = {
    publish: (namespace, key, value, expiresAt) => {
      records.set(`${namespace}:${key}`, { value, expiresAt });
      return Promise.resolve();
    },
    read: (namespace, key) => Promise.resolve(records.get(`${namespace}:${key}`) ?? null),
  };
  return { store, records };
}
function snapshot(dependencies: Record<string, string> = {}) {
  return createDependencyPinningSnapshot(`on:${hashDependencyPins(dependencies)}`, dependencies);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

describe("dependency snapshot registry", () => {
  for (const skew of [-1000, 1000, 60000]) {
    it(`recovers fresh acknowledged history with ${skew}ms relative clock skew`, async () => {
      const { store } = storeFixture();
      const writerNow = 1_000_000;
      const writer = new DependencySnapshotRegistry({ store, now: () => writerNow });
      const original = snapshot();
      await writer.remember("source", original);
      const reader = new DependencySnapshotRegistry({ store, now: () => writerNow - skew });
      assertEquals(await reader.find("source", original.cacheKey), original);
    });
  }
  it("keeps the hard retention ceiling beyond the default clock reserve", async () => {
    const { store } = storeFixture();
    const writer = new DependencySnapshotRegistry({ store, now: () => 1_000_000 });
    const original = snapshot();
    await writer.remember("source", original);
    const reader = new DependencySnapshotRegistry({ store, now: () => 1_000_000 - 60001 });
    await assertRejects(() => reader.find("source", original.cacheKey));
  });
  it("never extends a coalesced publication beyond the first acknowledged deadline", async () => {
    let now = 1000;
    const entered = deferred(), release = deferred(), secondCapture = deferred();
    const registry = new DependencySnapshotRegistry({
      retentionMs: 100,
      now: () => {
        if (now === 1020) secondCapture.resolve();
        return now;
      },
      store: {
        publish: () => {
          entered.resolve();
          return release.promise;
        },
        read: () => Promise.resolve(null),
      },
    });
    const original = snapshot();
    const first = registry.remember("source", original);
    await entered.promise;
    now = 1020;
    const second = registry.remember("source", original);
    await secondCapture.promise;
    release.resolve();
    await Promise.all([first, second]);
    now = 1100;
    assertEquals(registry.peek("source", original.cacheKey), undefined);
  });
  it("recovers the original map in a cold registry after current dependencies change", async () => {
    const { store } = storeFixture();
    const warm = new DependencySnapshotRegistry({ store });
    const original = snapshot();
    await warm.remember("project-a:main", original);
    await warm.remember("project-a:main", snapshot({ react: "19.2.4" }));
    const cold = new DependencySnapshotRegistry({ store });
    assertEquals(await cold.find("project-a:main", original.cacheKey), original);
    assertEquals(cold.peek("project-a:main", original.cacheKey), original);
  });
  it("keeps snapshots private to the source namespace", async () => {
    const { store } = storeFixture();
    const a = new DependencySnapshotRegistry({ store });
    const original = snapshot();
    await a.remember("project-a:main", original);
    const b = new DependencySnapshotRegistry({ store });
    assertEquals(await b.find("project-b:main", original.cacheKey), undefined);
    assertEquals(await b.find("project-a:feature", original.cacheKey), undefined);
  });
  it("does not make a snapshot visible before publication acknowledges", async () => {
    const pending = deferred();
    const registry = new DependencySnapshotRegistry({
      store: { publish: () => pending.promise, read: () => Promise.resolve(null) },
    });
    const original = snapshot();
    const remembered = registry.remember("source", original);
    assertEquals(registry.peek("source", original.cacheKey), undefined);
    pending.resolve();
    await remembered;
    assertEquals(registry.peek("source", original.cacheKey), original);
  });
  it("leaves no local success after a rejected publication", async () => {
    const registry = new DependencySnapshotRegistry({
      store: {
        publish: () => Promise.reject(new Error("unavailable")),
        read: () => Promise.resolve(null),
      },
    });
    const original = snapshot();
    await assertRejects(() => registry.remember("source", original));
    assertEquals(registry.peek("source", original.cacheKey), undefined);
  });
  it("rejects malformed and oversized persisted records without caching them", async () => {
    for (const value of ['{"version":1}', "x".repeat(1024 * 1024 + 1)]) {
      const registry = new DependencySnapshotRegistry({
        store: {
          publish: () => Promise.resolve(),
          read: () => Promise.resolve({ value, expiresAt: Date.now() + 60000 }),
        },
      });
      await assertRejects(() => registry.find("source", snapshot().cacheKey));
      assertEquals(registry.peek("source", snapshot().cacheKey), undefined);
    }
  });
  it("rejects valid records transplanted from another namespace", async () => {
    const { store, records } = storeFixture();
    const original = snapshot();
    await new DependencySnapshotRegistry({ store }).remember("project-a", original);
    const stolen = [...records.values()][0]!;
    const cold = new DependencySnapshotRegistry({
      store: { publish: () => Promise.resolve(), read: () => Promise.resolve(stolen) },
    });
    await assertRejects(() => cold.find("project-b", original.cacheKey));
  });
  it("does not retain snapshots beyond their acknowledged expiry", async () => {
    let now = 1000;
    const { store } = storeFixture();
    const original = snapshot();
    const warm = new DependencySnapshotRegistry({ store, now: () => now, retentionMs: 100 });
    await warm.remember("source", original);
    now = 1100;
    assertEquals(warm.peek("source", original.cacheKey), undefined);
    const cold = new DependencySnapshotRegistry({ store, now: () => now });
    assertEquals(await cold.find("source", original.cacheKey), undefined);
  });
  it("bounds local history while retaining shared recovery", async () => {
    const { store } = storeFixture();
    const registry = new DependencySnapshotRegistry({ store, maxEntries: 1 });
    const a = snapshot(), b = snapshot({ react: "19.2.4" });
    await registry.remember("source", a);
    await registry.remember("source", b);
    assertEquals(registry.peek("source", a.cacheKey), undefined);
    assertExists(await registry.find("source", a.cacheKey));
    assertEquals(registry.peek("source", b.cacheKey), undefined);
  });
  it("supports store-less standalone operation", async () => {
    const registry = new DependencySnapshotRegistry();
    const original = snapshot();
    await registry.remember("source", original);
    assertEquals(await registry.find("source", original.cacheKey), original);
  });
  it("evicts by serialized byte budget, not just entry count", async () => {
    const registry = new DependencySnapshotRegistry({ maxBytes: 1024 });
    const a = snapshot({ alpha: "a".repeat(500) });
    const b = snapshot({ beta: "b".repeat(500) });
    await registry.remember("source", a);
    assertExists(registry.peek("source", a.cacheKey));
    await registry.remember("source", b);
    assertEquals(registry.peek("source", a.cacheKey), undefined);
    assertExists(registry.peek("source", b.cacheKey));
  });
  it("keeps timed-out producers counted until settlement and never publishes late local success", async () => {
    const release = deferred();
    let producers = 0;
    const registry = new DependencySnapshotRegistry({
      timeoutMs: 30,
      store: {
        publish: () => {
          producers++;
          return release.promise;
        },
        read: () => Promise.resolve(null),
      },
    });
    const original = snapshot();
    try {
      await Promise.all(
        Array.from(
          { length: 64 },
          (_, i) => assertRejects(() => registry.remember(`source-${i}`, original)),
        ),
      );
      assertEquals(producers, 64);
      await assertRejects(() => registry.remember("overflow", original));
      assertEquals(producers, 64);
      assertEquals(registry.peek("source-0", original.cacheKey), undefined);
    } finally {
      release.resolve();
    }
    // Allow producer cleanup to run before a new operation is admitted.
    await release.promise;
    await registry.remember("recovered", original);
    assertExists(registry.peek("recovered", original.cacheKey));
    assertEquals(registry.peek("source-0", original.cacheKey), undefined);
  });
});
