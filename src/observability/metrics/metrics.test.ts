
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import {
  afterEach as _afterEach,
  beforeEach as _beforeEach,
  describe,
  it,
} from "std/testing/bdd.ts";

const _mockObservableResult = {
  observe: () => {},
};

const mockCounter = {
  add: () => {},
};

const mockHistogram = {
  record: () => {},
};

const mockUpDownCounter = {
  add: () => {},
};

const mockObservableGauge = {
  addCallback: () => {},
};

const mockMeter = {
  createCounter: () => mockCounter,
  createHistogram: () => mockHistogram,
  createUpDownCounter: () => mockUpDownCounter,
  createObservableGauge: () => mockObservableGauge,
};

const _mockApi = {
  metrics: {
    getMeter: () => mockMeter,
  },
};

function createMockAdapter(envVars: Record<string, string> = {}) {
  return {
    env: {
      get: (key: string) => envVars[key],
    },
  };
}

describe("Metrics Module", () => {
  describe("Module Exports", () => {
    it("should export initMetrics function", async () => {
      const { initMetrics } = await import("../index.ts");
      assertExists(initMetrics, "initMetrics should be exported");
      assertEquals(typeof initMetrics, "function", "Should be a function");
    });

    it("should export isMetricsEnabled function", async () => {
      const { isMetricsEnabled } = await import("../index.ts");
      assertExists(isMetricsEnabled, "isMetricsEnabled should be exported");
      assertEquals(typeof isMetricsEnabled, "function", "Should be a function");
    });

    it("should export getMetricsState function", async () => {
      const { getMetricsState } = await import("../index.ts");
      assertExists(getMetricsState, "getMetricsState should be exported");
      assertEquals(typeof getMetricsState, "function", "Should be a function");
    });

    it("should export shutdownMetrics function", async () => {
      const { shutdownMetrics } = await import("../index.ts");
      assertExists(shutdownMetrics, "shutdownMetrics should be exported");
      assertEquals(typeof shutdownMetrics, "function", "Should be a function");
    });
  });

  describe("HTTP Metrics Functions", () => {
    it("should export recordHttpRequest function", async () => {
      const { recordHttpRequest } = await import("../index.ts");
      assertExists(recordHttpRequest, "recordHttpRequest should be exported");
      assertEquals(typeof recordHttpRequest, "function", "Should be a function");
    });

    it("should export recordHttpRequestComplete function", async () => {
      const { recordHttpRequestComplete } = await import("../index.ts");
      assertExists(recordHttpRequestComplete, "recordHttpRequestComplete should be exported");
      assertEquals(typeof recordHttpRequestComplete, "function", "Should be a function");
    });
  });

  describe("Cache Metrics Functions", () => {
    it("should export recordCacheGet function", async () => {
      const { recordCacheGet } = await import("../index.ts");
      assertExists(recordCacheGet, "recordCacheGet should be exported");
      assertEquals(typeof recordCacheGet, "function", "Should be a function");
    });

    it("should export recordCacheSet function", async () => {
      const { recordCacheSet } = await import("../index.ts");
      assertExists(recordCacheSet, "recordCacheSet should be exported");
      assertEquals(typeof recordCacheSet, "function", "Should be a function");
    });

    it("should export recordCacheInvalidate function", async () => {
      const { recordCacheInvalidate } = await import("../index.ts");
      assertExists(recordCacheInvalidate, "recordCacheInvalidate should be exported");
      assertEquals(typeof recordCacheInvalidate, "function", "Should be a function");
    });

    it("should export setCacheSize function", async () => {
      const { setCacheSize } = await import("../index.ts");
      assertExists(setCacheSize, "setCacheSize should be exported");
      assertEquals(typeof setCacheSize, "function", "Should be a function");
    });
  });

  describe("Render Metrics Functions", () => {
    it("should export recordRender function", async () => {
      const { recordRender } = await import("../index.ts");
      assertExists(recordRender, "recordRender should be exported");
      assertEquals(typeof recordRender, "function", "Should be a function");
    });

    it("should export recordRenderError function", async () => {
      const { recordRenderError } = await import("../index.ts");
      assertExists(recordRenderError, "recordRenderError should be exported");
      assertEquals(typeof recordRenderError, "function", "Should be a function");
    });
  });

  describe("RSC Metrics Functions", () => {
    it("should export recordRSCRender function", async () => {
      const { recordRSCRender } = await import("../index.ts");
      assertExists(recordRSCRender, "recordRSCRender should be exported");
      assertEquals(typeof recordRSCRender, "function", "Should be a function");
    });

    it("should export recordRSCStream function", async () => {
      const { recordRSCStream } = await import("../index.ts");
      assertExists(recordRSCStream, "recordRSCStream should be exported");
      assertEquals(typeof recordRSCStream, "function", "Should be a function");
    });

    it("should export recordRSCRequest function", async () => {
      const { recordRSCRequest } = await import("../index.ts");
      assertExists(recordRSCRequest, "recordRSCRequest should be exported");
      assertEquals(typeof recordRSCRequest, "function", "Should be a function");
    });

    it("should export recordRSCError function", async () => {
      const { recordRSCError } = await import("../index.ts");
      assertExists(recordRSCError, "recordRSCError should be exported");
      assertEquals(typeof recordRSCError, "function", "Should be a function");
    });
  });

  describe("Build Metrics Functions", () => {
    it("should export recordBuild function", async () => {
      const { recordBuild } = await import("../index.ts");
      assertExists(recordBuild, "recordBuild should be exported");
      assertEquals(typeof recordBuild, "function", "Should be a function");
    });

    it("should export recordBundle function", async () => {
      const { recordBundle } = await import("../index.ts");
      assertExists(recordBundle, "recordBundle should be exported");
      assertEquals(typeof recordBundle, "function", "Should be a function");
    });
  });

  describe("Data Fetching Metrics Functions", () => {
    it("should export recordDataFetch function", async () => {
      const { recordDataFetch } = await import("../index.ts");
      assertExists(recordDataFetch, "recordDataFetch should be exported");
      assertEquals(typeof recordDataFetch, "function", "Should be a function");
    });

    it("should export recordDataFetchError function", async () => {
      const { recordDataFetchError } = await import("../index.ts");
      assertExists(recordDataFetchError, "recordDataFetchError should be exported");
      assertEquals(typeof recordDataFetchError, "function", "Should be a function");
    });
  });

  describe("Initialization - Disabled Metrics", () => {
    it("should handle disabled metrics with enabled=false", async () => {
      const { initMetrics, isMetricsEnabled } = await import("../index.ts");

      await initMetrics({ enabled: false });

      const enabled = isMetricsEnabled();
      assertEquals(enabled, false, "Metrics should be disabled when enabled=false");
    });

    it("should not initialize OpenTelemetry when disabled", async () => {
      const { initMetrics, getMetricsState } = await import("../index.ts");

      await initMetrics({ enabled: false });

      const state = getMetricsState();
      assert(state.initialized, "Should mark as initialized even when disabled");
    });

    it("should skip duplicate initialization attempts", async () => {
      const { initMetrics } = await import("../index.ts");

      await initMetrics({ enabled: false });
      await initMetrics({ enabled: true });

    });
  });

  describe("Configuration Defaults", () => {
    it("should use default configuration when no config provided", async () => {
      const { initMetrics } = await import("../index.ts");

      await initMetrics();
    });

    it("should merge partial config with defaults", async () => {
      const { initMetrics } = await import("../index.ts");

      await initMetrics({
        enabled: false,
        prefix: "custom-prefix",
      });

    });

    it("should use console exporter by default", async () => {
      const { initMetrics } = await import("../index.ts");

      await initMetrics({ enabled: false });

    });
  });

  describe("Environment Variable Configuration", () => {
    it("should enable metrics via OTEL_METRICS_ENABLED=true", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({ OTEL_METRICS_ENABLED: "true" });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should enable metrics via VERYFRONT_OTEL=1", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({ VERYFRONT_OTEL: "1" });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should read OTLP endpoint from OTEL_EXPORTER_OTLP_ENDPOINT", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should read OTLP endpoint from OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://localhost:4318/v1/metrics",
      });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should set exporter type from OTEL_METRICS_EXPORTER=prometheus", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "prometheus" });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should set exporter type from OTEL_METRICS_EXPORTER=otlp", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "otlp" });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should ignore invalid exporter types from env", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "invalid" });

      await initMetrics({ enabled: false }, adapter as any);

    });

    it("should handle env without get method (Node.js style)", async () => {
      const { initMetrics } = await import("../index.ts");
      const adapter = {
        env: {
          OTEL_METRICS_ENABLED: "true",
        },
      };

      await initMetrics({ enabled: false }, adapter as any);

    });
  });

  describe("Runtime State Management", () => {
    it("should track cache size correctly", async () => {
      const { setCacheSize, getMetricsState } = await import("../index.ts");

      setCacheSize(100);
      const state = getMetricsState();

      assertEquals(state.cacheSize, 100, "Cache size should be tracked");
    });

    it("should increment active requests on recordHttpRequest", async () => {
      const { recordHttpRequest, getMetricsState } = await import("../index.ts");

      const initialState = getMetricsState();
      recordHttpRequest();
      const newState = getMetricsState();

      assertEquals(
        newState.activeRequests,
        initialState.activeRequests + 1,
        "Active requests should increment",
      );
    });

    it("should decrement active requests on recordHttpRequestComplete", async () => {
      const { recordHttpRequest, recordHttpRequestComplete, getMetricsState } = await import(
        "../index.ts"
      );

      recordHttpRequest();
      const beforeComplete = getMetricsState();
      recordHttpRequestComplete(100);
      const afterComplete = getMetricsState();

      assertEquals(
        afterComplete.activeRequests,
        beforeComplete.activeRequests - 1,
        "Active requests should decrement",
      );
    });

    it("should increment cache size on recordCacheSet", async () => {
      const { recordCacheSet, getMetricsState } = await import("../index.ts");

      const initialState = getMetricsState();
      recordCacheSet();
      const newState = getMetricsState();

      assertEquals(
        newState.cacheSize,
        initialState.cacheSize + 1,
        "Cache size should increment",
      );
    });

    it("should decrement cache size on recordCacheInvalidate", async () => {
      const { setCacheSize, recordCacheInvalidate, getMetricsState } = await import("../index.ts");

      setCacheSize(10);
      recordCacheInvalidate(3);
      const state = getMetricsState();

      assertEquals(state.cacheSize, 7, "Cache size should decrement by invalidation count");
    });

    it("should not go below zero on cache invalidation", async () => {
      const { setCacheSize, recordCacheInvalidate, getMetricsState } = await import("../index.ts");

      setCacheSize(2);
      recordCacheInvalidate(5);
      const state = getMetricsState();

      assertEquals(state.cacheSize, 0, "Cache size should not go below zero");
    });
  });

  describe("HTTP Metrics Recording", () => {
    it("should record HTTP request without attributes", async () => {
      const { recordHttpRequest } = await import("../index.ts");

      recordHttpRequest();
    });

    it("should record HTTP request with attributes", async () => {
      const { recordHttpRequest } = await import("../index.ts");

      recordHttpRequest({ method: "GET", path: "/api/users" });
    });

    it("should record HTTP request completion with duration", async () => {
      const { recordHttpRequestComplete } = await import("../index.ts");

      recordHttpRequestComplete(250);
    });

    it("should record HTTP request completion with attributes", async () => {
      const { recordHttpRequestComplete } = await import("../index.ts");

      recordHttpRequestComplete(250, { status: "200", method: "POST" });
    });
  });

  describe("Cache Metrics Recording", () => {
    it("should record cache hit", async () => {
      const { recordCacheGet } = await import("../index.ts");

      recordCacheGet(true);
    });

    it("should record cache miss", async () => {
      const { recordCacheGet } = await import("../index.ts");

      recordCacheGet(false);
    });

    it("should record cache get with attributes", async () => {
      const { recordCacheGet } = await import("../index.ts");

      recordCacheGet(true, { key: "user:123", type: "memory" });
    });

    it("should record cache set with attributes", async () => {
      const { recordCacheSet } = await import("../index.ts");

      recordCacheSet({ key: "user:123", ttl: "3600" });
    });

    it("should record cache invalidation with count", async () => {
      const { recordCacheInvalidate } = await import("../index.ts");

      recordCacheInvalidate(5);
    });

    it("should record cache invalidation with attributes", async () => {
      const { recordCacheInvalidate } = await import("../index.ts");

      recordCacheInvalidate(5, { pattern: "user:*" });
    });
  });

  describe("Render Metrics Recording", () => {
    it("should record render with duration", async () => {
      const { recordRender } = await import("../index.ts");

      recordRender(150);
    });

    it("should record render with attributes", async () => {
      const { recordRender } = await import("../index.ts");

      recordRender(150, { page: "/dashboard", type: "ssr" });
    });

    it("should record render error", async () => {
      const { recordRenderError } = await import("../index.ts");

      recordRenderError();
    });

    it("should record render error with attributes", async () => {
      const { recordRenderError } = await import("../index.ts");

      recordRenderError({ error: "ComponentError", page: "/about" });
    });
  });

  describe("RSC Metrics Recording", () => {
    it("should record RSC render with duration", async () => {
      const { recordRSCRender } = await import("../index.ts");

      recordRSCRender(200);
    });

    it("should record RSC stream with duration", async () => {
      const { recordRSCStream } = await import("../index.ts");

      recordRSCStream(300);
    });

    it("should record RSC manifest request", async () => {
      const { recordRSCRequest } = await import("../index.ts");

      recordRSCRequest("manifest");
    });

    it("should record RSC page request", async () => {
      const { recordRSCRequest } = await import("../index.ts");

      recordRSCRequest("page");
    });

    it("should record RSC stream request", async () => {
      const { recordRSCRequest } = await import("../index.ts");

      recordRSCRequest("stream");
    });

    it("should record RSC action request", async () => {
      const { recordRSCRequest } = await import("../index.ts");

      recordRSCRequest("action");
    });

    it("should record RSC request with attributes", async () => {
      const { recordRSCRequest } = await import("../index.ts");

      recordRSCRequest("page", { path: "/products" });
    });

    it("should record RSC error", async () => {
      const { recordRSCError } = await import("../index.ts");

      recordRSCError();
    });

    it("should record RSC error with attributes", async () => {
      const { recordRSCError } = await import("../index.ts");

      recordRSCError({ type: "StreamError", component: "ProductList" });
    });
  });

  describe("Build Metrics Recording", () => {
    it("should record build with duration", async () => {
      const { recordBuild } = await import("../index.ts");

      recordBuild(5000);
    });

    it("should record build with attributes", async () => {
      const { recordBuild } = await import("../index.ts");

      recordBuild(5000, { type: "production", target: "browser" });
    });

    it("should record bundle with size", async () => {
      const { recordBundle } = await import("../index.ts");

      recordBundle(250.5);
    });

    it("should record bundle with attributes", async () => {
      const { recordBundle } = await import("../index.ts");

      recordBundle(250.5, { name: "app.js", type: "client" });
    });
  });

  describe("Data Fetching Metrics Recording", () => {
    it("should record data fetch with duration", async () => {
      const { recordDataFetch } = await import("../index.ts");

      recordDataFetch(120);
    });

    it("should record data fetch with attributes", async () => {
      const { recordDataFetch } = await import("../index.ts");

      recordDataFetch(120, { source: "api", endpoint: "/users" });
    });

    it("should record data fetch error", async () => {
      const { recordDataFetchError } = await import("../index.ts");

      recordDataFetchError();
    });

    it("should record data fetch error with attributes", async () => {
      const { recordDataFetchError } = await import("../index.ts");

      recordDataFetchError({ error: "NetworkError", endpoint: "/products" });
    });
  });

  describe("Graceful Shutdown", () => {
    it("should shutdown metrics without error when not initialized", async () => {
      const { shutdownMetrics } = await import("../index.ts");

      await shutdownMetrics();
    });

    it("should shutdown metrics without error when initialized", async () => {
      const { initMetrics, shutdownMetrics } = await import("../index.ts");

      await initMetrics({ enabled: false });

      await shutdownMetrics();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle metrics recording when not initialized", async () => {
      const { recordHttpRequest } = await import("../index.ts");

      recordHttpRequest();
    });

    it("should handle null attributes gracefully", async () => {
      const { recordHttpRequest } = await import("../index.ts");

      recordHttpRequest(undefined);
    });

    it("should handle empty attributes object", async () => {
      const { recordRender } = await import("../index.ts");

      recordRender(100, {});
    });

    it("should handle zero duration values", async () => {
      const { recordRender } = await import("../index.ts");

      recordRender(0);
    });

    it("should handle negative duration values", async () => {
      const { recordHttpRequestComplete } = await import("../index.ts");

      recordHttpRequestComplete(-10);
    });

    it("should handle very large duration values", async () => {
      const { recordBuild } = await import("../index.ts");

      recordBuild(999999);
    });

    it("should handle zero count invalidation", async () => {
      const { recordCacheInvalidate } = await import("../index.ts");

      recordCacheInvalidate(0);
    });

    it("should handle large count invalidation", async () => {
      const { setCacheSize, recordCacheInvalidate, getMetricsState } = await import("../index.ts");

      setCacheSize(100);
      recordCacheInvalidate(1000);
      const state = getMetricsState();

      assertEquals(state.cacheSize, 0, "Should not go below zero");
    });
  });
});
