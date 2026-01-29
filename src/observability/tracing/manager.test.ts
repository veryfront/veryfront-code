import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { TracingManager } from "./manager.ts";

describe("observability/tracing/manager", () => {
  let manager: TracingManager;

  beforeEach(() => {
    manager = new TracingManager();
  });

  describe("initial state", () => {
    it("should not be enabled before initialization", () => {
      assertEquals(manager.isEnabled(), false);
    });

    it("should not be degraded before initialization", () => {
      assertEquals(manager.isDegraded(), false);
    });

    it("should return null for span operations", () => {
      assertEquals(manager.getSpanOperations(), null);
    });

    it("should return null for context propagation", () => {
      assertEquals(manager.getContextPropagation(), null);
    });

    it("should return uninitialized state", () => {
      const state = manager.getState();
      assertEquals(state.initialized, false);
      assertEquals(state.degraded, false);
      assertEquals(state.tracer, null);
      assertEquals(state.api, null);
      assertEquals(state.propagator, null);
    });
  });

  describe("initialize", () => {
    it("should mark as initialized with disabled config", async () => {
      await manager.initialize({ enabled: false });
      const state = manager.getState();
      assertEquals(state.initialized, true);
      assertEquals(manager.isEnabled(), false);
    });

    it("should skip duplicate initialization", async () => {
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true }); // Should be skipped
      assertEquals(manager.isEnabled(), false); // Still disabled from first init
    });

    it("should accept empty config", async () => {
      await manager.initialize({});
      assertEquals(manager.getState().initialized, true);
    });

    it("should accept all config options", async () => {
      await manager.initialize({
        enabled: false,
        exporter: "otlp",
        endpoint: "http://localhost:4318",
        serviceName: "test-service",
        sampleRate: 0.5,
        debug: true,
      });
      assertEquals(manager.getState().initialized, true);
    });

    it("should accept config with adapter", async () => {
      const mockAdapter = {
        env: {
          get: (key: string) => {
            if (key === "OTEL_TRACES_ENABLED") return "false";
            return undefined;
          },
        },
      } as never;
      await manager.initialize({ enabled: false }, mockAdapter);
      assertEquals(manager.getState().initialized, true);
    });
  });

  describe("isEnabled", () => {
    it("should return false when not initialized", () => {
      assertEquals(manager.isEnabled(), false);
    });

    it("should return false when disabled", async () => {
      await manager.initialize({ enabled: false });
      assertEquals(manager.isEnabled(), false);
    });
  });

  describe("isDegraded", () => {
    it("should return false by default", () => {
      assertEquals(manager.isDegraded(), false);
    });

    it("should return false when disabled config", async () => {
      await manager.initialize({ enabled: false });
      assertEquals(manager.isDegraded(), false);
    });
  });

  describe("shutdown", () => {
    it("should not throw when not initialized", () => {
      manager.shutdown();
      // No error
    });

    it("should not throw when called after initialization", async () => {
      await manager.initialize({ enabled: false });
      manager.shutdown();
      // No error
    });

    it("should be idempotent", async () => {
      await manager.initialize({ enabled: false });
      manager.shutdown();
      manager.shutdown();
      // No error
    });
  });

  describe("getState", () => {
    it("should reflect initialization status", async () => {
      assertEquals(manager.getState().initialized, false);
      await manager.initialize({});
      assertEquals(manager.getState().initialized, true);
    });

    it("should return state snapshot", () => {
      const state1 = manager.getState();
      const state2 = manager.getState();
      assertEquals(state1.initialized, state2.initialized);
      assertEquals(state1.degraded, state2.degraded);
    });
  });
});
