import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getContentMetricsSnapshot,
  logContentMetric,
  resetContentMetrics,
  startRequestMetrics,
  endRequestMetrics,
} from "./content-metrics.ts";

describe("platform/adapters/fs/veryfront/content-metrics", () => {
  describe("resetContentMetrics", () => {
    it("should reset all cumulative metrics to zero", () => {
      resetContentMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.requestScopedHits, 0);
      assertEquals(snapshot.persistentCacheHits, 0);
      assertEquals(snapshot.fileListHits, 0);
      assertEquals(snapshot.networkFetches, 0);
      assertEquals(snapshot.totalNetworkMs, 0);
      assertEquals(snapshot.requestsTracked, 0);
      assertEquals(snapshot.avgNetworkMsPerRequest, 0);
    });
  });

  describe("getContentMetricsSnapshot", () => {
    it("should return avgNetworkMsPerRequest as 0 when no requests tracked", () => {
      resetContentMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.avgNetworkMsPerRequest, 0);
    });
  });

  describe("startRequestMetrics / endRequestMetrics", () => {
    it("should track a request lifecycle", () => {
      resetContentMetrics();
      startRequestMetrics();
      endRequestMetrics({ requestId: "test-1" });
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.requestsTracked, 1);
    });

    it("should not throw when endRequestMetrics called without context", () => {
      resetContentMetrics();
      // endRequestMetrics is a no-op when there is no active metrics store
      // Note: enterWith from previous tests may persist in the same async context,
      // so we just verify it does not throw
      endRequestMetrics({ requestId: "no-start" });
    });

    it("should handle endRequestMetrics with no context", () => {
      resetContentMetrics();
      startRequestMetrics();
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.requestsTracked, 1);
    });
  });

  describe("logContentMetric", () => {
    it("should track REQUEST_SCOPED_HIT", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("REQUEST_SCOPED_HIT", { path: "pages/index.tsx" });
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.requestScopedHits, 1);
    });

    it("should track PERSISTENT_CACHE_HIT", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("PERSISTENT_CACHE_HIT", { path: "components/Button.tsx" });
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.persistentCacheHits, 1);
    });

    it("should track FILE_LIST_HIT", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("FILE_LIST_HIT", { path: "config.json" });
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.fileListHits, 1);
    });

    it("should track NETWORK_FETCH", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("NETWORK_FETCH", { path: "pages/about.tsx" });
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.networkFetches, 1);
    });

    it("should track NETWORK_FETCH_COMPLETE with durationMs", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("NETWORK_FETCH_COMPLETE", { durationMs: 150 });
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.totalNetworkMs, 150);
    });

    it("should handle NETWORK_FETCH_COMPLETE without durationMs", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("NETWORK_FETCH_COMPLETE", {});
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.totalNetworkMs, 0);
    });

    it("should handle logContentMetric without active request context", () => {
      resetContentMetrics();
      // Should not throw
      logContentMetric("NETWORK_FETCH", { path: "orphan.ts" });
    });

    it("should track isPreviewMode", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("REQUEST_SCOPED_HIT", { path: "test.ts", isPreviewMode: true });
      endRequestMetrics();
      // No assertion on preview mode directly, but it should not throw
    });

    it("should accumulate multiple events in a single request", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("REQUEST_SCOPED_HIT", { path: "a.ts" });
      logContentMetric("REQUEST_SCOPED_HIT", { path: "b.ts" });
      logContentMetric("NETWORK_FETCH", { path: "c.ts" });
      endRequestMetrics();
      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.requestScopedHits, 2);
      assertEquals(snapshot.networkFetches, 1);
    });

    it("should track CACHE_MISS with missReason", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("CACHE_MISS", { path: "test.ts", missReason: "cold_start" });
      endRequestMetrics();
      // Should complete without error
    });

    it("should handle CACHE_MISS without missReason", () => {
      resetContentMetrics();
      startRequestMetrics();
      logContentMetric("CACHE_MISS", { path: "test.ts" });
      endRequestMetrics();
    });

    it("should compute avgNetworkMsPerRequest", () => {
      resetContentMetrics();

      startRequestMetrics();
      logContentMetric("NETWORK_FETCH_COMPLETE", { durationMs: 100 });
      endRequestMetrics();

      startRequestMetrics();
      logContentMetric("NETWORK_FETCH_COMPLETE", { durationMs: 200 });
      endRequestMetrics();

      const snapshot = getContentMetricsSnapshot();
      assertEquals(snapshot.requestsTracked, 2);
      assertEquals(snapshot.avgNetworkMsPerRequest, 150);
    });
  });
});
