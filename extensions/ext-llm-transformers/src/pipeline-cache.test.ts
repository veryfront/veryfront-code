import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
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

  it("surfaces pipeline disposal failures to lifecycle owners", async () => {
    const expected = new Error("native dispose failed");
    let disposeAttempts = 0;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => ({ id }),
      {
        dispose: () => {
          disposeAttempts += 1;
          if (disposeAttempts === 1) throw expected;
        },
      },
    );

    await cache.preload("a", "a");
    const error = await assertRejects(() => cache.clear());
    assertStrictEquals(error, expected);
    await cache.clear();
    assertEquals(disposeAttempts, 2);
  });

  it("retries failed eviction cleanup before admitting a replacement", async () => {
    const disposed: string[] = [];
    let disposeAttempts = 0;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => ({ id }),
      {
        maxEntries: 1,
        dispose: (pipeline) => {
          disposeAttempts += 1;
          if (disposeAttempts === 1) throw new Error("transient dispose failure");
          disposed.push(pipeline.id);
        },
      },
    );

    await cache.preload("a", "a");
    await assertRejects(
      () => cache.preload("b", "b"),
      Error,
      "transient dispose failure",
    );
    assertEquals(cache.has("b"), false);

    await cache.preload("c", "c");
    assertEquals(disposed, ["a"]);
    assertEquals(cache.has("c"), true);
    await cache.clear();
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

  it("aborts a sole active load and disposes an ignored late completion", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const lateDisposal = Promise.withResolvers<void>();
    const disposed: string[] = [];
    let loadSignal: AbortSignal | undefined;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id, abortSignal) => {
        loadSignal = abortSignal;
        started.resolve();
        await gate.promise;
        return { id };
      },
      {
        maxEntries: 1,
        dispose: (pipeline) => {
          disposed.push(pipeline.id);
          lateDisposal.resolve();
        },
      },
    );
    const abortController = new AbortController();
    const pending = cache.acquire("a", "a", abortController.signal);
    await started.promise;

    const reason = new DOMException("cancelled", "AbortError");
    abortController.abort(reason);
    await assertRejects(() => pending, DOMException, "cancelled");
    assertStrictEquals(loadSignal?.reason, reason);

    gate.resolve();
    await lateDisposal.promise;
    assertEquals(disposed, ["a"]);
    await cache.clear();
  });

  it("enforces the cold-load deadline and disposes a signal-ignoring result", async () => {
    const started = Promise.withResolvers<void>();
    const allowCompletion = Promise.withResolvers<void>();
    const lateDisposal = Promise.withResolvers<void>();
    let loadSignal: AbortSignal | undefined;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id, abortSignal) => {
        loadSignal = abortSignal;
        started.resolve();
        await allowCompletion.promise;
        return { id };
      },
      {
        loadTimeoutMs: 10,
        dispose: () => lateDisposal.resolve(),
      },
    );

    const loading = cache.preload("slow", "slow");
    await started.promise;
    const error = await assertRejects(() => loading);
    assertEquals(error instanceof Error, true);
    assertEquals((error as Error).name, "TimeoutError");
    assertEquals(loadSignal?.aborted, true);
    assertStrictEquals(loadSignal?.reason, error);
    assertEquals(cache.has("slow"), false);

    allowCompletion.resolve();
    await lateDisposal.promise;
    await cache.clear();
  });

  it("keeps timed-out signal-ignoring loads inside the concurrency bound", async () => {
    const releaseA = Promise.withResolvers<void>();
    const releaseB = Promise.withResolvers<void>();
    let activeVendorLoads = 0;
    let peakVendorLoads = 0;
    const loaded: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        loaded.push(id);
        activeVendorLoads += 1;
        peakVendorLoads = Math.max(peakVendorLoads, activeVendorLoads);
        try {
          if (id === "a") await releaseA.promise;
          if (id === "b") await releaseB.promise;
          return { id };
        } finally {
          activeVendorLoads -= 1;
        }
      },
      {
        maxEntries: 2,
        loadTimeoutMs: 10,
      },
    );

    const firstA = cache.preload("a", "a");
    const firstB = cache.preload("b", "b");
    await assertRejects(() => firstA, Error, "deadline");
    await assertRejects(() => firstB, Error, "deadline");

    const pendingC = cache.preload("c", "c");
    const pendingD = cache.preload("d", "d");
    const overflow = await assertRejects(() => cache.preload("e", "e"));
    assertEquals(overflow instanceof Error && overflow.name, "CapacityError");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assertEquals(loaded, ["a", "b"]);
    assertEquals(peakVendorLoads, 2);

    releaseA.resolve();
    releaseB.resolve();
    await Promise.all([pendingC, pendingD]);
    assertEquals(peakVendorLoads, 2);
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

  it("holds new loads until an aborting clear boundary completes", async () => {
    const loadA = Promise.withResolvers<void>();
    const loadB = Promise.withResolvers<void>();
    let bStarted = false;
    let clearCompleted = false;
    let bStartedBeforeClearCompleted = false;
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "a") {
          await loadA.promise;
        } else {
          bStarted = true;
          bStartedBeforeClearCompleted = !clearCompleted;
          await loadB.promise;
        }
        return { id };
      },
      { maxEntries: 2 },
    );

    const firstA = cache.preload("a", "a");
    const firstAResult = firstA.catch((error) => error);
    const clearing = cache.clear().then(() => {
      clearCompleted = true;
    });
    const nextB = cache.preload("b", "b");

    const firstAError = await firstAResult;
    assertEquals(firstAError instanceof DOMException, true);
    assertEquals(firstAError.name, "AbortError");
    await clearing;
    assertEquals(cache.has("a"), false);
    assertEquals(bStartedBeforeClearCompleted, false);

    loadA.resolve();
    while (!bStarted) await Promise.resolve();
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

    const pending = ["a", "b", "c", "d"].map((id) => cache.preload(id, id));
    await initialLoadsStarted.promise;
    await Promise.resolve();
    assertEquals(totalLoads, 2);

    releaseLoads.resolve();
    await Promise.all(pending);
    assertEquals(totalLoads, 4);
    assertEquals(peakActiveLoads, 2);

    await cache.clear();
  });

  it("bounds pending distinct loads while preserving same-key deduplication", async () => {
    const releaseLoads = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const loaded: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        loaded.push(id);
        if (id === "a") firstStarted.resolve();
        await releaseLoads.promise;
        return { id };
      },
      { maxEntries: 1 },
    );

    const firstA = cache.preload("a", "a");
    await firstStarted.promise;
    const firstB = cache.preload("b", "b");
    const duplicateB = cache.preload("b", "b");
    const overflow = await assertRejects(() => cache.preload("c", "c"));
    assertEquals(overflow instanceof Error, true);
    assertEquals((overflow as Error).name, "CapacityError");
    assertEquals(loaded, ["a"]);

    releaseLoads.resolve();
    await Promise.all([firstA, firstB, duplicateB]);
    assertEquals(loaded, ["a", "b"]);
    await cache.clear();
  });

  it("reclaims a pending slot after repeated O(1) cancellations", async () => {
    const loaded: string[] = [];
    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        loaded.push(id);
        return { id };
      },
      { maxEntries: 1 },
    );

    const leaseA = await cache.acquire("a", "a");
    for (let index = 0; index < 128; index++) {
      const abortController = new AbortController();
      const pending = cache.acquire(
        `canceled-${index}`,
        `canceled-${index}`,
        abortController.signal,
      );
      abortController.abort(new DOMException("cancelled", "AbortError"));
      await assertRejects(() => pending, DOMException, "cancelled");
    }

    const finalLeasePromise = cache.acquire("final", "final");
    await leaseA.release();
    const finalLease = await finalLeasePromise;
    assertEquals(loaded, ["a", "final"]);
    await finalLease.release();
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

  it("clear aborts active and queued loads without waiting for an ignored vendor promise", async () => {
    const loadA = Promise.withResolvers<void>();
    const aStarted = Promise.withResolvers<void>();
    const lateADisposed = Promise.withResolvers<void>();
    let bStarted = false;

    const cache = createPipelineCache<FakePipeline, string>(
      async (id) => {
        if (id === "a") {
          aStarted.resolve();
          await loadA.promise;
        } else {
          bStarted = true;
        }
        return { id };
      },
      {
        maxEntries: 1,
        dispose: (pipeline) => {
          if (pipeline.id === "a") lateADisposed.resolve();
        },
      },
    );

    const firstA = cache.preload("a", "a");
    const firstAResult = firstA.catch((error) => error);
    await aStarted.promise;
    const pendingB = cache.preload("b", "b");
    const pendingBResult = pendingB.catch((error) => error);
    const clearing = cache.clear();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let outcome: string;
    try {
      outcome = await Promise.race([
        clearing.then(() => "cleared"),
        new Promise<string>((resolve) => {
          timeoutId = setTimeout(() => resolve("timed out"), 100);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
    assertEquals(outcome, "cleared");
    assertEquals((await firstAResult).name, "AbortError");
    assertEquals((await pendingBResult).name, "AbortError");
    assertEquals(bStarted, false);

    loadA.resolve();
    await lateADisposed.promise;
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
