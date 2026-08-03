import { assertEquals, assertThrows } from "@std/assert";
import { admitRuntimeMemory, admitRuntimeMetrics } from "./RuntimeTab.tsx";

Deno.test("runtime admission accepts bounded metrics and memory snapshots", () => {
  assertEquals(admitRuntimeMetrics({ counters: { requests: 3 } }), { requests: 3 });
  assertEquals(
    admitRuntimeMemory({
      heap: {
        usedHeapSizeMB: 10,
        totalHeapSizeMB: 20,
        heapSizeLimitMB: 100,
        heapUsedPercent: 10,
        rss: 30,
      },
      caches: [{ name: "modules", entries: 2, maxEntries: 100 }],
      pressure: { critical: false, warning: false, heapUsedPercent: 10 },
    }),
    {
      heap: {
        usedHeapSizeMB: 10,
        totalHeapSizeMB: 20,
        heapSizeLimitMB: 100,
        heapUsedPercent: 10,
        rss: 30,
      },
      caches: [{ name: "modules", entries: 2, maxEntries: 100 }],
      pressure: { critical: false, warning: false, heapUsedPercent: 10 },
    },
  );
});

Deno.test("runtime admission rejects malformed nested snapshots", () => {
  assertThrows(() => admitRuntimeMetrics({ counters: [] }), TypeError, "must be an object");
  assertThrows(
    () =>
      admitRuntimeMemory({
        heap: {
          usedHeapSizeMB: 10,
          totalHeapSizeMB: 20,
          heapSizeLimitMB: 100,
          heapUsedPercent: "10",
        },
        caches: [],
        pressure: { critical: false, warning: false, heapUsedPercent: 10 },
      }),
    TypeError,
    "must be a finite number",
  );
});
