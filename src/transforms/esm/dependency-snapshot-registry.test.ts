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
  it("coalesces concurrent metadata history reads by source before selecting a key", async () => {
    const registry = new DependencySnapshotRegistry();
    const first = snapshot({ react: "18.3.1" });
    const second = snapshot({ react: "19.2.4" });
    const healthy = snapshot({ zod: "4.0.0" });
    const expiresAt = Date.now() + 60_000;
    let reads = 0;
    let resolveHistory!: (
      history: ReadonlyArray<{ snapshot: ReturnType<typeof snapshot>; expiresAt: number }>,
    ) => void;
    const history = new Promise<
      ReadonlyArray<{ snapshot: ReturnType<typeof snapshot>; expiresAt: number }>
    >((resolve) => resolveHistory = resolve);
    const load = () => {
      reads++;
      return history.then((value) => ({ value, bytes: 100 }));
    };
    const select = (
      records: ReadonlyArray<{ snapshot: ReturnType<typeof snapshot>; expiresAt: number }>,
      key: string,
    ) => records.find((record) => record.snapshot.cacheKey === key);

    const requestedKeys = [
      first.cacheKey,
      second.cacheKey,
      ...Array.from({ length: 62 }, (_, index) => `on:forged-${index}`),
    ];
    const sourceReads = requestedKeys.map((key) =>
      registry.recoverHistorical(
        "source",
        key,
        load,
        (records) => select(records, key),
      )
    );
    await Promise.resolve();
    assertEquals(reads, 1);
    assertEquals(
      await registry.recoverHistorical(
        "healthy-source",
        healthy.cacheKey,
        () => Promise.resolve({ value: { snapshot: healthy, expiresAt }, bytes: 100 }),
        (record) => record,
      ),
      healthy,
    );
    resolveHistory([{ snapshot: first, expiresAt }, { snapshot: second, expiresAt }]);

    const recovered = await Promise.all(sourceReads);
    assertEquals(recovered[0], first);
    assertEquals(recovered[1], second);
    assertEquals(recovered.slice(2), Array(62).fill(undefined));
  });
  it("caches settled source history across distinct misses and retains valid keys", async () => {
    const registry = new DependencySnapshotRegistry();
    const original = snapshot();
    const record = { snapshot: original, expiresAt: Date.now() + 60_000 };
    let reads = 0;
    const load = () => {
      reads++;
      return Promise.resolve({ value: record, bytes: 100 });
    };
    for (let index = 0; index < 64; index++) {
      assertEquals(
        await registry.recoverHistorical("source", `on:missing-${index}`, load, () => undefined),
        undefined,
      );
    }
    assertEquals(
      await registry.recoverHistorical("source", original.cacheKey, load, (loaded) => loaded),
      original,
    );
    assertEquals(reads, 1);
  });

  it("refreshes cached history after revision changes, expiry, and clear", async () => {
    let now = 1000;
    const registry = new DependencySnapshotRegistry({ now: () => now });
    let reads = 0;
    const load = () => {
      reads++;
      return Promise.resolve({ value: null, bytes: 100 });
    };
    const read = (revision = "before") =>
      registry.recoverHistorical("source", "on:missing", load, () => undefined, revision);
    await read();
    await read();
    assertEquals(reads, 1);
    await read("after");
    assertEquals(reads, 2);
    now += 999;
    await read("after");
    assertEquals(reads, 2);
    now++;
    await read("after");
    assertEquals(reads, 3);
    registry.clear();
    await read("after");
    assertEquals(reads, 4);
  });

  it("never extends a snapshot expiry through cached metadata", async () => {
    let now = 1000;
    const registry = new DependencySnapshotRegistry({ now: () => now });
    const original = snapshot();
    let reads = 0;
    const load = () => {
      reads++;
      return Promise.resolve({ value: { snapshot: original, expiresAt: 1500 }, bytes: 100 });
    };
    const read = () =>
      registry.recoverHistorical("source", original.cacheKey, load, (value) => value);
    assertEquals(await read(), original);
    now = 1500;
    assertEquals(await read(), undefined);
    assertEquals(reads, 1);
  });

  for (const limits of [{ maxEntries: 1 }, { maxBytes: 150 }]) {
    it("bounds settled metadata retention by source count and byte budget", async () => {
      const registry = new DependencySnapshotRegistry(limits);
      let reads = 0;
      const load = () => {
        reads++;
        return Promise.resolve({ value: null, bytes: 100 });
      };
      const read = (source: string) =>
        registry.recoverHistorical(source, "on:missing", load, () => undefined);
      await read("first");
      await read("second");
      await read("first");
      assertEquals(reads, 3);
    });
  }

  it("rejects unbounded metadata before retaining it", async () => {
    const registry = new DependencySnapshotRegistry();
    for (const bytes of [0, -1, 1.5, Number.NaN, 1024 * 1024 + 1]) {
      await assertRejects(() =>
        registry.recoverHistorical(
          "source",
          "on:missing",
          () => Promise.resolve({ value: null, bytes }),
          () => undefined,
        )
      );
    }
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
  it("aborts cooperative metadata reads and releases every admission slot", async () => {
    const registry = new DependencySnapshotRegistry({ timeoutMs: 20 });
    const original = snapshot();
    let aborted = 0;
    await Promise.all(
      Array.from(
        { length: 64 },
        (_, index) =>
          assertRejects(() =>
            registry.recoverHistorical(
              `source-${index}`,
              original.cacheKey,
              (signal) =>
                new Promise((_resolve, reject) => {
                  signal.addEventListener("abort", () => {
                    aborted++;
                    reject(signal.reason);
                  }, { once: true });
                }),
              () => undefined,
            )
          ),
      ),
    );
    assertEquals(aborted, 64);
    assertEquals(
      await registry.recoverHistorical(
        "healthy",
        original.cacheKey,
        () =>
          Promise.resolve({
            value: { snapshot: original, expiresAt: Date.now() + 10_000 },
            bytes: 100,
          }),
        (record) => record,
      ),
      original,
    );
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
