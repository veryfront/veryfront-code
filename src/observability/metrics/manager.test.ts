import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { metricsManager } from "./manager.ts";

describe("metrics/manager", () => {
  beforeEach(() => {
    // Reset state by calling shutdown if available
    metricsManager.shutdown();
  });

  describe("initialization", () => {
    it("should initialize with default config", async () => {
      await metricsManager.initialize({});
      const state = metricsManager.getState();
      assertEquals(state.initialized, true);
    });

    it("should not reinitialize when already initialized", async () => {
      await metricsManager.initialize({ enabled: false });
      await metricsManager.initialize({ enabled: false });
      const state = metricsManager.getState();
      assertEquals(state.initialized, true);
    });

    it("should provide recorder", async () => {
      await metricsManager.initialize({});
      const recorder = metricsManager.getRecorder();
      assertExists(recorder);
    });
  });

  describe("isEnabled", () => {
    it("should return boolean", async () => {
      await metricsManager.initialize({ enabled: false });
      const enabled = metricsManager.isEnabled();
      assertEquals(typeof enabled, "boolean");
    });
  });

  describe("getState", () => {
    it("should return state object", async () => {
      await metricsManager.initialize({});
      const state = metricsManager.getState();

      assertExists(state);
      assertEquals(typeof state.initialized, "boolean");
      assertEquals(typeof state.cacheSize, "number");
      assertEquals(typeof state.activeRequests, "number");
    });

    it("should track cache size", async () => {
      await metricsManager.initialize({});
      const state = metricsManager.getState();
      assertEquals(state.cacheSize, 0);
    });

    it("should track active requests", async () => {
      await metricsManager.initialize({});
      const state = metricsManager.getState();
      assertEquals(state.activeRequests, 0);
    });
  });

  describe("shutdown", () => {
    it("should not throw when shutting down", () => {
      metricsManager.shutdown();
    });
  });
});
