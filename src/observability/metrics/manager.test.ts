import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MetricsManager } from "./manager.ts";

describe("observability/metrics/manager", () => {
  let manager: MetricsManager;

  beforeEach(() => {
    manager = new MetricsManager();
  });

  describe("initial state", () => {
    it("should not be enabled before initialization", () => {
      assertEquals(manager.isEnabled(), false);
    });

    it("should return a recorder even before initialization", () => {
      const recorder = manager.getRecorder();
      assertExists(recorder);
    });

    it("should return initial state", () => {
      const state = manager.getState();
      assertEquals(state.initialized, false);
      assertEquals(state.cacheSize, 0);
      assertEquals(state.activeRequests, 0);
    });
  });

  describe("initialize", () => {
    it("should initialize with disabled config", async () => {
      await manager.initialize({ enabled: false });
      assertEquals(manager.isEnabled(), false);
      const state = manager.getState();
      assertEquals(state.initialized, true);
    });

    it("should skip duplicate initialization", async () => {
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true }); // Should be skipped
      assertEquals(manager.isEnabled(), false); // Still disabled from first init
    });

    it("should accept empty config", async () => {
      await manager.initialize({});
      const state = manager.getState();
      assertEquals(state.initialized, true);
    });

    it("should accept partial config", async () => {
      await manager.initialize({ prefix: "custom" });
      const state = manager.getState();
      assertEquals(state.initialized, true);
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
      // Should not throw
    });

    it("should not throw when initialized", async () => {
      await manager.initialize({ enabled: false });
      manager.shutdown();
      // Should not throw
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
      const after = manager.getRecorder();
      assertEquals(before, after);
    });
  });
});
