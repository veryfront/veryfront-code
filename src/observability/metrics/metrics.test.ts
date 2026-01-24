import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MetricsManager } from "./manager.ts";

function createMockAdapter(
  envVars: Record<string, string> = {},
): { env: { get: (key: string) => string | undefined } } {
  return {
    env: {
      get: (key: string) => envVars[key],
    },
  };
}

async function assertExportedFunction(name: string): Promise<void> {
  const mod = await import("./index.ts");
  const value = (mod as Record<string, unknown>)[name];
  assertExists(value, `${name} should be exported`);
  assertEquals(typeof value, "function", "Should be a function");
}

describe("Metrics Module", () => {
  describe("Module Exports", () => {
    it("should export initMetrics function", () => assertExportedFunction("initMetrics"));
    it("should export isMetricsEnabled function", () => assertExportedFunction("isMetricsEnabled"));
    it("should export getMetricsState function", () => assertExportedFunction("getMetricsState"));
    it("should export shutdownMetrics function", () => assertExportedFunction("shutdownMetrics"));

    it("should export MetricsManager class", async () => {
      const { MetricsManager } = await import("./index.ts");
      assertExists(MetricsManager, "MetricsManager should be exported");
      assertEquals(typeof MetricsManager, "function", "Should be a class");
    });
  });

  describe("HTTP Metrics Functions", () => {
    it("should export recordHttpRequest function", () =>
      assertExportedFunction("recordHttpRequest"));
    it("should export recordHttpRequestComplete function", () =>
      assertExportedFunction("recordHttpRequestComplete"));
  });

  describe("Cache Metrics Functions", () => {
    it("should export recordCacheGet function", () => assertExportedFunction("recordCacheGet"));
    it("should export recordCacheSet function", () => assertExportedFunction("recordCacheSet"));
    it("should export recordCacheInvalidate function", () =>
      assertExportedFunction("recordCacheInvalidate"));
    it("should export setCacheSize function", () => assertExportedFunction("setCacheSize"));
  });

  describe("Render Metrics Functions", () => {
    it("should export recordRender function", () => assertExportedFunction("recordRender"));
    it("should export recordRenderError function", () =>
      assertExportedFunction("recordRenderError"));
  });

  describe("RSC Metrics Functions", () => {
    it("should export recordRSCRender function", () => assertExportedFunction("recordRSCRender"));
    it("should export recordRSCStream function", () => assertExportedFunction("recordRSCStream"));
    it("should export recordRSCRequest function", () => assertExportedFunction("recordRSCRequest"));
    it("should export recordRSCError function", () => assertExportedFunction("recordRSCError"));
  });

  describe("Build Metrics Functions", () => {
    it("should export recordBuild function", () => assertExportedFunction("recordBuild"));
    it("should export recordBundle function", () => assertExportedFunction("recordBundle"));
  });

  describe("Data Fetching Metrics Functions", () => {
    it("should export recordDataFetch function", () => assertExportedFunction("recordDataFetch"));
    it("should export recordDataFetchError function", () =>
      assertExportedFunction("recordDataFetchError"));
  });

  describe("MetricsManager - Initialization", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should handle disabled metrics with enabled=false", async () => {
      await manager.initialize({ enabled: false });
      assertEquals(manager.isEnabled(), false, "Metrics should be disabled when enabled=false");
    });

    it("should mark as initialized even when disabled", async () => {
      await manager.initialize({ enabled: false });
      assert(manager.getState().initialized, "Should mark as initialized even when disabled");
    });

    it("should skip duplicate initialization attempts", async () => {
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true });
      assertEquals(manager.isEnabled(), false);
    });

    it("should accept partial config", async () => {
      await manager.initialize({ enabled: false, prefix: "custom-prefix" });
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
    });

    it("should read config via VERYFRONT_OTEL=1", async () => {
      const adapter = createMockAdapter({ VERYFRONT_OTEL: "1" });
      await manager.initialize({ enabled: false }, adapter as any);
    });

    it("should read OTLP endpoint from OTEL_EXPORTER_OTLP_ENDPOINT", async () => {
      const adapter = createMockAdapter({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" });
      await manager.initialize({ enabled: false }, adapter as any);
    });

    it("should read OTLP endpoint from OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", async () => {
      const adapter = createMockAdapter({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://localhost:4318/v1/metrics",
      });
      await manager.initialize({ enabled: false }, adapter as any);
    });

    it("should set exporter type from OTEL_METRICS_EXPORTER=prometheus", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "prometheus" });
      await manager.initialize({ enabled: false }, adapter as any);
    });

    it("should set exporter type from OTEL_METRICS_EXPORTER=otlp", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "otlp" });
      await manager.initialize({ enabled: false }, adapter as any);
    });

    it("should ignore invalid exporter types from env", async () => {
      const adapter = createMockAdapter({ OTEL_METRICS_EXPORTER: "invalid" });
      await manager.initialize({ enabled: false }, adapter as any);
    });

    it("should handle env without get method (Node.js style)", async () => {
      const adapter = { env: { OTEL_METRICS_ENABLED: "true" } };
      await manager.initialize({ enabled: false }, adapter as any);
    });
  });

  describe("MetricsManager - Runtime State Management", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should track cache size correctly", () => {
      manager.getRecorder()?.setCacheSize(100);
      assertEquals(manager.getState().cacheSize, 100, "Cache size should be tracked");
    });

    it("should increment active requests on recordHttpRequest", () => {
      const recorder = manager.getRecorder();
      const initial = manager.getState().activeRequests;
      recorder?.recordHttpRequest();
      assertEquals(
        manager.getState().activeRequests,
        initial + 1,
        "Active requests should increment",
      );
    });

    it("should decrement active requests on recordHttpRequestComplete", () => {
      const recorder = manager.getRecorder();
      recorder?.recordHttpRequest();
      const before = manager.getState().activeRequests;
      recorder?.recordHttpRequestComplete(100);
      assertEquals(
        manager.getState().activeRequests,
        before - 1,
        "Active requests should decrement",
      );
    });

    it("should increment cache size on recordCacheSet", () => {
      const recorder = manager.getRecorder();
      const initial = manager.getState().cacheSize;
      recorder?.recordCacheSet();
      assertEquals(manager.getState().cacheSize, initial + 1, "Cache size should increment");
    });

    it("should decrement cache size on recordCacheInvalidate", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(10);
      recorder?.recordCacheInvalidate(3);
      assertEquals(
        manager.getState().cacheSize,
        7,
        "Cache size should decrement by invalidation count",
      );
    });

    it("should not go below zero on cache invalidation", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(2);
      recorder?.recordCacheInvalidate(5);
      assertEquals(manager.getState().cacheSize, 0, "Cache size should not go below zero");
    });
  });

  describe("MetricsRecorder - Recording Operations", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should record HTTP request without attributes", () => {
      manager.getRecorder()?.recordHttpRequest();
    });

    it("should record HTTP request with attributes", () => {
      manager.getRecorder()?.recordHttpRequest({ method: "GET", path: "/api/users" });
    });

    it("should record HTTP request completion with duration", () => {
      manager.getRecorder()?.recordHttpRequestComplete(250);
    });

    it("should record HTTP request completion with attributes", () => {
      manager.getRecorder()?.recordHttpRequestComplete(250, { status: "200", method: "POST" });
    });

    it("should record cache hit", () => {
      manager.getRecorder()?.recordCacheGet(true);
    });

    it("should record cache miss", () => {
      manager.getRecorder()?.recordCacheGet(false);
    });

    it("should record cache get with attributes", () => {
      manager.getRecorder()?.recordCacheGet(true, { key: "user:123", type: "memory" });
    });

    it("should record cache set with attributes", () => {
      manager.getRecorder()?.recordCacheSet({ key: "user:123", ttl: "3600" });
    });

    it("should record cache invalidation with count", () => {
      manager.getRecorder()?.recordCacheInvalidate(5);
    });

    it("should record cache invalidation with attributes", () => {
      manager.getRecorder()?.recordCacheInvalidate(5, { pattern: "user:*" });
    });

    it("should record render with duration", () => {
      manager.getRecorder()?.recordRender(150);
    });

    it("should record render with attributes", () => {
      manager.getRecorder()?.recordRender(150, { page: "/dashboard", type: "ssr" });
    });

    it("should record render error", () => {
      manager.getRecorder()?.recordRenderError();
    });

    it("should record render error with attributes", () => {
      manager.getRecorder()?.recordRenderError({ error: "ComponentError", page: "/about" });
    });

    it("should record RSC render with duration", () => {
      manager.getRecorder()?.recordRSCRender(200);
    });

    it("should record RSC stream with duration", () => {
      manager.getRecorder()?.recordRSCStream(300);
    });

    it("should record RSC manifest request", () => {
      manager.getRecorder()?.recordRSCRequest("manifest");
    });

    it("should record RSC page request", () => {
      manager.getRecorder()?.recordRSCRequest("page");
    });

    it("should record RSC stream request", () => {
      manager.getRecorder()?.recordRSCRequest("stream");
    });

    it("should record RSC action request", () => {
      manager.getRecorder()?.recordRSCRequest("action");
    });

    it("should record RSC request with attributes", () => {
      manager.getRecorder()?.recordRSCRequest("page", { path: "/products" });
    });

    it("should record RSC error", () => {
      manager.getRecorder()?.recordRSCError();
    });

    it("should record RSC error with attributes", () => {
      manager.getRecorder()?.recordRSCError({ type: "StreamError", component: "ProductList" });
    });

    it("should record build with duration", () => {
      manager.getRecorder()?.recordBuild(5000);
    });

    it("should record build with attributes", () => {
      manager.getRecorder()?.recordBuild(5000, { type: "production", target: "browser" });
    });

    it("should record bundle with size", () => {
      manager.getRecorder()?.recordBundle(250.5);
    });

    it("should record bundle with attributes", () => {
      manager.getRecorder()?.recordBundle(250.5, { name: "app.js", type: "client" });
    });

    it("should record data fetch with duration", () => {
      manager.getRecorder()?.recordDataFetch(120);
    });

    it("should record data fetch with attributes", () => {
      manager.getRecorder()?.recordDataFetch(120, { source: "api", endpoint: "/users" });
    });

    it("should record data fetch error", () => {
      manager.getRecorder()?.recordDataFetchError();
    });

    it("should record data fetch error with attributes", () => {
      manager.getRecorder()?.recordDataFetchError({ error: "NetworkError", endpoint: "/products" });
    });
  });

  describe("MetricsManager - Graceful Shutdown", () => {
    it("should shutdown metrics without error when not initialized", () => {
      new MetricsManager().shutdown();
    });

    it("should shutdown metrics without error when initialized", async () => {
      const manager = new MetricsManager();
      await manager.initialize({ enabled: false });
      manager.shutdown();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    let manager: MetricsManager;

    beforeEach(() => {
      manager = new MetricsManager();
    });

    it("should handle metrics recording when not initialized", () => {
      manager.getRecorder()?.recordHttpRequest();
    });

    it("should handle null attributes gracefully", () => {
      manager.getRecorder()?.recordHttpRequest(undefined);
    });

    it("should handle empty attributes object", () => {
      manager.getRecorder()?.recordRender(100, {});
    });

    it("should handle zero duration values", () => {
      manager.getRecorder()?.recordRender(0);
    });

    it("should handle negative duration values", () => {
      manager.getRecorder()?.recordHttpRequestComplete(-10);
    });

    it("should handle very large duration values", () => {
      manager.getRecorder()?.recordBuild(999999);
    });

    it("should handle zero count invalidation", () => {
      manager.getRecorder()?.recordCacheInvalidate(0);
    });

    it("should handle large count invalidation", () => {
      const recorder = manager.getRecorder();
      recorder?.setCacheSize(100);
      recorder?.recordCacheInvalidate(1000);
      assertEquals(manager.getState().cacheSize, 0, "Should not go below zero");
    });
  });
});
