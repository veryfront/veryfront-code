import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { MetricsRecorder } from "./recorder.ts";

function createMockInstruments() {
  return {
    httpRequestCounter: null,
    httpRequestDuration: null,
    httpActiveRequests: null,
    cacheGetCounter: null,
    cacheHitCounter: null,
    cacheMissCounter: null,
    cacheSetCounter: null,
    cacheInvalidateCounter: null,
    cacheSizeGauge: null,
    renderDuration: null,
    renderCounter: null,
    renderErrorCounter: null,
    rscRenderDuration: null,
    rscStreamDuration: null,
    rscManifestCounter: null,
    rscPageCounter: null,
    rscStreamCounter: null,
    rscActionCounter: null,
    rscErrorCounter: null,
    buildDuration: null,
    bundleSizeHistogram: null,
    bundleCounter: null,
    dataFetchDuration: null,
    dataFetchCounter: null,
    dataFetchErrorCounter: null,
    corsRejectionCounter: null,
    securityHeadersCounter: null,
    memoryUsageGauge: null,
    heapUsageGauge: null,
  };
}

describe("metrics/recorder", () => {
  describe("HTTP metrics", () => {
    it("should record HTTP request", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordHttpRequest({ method: "GET" });
      assertEquals(state.activeRequests, 1);
    });

    it("should record HTTP request complete", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 1 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordHttpRequestComplete(100, { method: "GET" });
      assertEquals(state.activeRequests, 0);
    });
  });

  describe("Cache metrics", () => {
    it("should record cache get with hit", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordCacheGet(true, { key: "test" });
    });

    it("should record cache get with miss", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordCacheGet(false, { key: "test" });
    });

    it("should record cache set", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordCacheSet({ key: "test" });
      assertEquals(state.cacheSize, 1);
    });

    it("should record cache invalidate", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 10, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordCacheInvalidate(3, { pattern: "*" });
      assertEquals(state.cacheSize, 7);
    });

    it("should not allow negative cache size", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 2, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordCacheInvalidate(5, {});
      assertEquals(state.cacheSize, 0);
    });

    it("should set cache size directly", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.setCacheSize(100);
      assertEquals(state.cacheSize, 100);
    });
  });

  describe("Render metrics", () => {
    it("should record render", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordRender(150, { page: "/home" });
    });

    it("should record render error", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordRenderError({ component: "Header" });
    });
  });

  describe("RSC metrics", () => {
    it("should record RSC render", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordRSCRender(200, { page: "/dashboard" });
    });

    it("should record RSC stream", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordRSCStream(300, { streamId: "1" });
    });

    it("should record RSC request types", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordRSCRequest("manifest", { version: "1.0" });
      recorder.recordRSCRequest("page", { path: "/home" });
      recorder.recordRSCRequest("stream", { streamId: "1" });
      recorder.recordRSCRequest("action", { actionId: "submit" });
    });

    it("should record RSC error", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordRSCError({ error: "StreamError" });
    });
  });

  describe("Build metrics", () => {
    it("should record build", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordBuild(5000, { target: "production" });
    });

    it("should record bundle", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordBundle(250, { name: "main.js" });
    });
  });

  describe("Data metrics", () => {
    it("should record data fetch", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordDataFetch(100, { endpoint: "/api/users" });
    });

    it("should record data fetch error", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordDataFetchError({ endpoint: "/api/users" });
    });
  });

  describe("Security metrics", () => {
    it("should record CORS rejection", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordCorsRejection({ origin: "http://evil.com" });
    });

    it("should record security headers", () => {
      const instruments = createMockInstruments();
      const state = { cacheSize: 0, activeRequests: 0 };
      const recorder = new MetricsRecorder(instruments, state);

      recorder.recordSecurityHeaders({ header: "CSP" });
    });
  });
});
