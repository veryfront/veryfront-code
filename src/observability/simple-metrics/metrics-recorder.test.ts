import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resetMetrics, state } from "./metrics-state.ts";
import {
  recordApiRequest,
  recordApiRetry,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordCorsRejection,
  recordHttp,
  recordRSC,
  recordSecurityHeaders,
  recordSSR,
} from "./metrics-recorder.ts";

describe("observability/simple-metrics/metrics-recorder", () => {
  describe("recordHttp", () => {
    it("should accumulate resolved and blocked counts", () => {
      resetMetrics();
      recordHttp(5, 2, 150.7);
      assertEquals(state.jitHttpResolved, 5);
      assertEquals(state.jitHttpBlocked, 2);
      assertEquals(state.jitHttpFetchMsTotal, 150);
    });
  });

  describe("recordCacheGet", () => {
    it("should increment gets and hits on hit", () => {
      resetMetrics();
      recordCacheGet(true);
      assertEquals(state.cacheGets, 1);
      assertEquals(state.cacheHits, 1);
      assertEquals(state.cacheMisses, 0);
    });

    it("should increment gets and misses on miss", () => {
      resetMetrics();
      recordCacheGet(false);
      assertEquals(state.cacheGets, 1);
      assertEquals(state.cacheHits, 0);
      assertEquals(state.cacheMisses, 1);
    });
  });

  describe("recordCacheSet", () => {
    it("should increment cache sets", () => {
      resetMetrics();
      recordCacheSet();
      assertEquals(state.cacheSets, 1);
    });
  });

  describe("recordCacheInvalidate", () => {
    it("should add invalidation count", () => {
      resetMetrics();
      recordCacheInvalidate(5);
      assertEquals(state.cacheInvalidations, 5);
      recordCacheInvalidate(3);
      assertEquals(state.cacheInvalidations, 8);
    });
  });

  describe("recordSSR", () => {
    it("should record duration in histogram bucket", () => {
      resetMetrics();
      recordSSR(50);
      const bucket50 = state._ssrCounts.find((c) => c > 0);
      assertEquals(bucket50 !== undefined, true);
    });
  });

  describe("recordRSC", () => {
    it("should increment page counter for page kind", () => {
      resetMetrics();
      recordRSC("page");
      assertEquals(state.rscPage, 1);
    });

    it("should increment manifest counter", () => {
      resetMetrics();
      recordRSC("manifest");
      assertEquals(state.rscManifest, 1);
    });

    it("should increment error counter", () => {
      resetMetrics();
      recordRSC("error");
      assertEquals(state.rscErrors, 1);
    });
  });

  describe("recordCorsRejection", () => {
    it("should increment cors rejections", () => {
      resetMetrics();
      recordCorsRejection();
      assertEquals(state.corsRejections, 1);
    });
  });

  describe("recordSecurityHeaders", () => {
    it("should increment security headers applied", () => {
      resetMetrics();
      recordSecurityHeaders();
      assertEquals(state.securityHeadersApplied, 1);
    });
  });

  describe("recordApiRequest", () => {
    it("should categorize 2xx responses", () => {
      resetMetrics();
      recordApiRequest(200);
      recordApiRequest(201);
      assertEquals(state.apiRequests2xx, 2);
    });

    it("should categorize 4xx responses", () => {
      resetMetrics();
      recordApiRequest(404);
      recordApiRequest(401);
      assertEquals(state.apiRequests4xx, 2);
    });

    it("should categorize 5xx responses", () => {
      resetMetrics();
      recordApiRequest(500);
      recordApiRequest(503);
      assertEquals(state.apiRequests5xx, 2);
    });
  });

  describe("recordApiRetry", () => {
    it("should increment retries", () => {
      resetMetrics();
      recordApiRetry();
      assertEquals(state.apiRetries, 1);
    });
  });
});
