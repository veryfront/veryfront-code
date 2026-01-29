import { assertEquals } from "#veryfront/testing/assert.ts";
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
    it("should return array of boundary values", () => {
      const boundaries = getSSRBoundaries();
      assertEquals(Array.isArray(boundaries), true);
      assertEquals(boundaries.length > 0, true);
    });

    it("should be sorted ascending", () => {
      const boundaries = getSSRBoundaries();
      for (let i = 1; i < boundaries.length; i++) {
        assertEquals(boundaries[i] > boundaries[i - 1], true);
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
      const snap = createSnapshot();
      assertEquals(typeof snap.requests, "number");
      assertEquals(typeof snap.cacheGets, "number");
      assertEquals(typeof snap.cacheHits, "number");
      assertEquals(typeof snap.cacheMisses, "number");
      assertEquals(typeof snap.corsRejections, "number");
    });

    it("should return ssrHistogram with boundaries and counts", () => {
      resetMetrics();
      const snap = createSnapshot();
      assertEquals(Array.isArray(snap.ssrHistogram.boundaries), true);
      assertEquals(Array.isArray(snap.ssrHistogram.counts), true);
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
      state.corsRejections = 5;
      resetMetrics();
      assertEquals(state.requests, 0);
      assertEquals(state.cacheHits, 0);
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
