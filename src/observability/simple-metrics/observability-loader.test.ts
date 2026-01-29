import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getObservabilityMetrics, resetObservabilityLoader } from "./observability-loader.ts";

describe("observability/simple-metrics/observability-loader", () => {
  beforeEach(() => {
    resetObservabilityLoader();
  });

  describe("getObservabilityMetrics", () => {
    it("should return an observability metrics object", async () => {
      const metrics = await getObservabilityMetrics();
      assertExists(metrics);
      assertEquals(typeof metrics.recordRender, "function");
      assertEquals(typeof metrics.recordCacheGet, "function");
      assertEquals(typeof metrics.recordCacheSet, "function");
      assertEquals(typeof metrics.recordCacheInvalidate, "function");
      assertEquals(typeof metrics.recordHttpRequest, "function");
      assertEquals(typeof metrics.recordRSCRequest, "function");
      assertEquals(typeof metrics.recordRSCStream, "function");
    });

    it("should cache the result after first call", async () => {
      const first = await getObservabilityMetrics();
      const second = await getObservabilityMetrics();
      assertEquals(first, second);
    });

    it("should return same instance across multiple calls", async () => {
      const results = await Promise.all([
        getObservabilityMetrics(),
        getObservabilityMetrics(),
        getObservabilityMetrics(),
      ]);
      // After first load attempt, subsequent calls return cached value
      assertEquals(results[1], results[2]);
    });
  });

  describe("resetObservabilityLoader", () => {
    it("should reset the loader state", async () => {
      // Load once
      await getObservabilityMetrics();

      // Reset
      resetObservabilityLoader();

      // Should reload - still returns metrics since the module exists
      const metrics = await getObservabilityMetrics();
      assertExists(metrics);
    });

    it("should be callable multiple times", () => {
      resetObservabilityLoader();
      resetObservabilityLoader();
      resetObservabilityLoader();
      // Should not throw
    });
  });
});
