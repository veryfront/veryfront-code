import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { createPipelineCache } from "./pipeline-cache.ts";

interface FakePipeline {
  id: string;
}

describe("provider/local/pipeline-cache", () => {
  it("disposes the least-recently-used pipeline on eviction and all entries on clear", async () => {
    const disposed: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => ({ id }),
      {
        maxEntries: 2,
        dispose: (pipeline) => {
          disposed.push(pipeline.id);
        },
      },
    );

    await cache.preload("a", "a");
    await cache.preload("b", "b");
    await cache.preload("a", "a"); // Refresh a, making b the LRU.
    await cache.preload("c", "c");

    assertEquals(disposed, ["b"]);
    assertEquals(cache.has("a"), true);
    assertEquals(cache.has("b"), false);
    assertEquals(cache.has("c"), true);

    await cache.clear();
    assertEquals(disposed, ["b", "a", "c"]);
  });

  it("defers disposal until the final active lease is released", async () => {
    const disposed: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => ({ id }),
      {
        maxEntries: 1,
        dispose: (pipeline) => {
          disposed.push(pipeline.id);
        },
      },
    );

    const first = await cache.acquire("a", "a");
    const second = await cache.acquire("a", "a");
    assertStrictEquals(first.value, second.value);

    const pendingB = cache.preload("b", "b");
    assertEquals(disposed, []);

    await first.release();
    assertEquals(disposed, []);
    await second.release();
    await pendingB;
    assertEquals(disposed, ["a"]);

    // Lease release is idempotent.
    await second.release();
    assertEquals(disposed, ["a"]);
    await cache.clear();
  });

  it("deduplicates concurrent loads and allows retry after failure", async () => {
    const gate = Promise.withResolvers<void>();
    let attempts = 0;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        attempts += 1;
        await gate.promise;
        if (attempts === 1) throw new Error("load failed");
        return { id };
      },
      { maxEntries: 1 },
    );

    const first = cache.preload("a", "a");
    const second = cache.preload("a", "a");
    gate.resolve();

    await assertRejects(() => first, Error, "load failed");
    await assertRejects(() => second, Error, "load failed");
    assertEquals(attempts, 1);

    await cache.preload("a", "a");
    assertEquals(attempts, 2);
    await cache.clear();
  });

  it("preload does not expose values that a concurrent eviction can dispose", async () => {
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => ({ id }),
      { maxEntries: 1 },
    );

    const results = await Promise.all([
      cache.preload("a", "a"),
      cache.preload("b", "b"),
    ]);
    assertEquals(results, [undefined, undefined]);
    await cache.clear();
  });

  it("releases a lease that finishes loading after its caller aborts", async () => {
    const gate = Promise.withResolvers<void>();
    const disposed: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        await gate.promise;
        return { id };
      },
      {
        maxEntries: 1,
        dispose: (pipeline) => {
          disposed.push(pipeline.id);
        },
      },
    );
    const abortController = new AbortController();
    const pending = cache.acquire("a", "a", abortController.signal);

    abortController.abort(new DOMException("cancelled", "AbortError"));
    await assertRejects(() => pending, DOMException, "cancelled");

    gate.resolve();
    await cache.preload("a", "a");
    await cache.preload("b", "b");
    assertEquals(disposed, ["a"]);
    await cache.clear();
  });

  it("does not reuse a stale load after its entry is evicted", async () => {
    const loadA = Promise.withResolvers<void>();
    const loadB = Promise.withResolvers<void>();
    const allowDispose = Promise.withResolvers<void>();
    const disposeStarted = Promise.withResolvers<void>();
    let aLoads = 0;

    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "a") {
          aLoads += 1;
          await loadA.promise;
        } else {
          await loadB.promise;
        }
        return { id };
      },
      {
        maxEntries: 1,
        dispose: async (pipeline) => {
          if (pipeline.id === "a" && aLoads === 1) {
            disposeStarted.resolve();
            await allowDispose.promise;
          }
        },
      },
    );

    const firstA = cache.preload("a", "a");
    const firstB = cache.preload("b", "b");
    loadA.resolve();
    loadB.resolve();
    await disposeStarted.promise;

    const lateA = cache.acquire("a", "a");
    allowDispose.resolve();
    const lease = await lateA;
    await Promise.all([firstA, firstB]);

    assertEquals(aLoads, 2);
    assertEquals(lease.value.id, "a");
    await lease.release();
    await cache.clear();
  });

  it("holds loads started during clear until the clear boundary completes", async () => {
    const loadA = Promise.withResolvers<void>();
    const loadB = Promise.withResolvers<void>();
    let bStarted = false;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "a") {
          await loadA.promise;
        } else {
          bStarted = true;
          await loadB.promise;
        }
        return { id };
      },
      { maxEntries: 2 },
    );

    const firstA = cache.preload("a", "a");
    const clearing = cache.clear();
    const nextB = cache.preload("b", "b");

    loadA.resolve();
    await firstA;
    await clearing;
    assertEquals(cache.has("a"), false);
    assertEquals(bStarted, false);

    loadB.resolve();
    await nextB;
    assertEquals(cache.has("b"), true);
    await cache.clear();
  });

  it("bounds simultaneous distinct cold loads", async () => {
    const releaseLoads = Promise.withResolvers<void>();
    const initialLoadsStarted = Promise.withResolvers<void>();
    let activeLoads = 0;
    let peakActiveLoads = 0;
    let totalLoads = 0;

    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        totalLoads += 1;
        activeLoads += 1;
        peakActiveLoads = Math.max(peakActiveLoads, activeLoads);
        if (totalLoads === 2) initialLoadsStarted.resolve();
        try {
          await releaseLoads.promise;
          return { id };
        } finally {
          activeLoads -= 1;
        }
      },
      { maxEntries: 2 },
    );

    const pending = ["a", "b", "c", "d", "e"].map((id) => cache.preload(id, id));
    await initialLoadsStarted.promise;
    await Promise.resolve();
    assertEquals(totalLoads, 2);

    releaseLoads.resolve();
    await Promise.all(pending);
    assertEquals(totalLoads, 5);
    assertEquals(peakActiveLoads, 2);

    await cache.clear();
  });

  it("waits for an active retired pipeline before loading its replacement", async () => {
    let bStarted = false;
    const disposed: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "b") bStarted = true;
        return { id };
      },
      {
        maxEntries: 1,
        dispose: (pipeline) => {
          disposed.push(pipeline.id);
        },
      },
    );

    const leaseA = await cache.acquire("a", "a");
    const pendingB = cache.acquire("b", "b");
    await Promise.resolve();
    assertEquals(bStarted, false);
    assertEquals(disposed, []);

    await leaseA.release();
    const leaseB = await pendingB;
    assertEquals(bStarted, true);
    assertEquals(disposed, ["a"]);

    await leaseB.release();
    await cache.clear();
  });

  it("skips an aborted cold load before starting the next queued model", async () => {
    let bStarted = false;
    let cStarted = false;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "b") bStarted = true;
        if (id === "c") cStarted = true;
        return { id };
      },
      { maxEntries: 1 },
    );

    const leaseA = await cache.acquire("a", "a");
    const abortController = new AbortController();
    const pendingB = cache.acquire("b", "b", abortController.signal);
    const pendingC = cache.acquire("c", "c");

    abortController.abort(new DOMException("cancelled", "AbortError"));
    await assertRejects(() => pendingB, DOMException, "cancelled");
    await leaseA.release();

    const leaseC = await pendingC;
    assertEquals(bStarted, false);
    assertEquals(cStarted, true);

    await leaseC.release();
    await cache.clear();
  });

  it("clear waits for an aborted admission to release its retired entry", async () => {
    let bStarted = false;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "b") bStarted = true;
        return { id };
      },
      { maxEntries: 1 },
    );

    const leaseA = await cache.acquire("a", "a");
    const abortController = new AbortController();
    const pendingB = cache.acquire("b", "b", abortController.signal);
    abortController.abort(new DOMException("cancelled", "AbortError"));
    await assertRejects(() => pendingB, DOMException, "cancelled");

    let cleared = false;
    const clearing = cache.clear().then(() => {
      cleared = true;
    });
    await Promise.resolve();
    assertEquals(cleared, false);

    await leaseA.release();
    await clearing;
    assertEquals(bStarted, false);
  });

  it("clear drains a queued load admitted after its first snapshot", async () => {
    const loadA = Promise.withResolvers<void>();
    const loadB = Promise.withResolvers<void>();
    const bStarted = Promise.withResolvers<void>();
    const bDisposeStarted = Promise.withResolvers<void>();
    const allowBDispose = Promise.withResolvers<void>();
    let cleared = false;

    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "a") {
          await loadA.promise;
        } else {
          bStarted.resolve();
          await loadB.promise;
        }
        return { id };
      },
      {
        maxEntries: 1,
        dispose: async (pipeline) => {
          if (pipeline.id === "b") {
            bDisposeStarted.resolve();
            await allowBDispose.promise;
          }
        },
      },
    );

    const firstA = cache.preload("a", "a");
    const abortController = new AbortController();
    const pendingB = cache.acquire("b", "b", abortController.signal);
    const clearing = cache.clear().then(() => {
      cleared = true;
    });

    loadA.resolve();
    await firstA;
    await bStarted.promise;
    abortController.abort(new DOMException("cancelled", "AbortError"));
    await assertRejects(() => pendingB, DOMException, "cancelled");
    loadB.resolve();
    await bDisposeStarted.promise;
    await Promise.resolve();
    assertEquals(cleared, false);

    allowBDispose.resolve();
    await clearing;
    assertEquals(cleared, true);
  });

  it("evicts an idle entry before waiting on an older active entry", async () => {
    const disposed: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => ({ id }),
      {
        maxEntries: 2,
        dispose: (pipeline) => {
          disposed.push(pipeline.id);
        },
      },
    );

    const leaseA = await cache.acquire("a", "a");
    await cache.preload("b", "b");
    const leaseC = await cache.acquire("c", "c");

    assertEquals(disposed, ["b"]);
    assertEquals(cache.has("a"), true);
    assertEquals(cache.has("c"), true);

    await leaseA.release();
    await leaseC.release();
    await cache.clear();
  });
});
