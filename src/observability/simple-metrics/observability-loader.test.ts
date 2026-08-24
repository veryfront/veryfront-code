import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getObservabilityMetrics, resetObservabilityLoader } from "./observability-loader.ts";

describe("observability/simple-metrics/observability-loader", () => {
  beforeEach(resetObservabilityLoader);

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

      assertStrictEquals(
        first,
        second,
        "second call returns the cached instance, not a rebuilt facade",
      );
    });

    it("should return same instance across multiple calls", async () => {
      const [first, second, third] = await Promise.all([
        getObservabilityMetrics(),
        getObservabilityMetrics(),
        getObservabilityMetrics(),
      ]);

      assertStrictEquals(first, second, "concurrent callers share one cached instance");
      assertStrictEquals(second, third, "concurrent callers share one cached instance");
    });
  });

  describe("resetObservabilityLoader", () => {
    it("should reset the loader state", async () => {
      const before = await getObservabilityMetrics();

      resetObservabilityLoader();

      const after = await getObservabilityMetrics();
      assertExists(after);
      assertNotStrictEquals(after, before, "reset forces a fresh load");
    });

    it("should be callable multiple times", () => {
      resetObservabilityLoader();
      resetObservabilityLoader();
      resetObservabilityLoader();
    });
  });
});
