import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HeapStats } from "#veryfront/utils/memory/index.ts";
import {
  collectGarbageSnapshot,
  getMemoryPressureRecommendations,
} from "./memory-debug-service.ts";

function heap(usedHeapSizeMB: number): HeapStats {
  return {
    usedHeapSizeMB,
    totalHeapSizeMB: 100,
    heapSizeLimitMB: 200,
    externalMemoryMB: 0,
    heapUsedPercent: usedHeapSizeMB / 2,
  };
}

describe("memory debug service", () => {
  it("does not delay when exposed garbage collection is unavailable", async () => {
    let heapReads = 0;
    let waitCalls = 0;

    const result = await collectGarbageSnapshot({
      forceGC: () => Promise.resolve(false),
      getHeapStats: () => heap(++heapReads === 1 ? 20 : 25),
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      waitForSettle: () => {
        waitCalls++;
        return Promise.resolve();
      },
    });

    assertEquals(waitCalls, 0);
    assertEquals(result.gcTriggered, false);
    assertEquals(result.freedMB, 0);
    assertEquals(result.timestamp, "2026-01-02T03:04:05.000Z");
  });

  it("waits after exposed garbage collection and reports bounded freed memory", async () => {
    const signal = new AbortController().signal;
    const heaps = [heap(20), heap(14.126)];
    let waitSignal: AbortSignal | undefined;

    const result = await collectGarbageSnapshot({
      forceGC: () => Promise.resolve(true),
      getHeapStats: () => heaps.shift()!,
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      waitForSettle: (receivedSignal) => {
        waitSignal = receivedSignal;
        return Promise.resolve();
      },
    }, signal);

    assertEquals(waitSignal, signal);
    assertEquals(result.gcTriggered, true);
    assertEquals(result.freedMB, 5.87);
  });

  it("returns environment-neutral memory pressure guidance", () => {
    const critical = getMemoryPressureRecommendations({ critical: true, warning: true });
    const serialized = JSON.stringify(critical);

    assertEquals(serialized.includes("pod"), false);
    assertEquals(serialized.includes("Consider"), false);
    assertEquals(critical.length, 3);
  });
});
