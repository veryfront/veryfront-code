import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  installGlobalTelemetryAPI,
  type Meter,
  type MetricsAPI,
  type ObservableResult,
} from "#veryfront/observability/tracing/api-shim.ts";
import { MetricsManager } from "./manager.ts";

function createMetricsApi(label: string, calls: string[]): MetricsAPI {
  const instrument = (name: string) => ({
    add: () => calls.push(`${label}:${name}`),
    record: () => calls.push(`${label}:${name}`),
  });
  const meter: Meter = {
    createCounter: (name) => instrument(name),
    createUpDownCounter: (name) => instrument(name),
    createHistogram: (name) => instrument(name),
    createObservableGauge: () => {
      const callbacks = new Set<(result: ObservableResult) => void>();
      return {
        addCallback: (callback: (result: ObservableResult) => void) => callbacks.add(callback),
        removeCallback: (callback: (result: ObservableResult) => void) =>
          callbacks.delete(callback),
      };
    },
  };
  return { getMeter: () => meter };
}

describe("observability/metrics/manager", () => {
  let manager: MetricsManager;

  beforeEach(() => {
    manager = new MetricsManager();
  });

  afterEach(() => {
    manager.shutdown();
    _resetShimForTests();
  });

  describe("initial state", () => {
    it("should not be enabled before initialization", () => {
      assertEquals(manager.isEnabled(), false);
    });

    it("should return a recorder even before initialization", () => {
      assertExists(manager.getRecorder());
    });

    it("should return initial state", () => {
      assertEquals(manager.getState(), {
        initialized: false,
        cacheSize: 0,
        activeRequests: 0,
      });
    });
  });

  describe("initialize", () => {
    it("follows metrics provider A to B to none without using stale instruments", async () => {
      const calls: string[] = [];
      const providerA = installGlobalTelemetryAPI({ metricsApi: createMetricsApi("A", calls) });
      await manager.initialize({ enabled: true, prefix: "test" });
      manager.getRecorder()?.recordHttpRequest();

      const providerB = installGlobalTelemetryAPI({ metricsApi: createMetricsApi("B", calls) });
      manager.getRecorder()?.recordHttpRequest();
      assertEquals(providerA.dispose(), false);
      assertEquals(providerB.dispose(), true);
      manager.getRecorder()?.recordHttpRequest();

      assertEquals(manager.isEnabled(), false);
      assertEquals(calls, [
        "A:test.http.requests",
        "A:test.http.requests.active",
        "B:test.http.requests",
        "B:test.http.requests.active",
      ]);
    });

    it("should initialize with disabled config", async () => {
      await manager.initialize({ enabled: false });

      assertEquals(manager.isEnabled(), false);
      assertEquals(manager.getState().initialized, true);
    });

    it("should skip duplicate initialization", async () => {
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true });

      assertEquals(manager.isEnabled(), false);
    });

    it("should accept empty config", async () => {
      await manager.initialize({});

      assertEquals(manager.getState().initialized, true);
    });

    it("should accept partial config", async () => {
      await manager.initialize({ prefix: "custom" });

      assertEquals(manager.getState().initialized, true);
    });
  });

  describe("getState", () => {
    it("should reflect initialization state", async () => {
      assertEquals(manager.getState().initialized, false);

      await manager.initialize({});

      assertEquals(manager.getState().initialized, true);
    });
  });

  describe("shutdown", () => {
    it("releases the meter and instruments and permits reinitialization", async () => {
      const calls: string[] = [];
      installGlobalTelemetryAPI({ metricsApi: createMetricsApi("A", calls) });
      await manager.initialize({ enabled: true, prefix: "test" });
      manager.shutdown();

      assertEquals(manager.getState(), {
        initialized: false,
        cacheSize: 0,
        activeRequests: 0,
      });
      assertEquals(manager.isEnabled(), false);

      installGlobalTelemetryAPI({ metricsApi: createMetricsApi("B", calls) });
      await manager.initialize({ enabled: true, prefix: "test" });
      manager.getRecorder()?.recordHttpRequest();
      assertEquals(calls, ["B:test.http.requests", "B:test.http.requests.active"]);
    });

    it("should not throw when not initialized", () => {
      manager.shutdown();
    });

    it("should not throw when initialized", async () => {
      await manager.initialize({ enabled: false });

      manager.shutdown();
    });
  });

  describe("getRecorder", () => {
    it("should return a MetricsRecorder instance", () => {
      const recorder = manager.getRecorder();

      assertExists(recorder);
      assertEquals(typeof recorder.recordHttpRequest, "function");
      assertEquals(typeof recorder.recordRender, "function");
      assertEquals(typeof recorder.recordCacheGet, "function");
    });

    it("should return same recorder before and after init", async () => {
      const before = manager.getRecorder();

      await manager.initialize({ enabled: false });

      assertEquals(manager.getRecorder(), before);
    });
  });
});
