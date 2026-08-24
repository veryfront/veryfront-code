import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createSnapshot,
  getRequestCount,
  getSSRBoundaries,
  resetMetrics,
  state,
} from "./metrics-state.ts";

describe("observability/simple-metrics/metrics-state", () => {
  describe("getSSRBoundaries", () => {
    it("returns a defensive copy", () => {
      const boundaries = getSSRBoundaries();
      boundaries[0] = -1;

      assertEquals(getSSRBoundaries()[0], 5);
    });

    it("should return array of boundary values", () => {
      const boundaries = getSSRBoundaries();
      assertEquals(Array.isArray(boundaries), true);
      assertEquals(boundaries.length > 0, true);
    });

    it("should be sorted ascending", () => {
      const boundaries = getSSRBoundaries();
      for (let i = 1; i < boundaries.length; i++) {
        const current = boundaries[i];
        const previous = boundaries[i - 1];
        assertExists(current);
        assertExists(previous);
        assertEquals(current > previous, true);
      }
    });

    it("should include common SSR thresholds", () => {
      const boundaries = getSSRBoundaries();
      assertEquals(boundaries.includes(100), true);
      assertEquals(boundaries.includes(500), true);
      assertEquals(boundaries.includes(1000), true);
    });
  });

  describe("createSnapshot", () => {
    it("should return all metric fields", () => {
      resetMetrics();
      const numericKeys = Object.keys(state).filter(
        (key) => !key.startsWith("_") && typeof state[key as keyof typeof state] === "number",
      );
      const counters = state as unknown as Record<string, number>;
      numericKeys.forEach((key, index) => {
        counters[key] = index + 1;
      });

      const snap = createSnapshot() as unknown as Record<string, number>;
      const expected = Object.fromEntries(numericKeys.map((key, index) => [key, index + 1]));
      const actual = Object.fromEntries(numericKeys.map((key) => [key, snap[key]]));

      assertEquals(actual, expected, "each snapshot field must copy its own state counter");
      assertEquals(
        numericKeys.filter((key) => !(key in snap)),
        [],
        "createSnapshot must not drop a state counter",
      );
      resetMetrics();
    });

    it("should return ssrHistogram with boundaries and counts", () => {
      resetMetrics();
      state._ssrCounts[0] = 3;
      state._contentNetworkCounts[0] = 4;
      const snap = createSnapshot();
      resetMetrics();

      assertExists(snap.ssrHistogram);
      assertEquals(Array.isArray(snap.ssrHistogram.boundaries), true);
      assertEquals(Array.isArray(snap.ssrHistogram.counts), true);
      assertEquals(
        snap.ssrHistogram.boundaries,
        getSSRBoundaries(),
        "snapshot boundaries must match the published SSR boundaries",
      );
      assertEquals(
        snap.ssrHistogram.counts[0],
        3,
        "snapshot histogram counts must survive a later resetMetrics",
      );
      assertEquals(
        snap.contentNetworkHistogram?.counts[0],
        4,
        "snapshot content-network counts must survive a later resetMetrics",
      );

      snap.ssrHistogram.counts[1] = 99;
      assertEquals(
        state._ssrCounts[1],
        0,
        "mutating a snapshot must not write back into live state",
      );
    });

    it("should return a copy (not reference)", () => {
      resetMetrics();
      state.requests = 42;
      const snap = createSnapshot();
      assertEquals(snap.requests, 42);
      state.requests = 0;
      assertEquals(snap.requests, 42);
    });
  });

  describe("resetMetrics", () => {
    it("should reset all counters to zero", () => {
      state.requests = 100;
      state.cacheHits = 50;
      state.moduleServeTotal = 12;
      state.routeManifestLruMisses = 4;
      state.corsRejections = 5;
      resetMetrics();
      assertEquals(state.requests, 0);
      assertEquals(state.cacheHits, 0);
      assertEquals(state.moduleServeTotal, 0);
      assertEquals(state.routeManifestLruMisses, 0);
      assertEquals(state.corsRejections, 0);
    });

    it("should reset SSR counts array", () => {
      state._ssrCounts[0] = 10;
      resetMetrics();
      assertEquals(state._ssrCounts[0], 0);
    });
  });

  describe("getRequestCount", () => {
    it("should return current request count", () => {
      resetMetrics();
      assertEquals(getRequestCount(), 0);
      state.requests = 7;
      assertEquals(getRequestCount(), 7);
      resetMetrics();
    });
  });
});
