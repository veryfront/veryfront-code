import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MetricsManager } from "./manager.ts";
import {
  _resetShimForTests,
  type Meter,
  setGlobalMetricsAPI,
} from "#veryfront/observability/tracing/api-shim.ts";

describe("observability/metrics/manager", () => {
  let manager: MetricsManager;

  beforeEach(() => {
    _resetShimForTests();
    manager = new MetricsManager();
  });

  afterEach(() => {
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

    it("retries enabled initialization after the metrics API is registered", async () => {
      await manager.initialize({ enabled: true });
      assertEquals(manager.isEnabled(), false);

      const instrument = {
        add() {},
        record() {},
        addCallback() {},
      };
      const meter = {
        createCounter: () => instrument,
        createHistogram: () => instrument,
        createUpDownCounter: () => instrument,
        createObservableGauge: () => instrument,
      } as unknown as Meter;
      setGlobalMetricsAPI({ getMeter: () => meter });
      await manager.initialize({ enabled: false });

      assertEquals(manager.isEnabled(), true);
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
    it("should not throw when not initialized", () => {
      manager.shutdown();
    });

    it("should not throw when initialized", async () => {
      await manager.initialize({ enabled: false });

      manager.shutdown();
    });

    it("resets state and permits reinitialization", async () => {
      await manager.initialize({ enabled: false });
      manager.shutdown();

      assertEquals(manager.getState(), {
        initialized: false,
        cacheSize: 0,
        activeRequests: 0,
      });

      await manager.initialize({ enabled: false });
      assertEquals(manager.getState().initialized, true);
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
