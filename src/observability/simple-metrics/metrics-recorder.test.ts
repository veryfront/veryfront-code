import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resetMetrics, state } from "./metrics-state.ts";
import {
  recordApiRequest,
  recordApiRetry,
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  recordContentNetworkFetch,
  recordCorsRejection,
  recordHttp,
  recordModuleServe,
  recordModuleTransform,
  recordRouteManifestLookup,
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

    it("ignores negative and non-finite values", () => {
      resetMetrics();
      recordHttp(-1, Number.NaN, Number.POSITIVE_INFINITY);

      assertEquals(state.jitHttpResolved, 0);
      assertEquals(state.jitHttpBlocked, 0);
      assertEquals(state.jitHttpFetchMsTotal, 0);
    });

    it("clamps inputs and accumulated totals to safe integers", () => {
      resetMetrics();
      state.jitHttpResolved = Number.MAX_SAFE_INTEGER - 1;

      recordHttp(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);

      assertEquals(state.jitHttpResolved, Number.MAX_SAFE_INTEGER);
      assertEquals(state.jitHttpBlocked, Number.MAX_SAFE_INTEGER);
      assertEquals(state.jitHttpFetchMsTotal, Number.MAX_SAFE_INTEGER);
      assertEquals(Number.isSafeInteger(state.jitHttpResolved), true);
    });
  });

  describe("recordCacheGet", () => {
    it("saturates counters instead of overflowing safe integer precision", () => {
      resetMetrics();
      state.cacheGets = Number.MAX_SAFE_INTEGER;
      state.cacheHits = Number.MAX_SAFE_INTEGER;

      recordCacheGet(true);

      assertEquals(state.cacheGets, Number.MAX_SAFE_INTEGER);
      assertEquals(state.cacheHits, Number.MAX_SAFE_INTEGER);
    });

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

  describe("module performance metrics", () => {
    it("records module serve status totals", () => {
      resetMetrics();
      recordModuleServe("ok");
      recordModuleServe("not_found");
      recordModuleServe("error");

      assertEquals(state.moduleServeTotal, 3);
      assertEquals(state.moduleServeOk, 1);
      assertEquals(state.moduleServeNotFound, 1);
      assertEquals(state.moduleServeError, 1);
    });

    it("records module transform count and total duration", () => {
      resetMetrics();
      recordModuleTransform(12.8);
      recordModuleTransform(-5);

      assertEquals(state.moduleTransformTotal, 2);
      assertEquals(state.moduleTransformDurationMsTotal, 12);
    });

    it("keeps module transform totals finite", () => {
      resetMetrics();
      recordModuleTransform(Number.NaN);
      recordModuleTransform(Number.POSITIVE_INFINITY);

      assertEquals(state.moduleTransformTotal, 2);
      assertEquals(state.moduleTransformDurationMsTotal, 0);
    });

    it("records route manifest LRU hits and misses", () => {
      resetMetrics();
      recordRouteManifestLookup(true);
      recordRouteManifestLookup(false);
      recordRouteManifestLookup(false);

      assertEquals(state.routeManifestLruHits, 1);
      assertEquals(state.routeManifestLruMisses, 2);
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

    it("ignores negative and non-finite invalidation counts", () => {
      resetMetrics();
      recordCacheInvalidate(-1);
      recordCacheInvalidate(Number.NaN);

      assertEquals(state.cacheInvalidations, 0);
    });
  });

  describe("recordSSR", () => {
    it("saturates histogram bucket counts", () => {
      resetMetrics();
      state._ssrCounts[0] = Number.MAX_SAFE_INTEGER;

      recordSSR(0);

      assertEquals(state._ssrCounts[0], Number.MAX_SAFE_INTEGER);
    });

    it("should record duration in histogram bucket", () => {
      resetMetrics();
      recordSSR(50);
      const bucket50 = state._ssrCounts.find((c) => c > 0);
      assertEquals(bucket50 !== undefined, true);
    });

    it("records non-finite durations as zero instead of corrupting state", () => {
      resetMetrics();
      recordSSR(Number.NaN);

      assertEquals(state._ssrCounts[0], 1);
      assertEquals(state._ssrCounts.at(-1), 0);
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

  describe("recordContentNetworkFetch", () => {
    it("keeps durations, request counters, and buckets within safe integer range", () => {
      resetMetrics();
      state.contentNetworkFetches = Number.MAX_SAFE_INTEGER;
      state.contentNetworkFetchMsTotal = Number.MAX_SAFE_INTEGER - 1;
      state.contentPreviewRequests = Number.MAX_SAFE_INTEGER;
      const lastBucket = state._contentNetworkCounts.length - 1;
      state._contentNetworkCounts[lastBucket] = Number.MAX_SAFE_INTEGER;

      recordContentNetworkFetch(Number.MAX_VALUE, true);

      assertEquals(state.contentNetworkFetches, Number.MAX_SAFE_INTEGER);
      assertEquals(state.contentNetworkFetchMsTotal, Number.MAX_SAFE_INTEGER);
      assertEquals(state.contentPreviewRequests, Number.MAX_SAFE_INTEGER);
      assertEquals(state._contentNetworkCounts[lastBucket], Number.MAX_SAFE_INTEGER);
    });
  });
});
