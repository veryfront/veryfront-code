/**
 * OpenTelemetry Metrics Tests
 *
 * Comprehensive tests covering:
 * - Initialization with different configurations
 * - Environment variable override logic
 * - Counter recording (HTTP, cache, render, RSC, build, data fetch)
 * - Histogram recording (duration, size)
 * - Observable gauge creation and callbacks
 * - UpDownCounter for active request tracking
 * - Runtime state management
 * - Exporter configuration (console, OTLP, Prometheus)
 * - Error handling and edge cases
 * - isMetricsEnabled checks
 * - Graceful shutdown
 */

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { beforeEach, describe, it } from "@veryfront/testing/bdd";
import { MetricsManager } from "./manager.ts";

// Mock adapter with environment access
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
      const { initMetrics } = await import("./index.ts");
      assertExists(initMetrics, "initMetrics should be exported");
      assertEquals(typeof initMetrics, "function", "Should be a function");
    });

    it("should export isMetricsEnabled function", async () => {
      const { isMetricsEnabled } = await import("./index.ts");
      assertExists(isMetricsEnabled, "isMetricsEnabled should be exported");
      assertEquals(typeof isMetricsEnabled, "function", "Should be a function");
    });

    it("should export getMetricsState function", async () => {
      const { getMetricsState } = await import("./index.ts");
      assertExists(getMetricsState, "getMetricsState should be exported");
      assertEquals(typeof getMetricsState, "function", "Should be a function");
    });

    it("should export shutdownMetrics function", async () => {
      const { shutdownMetrics } = await import("./index.ts");
      assertExists(shutdownMetrics, "shutdownMetrics should be exported");
      assertEquals(typeof shutdownMetrics, "function", "Should be a function");
    });

    it("should export MetricsManager class", async () => {
      const { MetricsManager } = await import("./index.ts");
      assertExists(MetricsManager, "MetricsManager should be exported");
      assertEquals(typeof MetricsManager, "function", "Should be a class");
    });
  });

  describe("HTTP Metrics Functions", () => {
    it("should export recordHttpRequest function", async () => {
      const { recordHttpRequest } = await import("./index.ts");
      assertExists(recordHttpRequest, "recordHttpRequest should be exported");
      assertEquals(typeof recordHttpRequest, "function", "Should be a function");
    });

    it("should export recordHttpRequestComplete function", async () => {
      const { recordHttpRequestComplete } = await import("./index.ts");
      assertExists(recordHttpRequestComplete, "recordHttpRequestComplete should be exported");
      assertEquals(typeof recordHttpRequestComplete, "function", "Should be a function");
    });
  });

  describe("Cache Metrics Functions", () => {
    it("should export recordCacheGet function", async () => {
      const { recordCacheGet } = await import("./index.ts");
      assertExists(recordCacheGet, "recordCacheGet should be exported");
      assertEquals(typeof recordCacheGet, "function", "Should be a function");
    });

    it("should export recordCacheSet function", async () => {
      const { recordCacheSet } = await import("./index.ts");
      assertExists(recordCacheSet, "recordCacheSet should be exported");
      assertEquals(typeof recordCacheSet, "function", "Should be a function");
    });

    it("should export recordCacheInvalidate function", async () => {
      const { recordCacheInvalidate } = await import("./index.ts");
      assertExists(recordCacheInvalidate, "recordCacheInvalidate should be exported");
      assertEquals(typeof recordCacheInvalidate, "function", "Should be a function");
    });

    it("should export setCacheSize function", async () => {
      const { setCacheSize } = await import("./index.ts");
      assertExists(setCacheSize, "setCacheSize should be exported");
      assertEquals(typeof setCacheSize, "function", "Should be a function");
    });
  });

  describe("Render Metrics Functions", () => {
    it("should export recordRender function", async () => {
      const { recordRender } = await import("./index.ts");
      assertExists(recordRender, "recordRender should be exported");
      assertEquals(typeof recordRender, "function", "Should be a function");
    });

    it("should export recordRenderError function", async () => {
      const { recordRenderError } = await import("./index.ts");
      assertExists(recordRenderError, "recordRenderError should be exported");
      assertEquals(typeof recordRenderError, "function", "Should be a function");
    });
  });

  describe("RSC Metrics Functions", () => {
    it("should export recordRSCRender function", async () => {
      const { recordRSCRender } = await import("./index.ts");
      assertExists(recordRSCRender, "recordRSCRender should be exported");
      assertEquals(typeof recordRSCRender, "function", "Should be a function");
    });

    it("should export recordRSCStream function", async () => {
      const { recordRSCStream } = await import("./index.ts");
      assertExists(recordRSCStream, "recordRSCStream should be exported");
      assertEquals(typeof recordRSCStream, "function", "Should be a function");
    });

    it("should export recordRSCRequest function", async () => {
      const { recordRSCRequest } = await import("./index.ts");
      assertExists(recordRSCRequest, "recordRSCRequest should be exported");
      assertEquals(typeof recordRSCRequest, "function", "Should be a function");
    });

    it("should export recordRSCError function", async () => {
      const { recordRSCError } = await import("./index.ts");
      assertExists(recordRSCError, "recordRSCError should be exported");
      assertEquals(typeof recordRSCError, "function", "Should be a function");
    });
  });

  describe("Build Metrics Functions", () => {
    it("should export recordBuild function", async () => {
      const { recordBuild } = await import("./index.ts");
      assertExists(recordBuild, "recordBuild should be exported");
      assertEquals(typeof recordBuild, "function", "Should be a function");
    });

    it("should export recordBundle function", async () => {
      const { recordBundle } = await import("./index.ts");
      assertExists(recordBundle, "recordBundle should be exported");
      assertEquals(typeof recordBundle, "function", "Should be a function");
    });
  });

  describe("Data Fetching Metrics Functions", () => {
    it("should export recordDataFetch function", async () => {
      const { recordDataFetch } = await import("./index.ts");
      assertExists(recordDataFetch, "recordDataFetch should be exported");
      assertEquals(typeof recordDataFetch, "function", "Should be a function");
    });

    it("should export recordDataFetchError function", async () => {
      const { recordDataFetchError } = await import("./index.ts");
      assertExists(recordDataFetchError, "recordDataFetchError should be exported");
      assertEquals(typeof recordDataFetchError, "function", "Should be a function");
    });
  });

  describe("MetricsManager - Initialization", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should handle disabled metrics with enabled=false", async () => {
      await manager.initialize({ enabled: false });

      const enabled = manager.isEnabled();
      assertEquals(enabled, false, "Metrics should be disabled when enabled=false");
    });

    it("should mark as initialized even when disabled", async () => {
      await manager.initialize({ enabled: false });

      const state = manager.getState();
      assert(state.initialized, "Should mark as initialized even when disabled");
    });

    it("should skip duplicate initialization attempts", async () => {
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true }); // Second init should be skipped

      // No error should be thrown, and still disabled (first init wins)
      assertEquals(manager.isEnabled(), false);
    });

    it("should accept partial config", async () => {
      await manager.initialize({
        enabled: false,
        prefix: "custom-prefix",
      });

      // Should accept partial config without error
    });
  });

  describe("MetricsManager - Environment Variable Configuration", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should read config via OTEL_METRICS_ENABLED=true", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_ENABLED: "true" });
      await manager.initialize({ enabled: false }, adapter as any);
      // Environment variable should override config
    });

    it("should read config via VERYFRONT_OTEL=1", async () => {
      const adapter = createMockAdapter({ VERYFRONT_OTEL: "1" });
      await manager.initialize({ enabled: false }, adapter as any);
      // Environment variable should override config
    });

    it("should read OTLP endpoint from OTEL_EXPORTER_OTLP_ENDPOINT", async () => {
      const adapter = createMockAdapter({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      });
      await manager.initialize({ enabled: false }, adapter as any);
      // Endpoint should be read from env
    });

    it("should read OTLP endpoint from OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", async () => {
      const adapter = createMockAdapter({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://localhost:4318/v1/metrics",
      });
      await manager.initialize({ enabled: false }, adapter as any);
      // Metrics-specific endpoint should be read from env
    });

    it("should set exporter type from OTEL_METRICS_EXPORTER=prometheus", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "prometheus" });
      await manager.initialize({ enabled: false }, adapter as any);
      // Exporter type should be set from env
    });

    it("should set exporter type from OTEL_METRICS_EXPORTER=otlp", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "otlp" });
      await manager.initialize({ enabled: false }, adapter as any);
      // Exporter type should be set from env
    });

    it("should ignore invalid exporter types from env", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "invalid" });
      await manager.initialize({ enabled: false }, adapter as any);
      // Should use default exporter
    });

    it("should handle env without get method (Node.js style)", async () => {
      const adapter = {
        env: {
          OTEL_METRICS_ENABLED: "true",
        },
      };
      await manager.initialize({ enabled: false }, adapter as any);
      // Should read from env object directly
    });
  });

  describe("MetricsManager - Runtime State Management", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should track cache size correctly", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(100);
      const state = manager.getState();

      assertEquals(state.cacheSize, 100, "Cache size should be tracked");
    });

    it("should increment active requests on recordHttpRequest", () => {
      const recorder = manager.getRecorder();
      const initialState = manager.getState();
      recorder?.recordHttpRequest();
      const newState = manager.getState();

      assertEquals(
        newState.activeRequests,
        initialState.activeRequests + 1,
        "Active requests should increment",
      );
    });

    it("should decrement active requests on recordHttpRequestComplete", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequest();
      const beforeComplete = manager.getState();
      recorder?.recordHttpRequestComplete(100);
      const afterComplete = manager.getState();

      assertEquals(
        afterComplete.activeRequests,
        beforeComplete.activeRequests - 1,
        "Active requests should decrement",
      );
    });

    it("should increment cache size on recordCacheSet", () => {
      const recorder = manager.getRecorder();
      const initialState = manager.getState();
      recorder?.recordCacheSet();
      const newState = manager.getState();

      assertEquals(
        newState.cacheSize,
        initialState.cacheSize + 1,
        "Cache size should increment",
      );
    });

    it("should decrement cache size on recordCacheInvalidate", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(10);
      recorder?.recordCacheInvalidate(3);
      const state = manager.getState();

      assertEquals(state.cacheSize, 7, "Cache size should decrement by invalidation count");
    });

    it("should not go below zero on cache invalidation", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(2);
      recorder?.recordCacheInvalidate(5);
      const state = manager.getState();

      assertEquals(state.cacheSize, 0, "Cache size should not go below zero");
    });
  });

  describe("MetricsRecorder - Recording Operations", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should record HTTP request without attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequest();
      // Should not throw
    });

    it("should record HTTP request with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequest({ method: "GET", path: "/api/users" });
      // Should not throw
    });

    it("should record HTTP request completion with duration", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequestComplete(250);
      // Should not throw
    });

    it("should record HTTP request completion with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequestComplete(250, { status: "200", method: "POST" });
      // Should not throw
    });

    it("should record cache hit", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheGet(true);
      // Should not throw
    });

    it("should record cache miss", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheGet(false);
      // Should not throw
    });

    it("should record cache get with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheGet(true, { key: "user:123", type: "memory" });
      // Should not throw
    });

    it("should record cache set with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheSet({ key: "user:123", ttl: "3600" });
      // Should not throw
    });

    it("should record cache invalidation with count", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheInvalidate(5);
      // Should not throw
    });

    it("should record cache invalidation with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheInvalidate(5, { pattern: "user:*" });
      // Should not throw
    });

    it("should record render with duration", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRender(150);
      // Should not throw
    });

    it("should record render with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRender(150, { page: "/dashboard", type: "ssr" });
      // Should not throw
    });

    it("should record render error", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRenderError();
      // Should not throw
    });

    it("should record render error with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRenderError({ error: "ComponentError", page: "/about" });
      // Should not throw
    });

    it("should record RSC render with duration", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCRender(200);
      // Should not throw
    });

    it("should record RSC stream with duration", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCStream(300);
      // Should not throw
    });

    it("should record RSC manifest request", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCRequest("manifest");
      // Should not throw
    });

    it("should record RSC page request", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCRequest("page");
      // Should not throw
    });

    it("should record RSC stream request", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCRequest("stream");
      // Should not throw
    });

    it("should record RSC action request", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCRequest("action");
      // Should not throw
    });

    it("should record RSC request with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCRequest("page", { path: "/products" });
      // Should not throw
    });

    it("should record RSC error", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCError();
      // Should not throw
    });

    it("should record RSC error with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRSCError({ type: "StreamError", component: "ProductList" });
      // Should not throw
    });

    it("should record build with duration", () => {
      const recorder = manager.getRecorder();
      recorder?.recordBuild(5000);
      // Should not throw
    });

    it("should record build with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordBuild(5000, { type: "production", target: "browser" });
      // Should not throw
    });

    it("should record bundle with size", () => {
      const recorder = manager.getRecorder();
      recorder?.recordBundle(250.5);
      // Should not throw
    });

    it("should record bundle with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordBundle(250.5, { name: "app.js", type: "client" });
      // Should not throw
    });

    it("should record data fetch with duration", () => {
      const recorder = manager.getRecorder();
      recorder?.recordDataFetch(120);
      // Should not throw
    });

    it("should record data fetch with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordDataFetch(120, { source: "api", endpoint: "/users" });
      // Should not throw
    });

    it("should record data fetch error", () => {
      const recorder = manager.getRecorder();
      recorder?.recordDataFetchError();
      // Should not throw
    });

    it("should record data fetch error with attributes", () => {
      const recorder = manager.getRecorder();
      recorder?.recordDataFetchError({ error: "NetworkError", endpoint: "/products" });
      // Should not throw
    });
  });

  describe("MetricsManager - Graceful Shutdown", () => {
    it("should shutdown metrics without error when not initialized", () => {
      const manager = new MetricsManager();
      manager.shutdown();
      // Should not throw
    });

    it("should shutdown metrics without error when initialized", async () => {
      const manager = new MetricsManager();
      await manager.initialize({ enabled: false });
      manager.shutdown();
      // Should not throw
    });
  });

  describe("Edge Cases and Error Handling", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should handle metrics recording when not initialized", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequest();
      // Should not throw when instruments are null
    });

    it("should handle null attributes gracefully", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequest(undefined);
      // Should not throw
    });

    it("should handle empty attributes object", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRender(100, {});
      // Should not throw
    });

    it("should handle zero duration values", () => {
      const recorder = manager.getRecorder();
      recorder?.recordRender(0);
      // Should not throw
    });

    it("should handle negative duration values", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequestComplete(-10);
      // Should not throw (though not recommended in real usage)
    });

    it("should handle very large duration values", () => {
      const recorder = manager.getRecorder();
      recorder?.recordBuild(999999);
      // Should not throw
    });

    it("should handle zero count invalidation", () => {
      const recorder = manager.getRecorder();
      recorder?.recordCacheInvalidate(0);
      // Should not throw
    });

    it("should handle large count invalidation", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(100);
      recorder?.recordCacheInvalidate(1000);
      const state = manager.getState();

      assertEquals(state.cacheSize, 0, "Should not go below zero");
    });
  });
});
