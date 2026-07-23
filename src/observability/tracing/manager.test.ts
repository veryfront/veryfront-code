import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  installGlobalTelemetryAPI,
  type Span,
  type Tracer,
  type TracerProvider,
} from "./api-shim.ts";
import { TracingManager } from "./manager.ts";

function createProvider(label: string, calls: string[]): TracerProvider {
  const span: Span = {
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => {},
    addEvent: () => span,
    end: () => {},
    spanContext: () => ({
      traceId: label.padEnd(32, "0"),
      spanId: label.padEnd(16, "0"),
      traceFlags: 1,
    }),
    updateName: () => {},
  };
  const tracer: Tracer = {
    startSpan(name) {
      calls.push(`${label}:${name}`);
      return span;
    },
    startActiveSpan: ((_name: string, ...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as (span: Span) => unknown;
      return callback(span);
    }) as Tracer["startActiveSpan"],
  };
  return { getTracer: () => tracer };
}

describe("observability/tracing/manager", () => {
  let manager: TracingManager;

  beforeEach(() => {
    manager = new TracingManager();
  });

  afterEach(() => {
    manager.shutdown();
    _resetShimForTests();
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
      assertEquals(manager.getState(), {
        initialized: false,
        degraded: false,
        tracer: null,
        api: null,
        propagator: null,
      });
    });
  });

  describe("initialize", () => {
    it("follows provider A to B to none without retaining stale span operations", async () => {
      const calls: string[] = [];
      const providerA = installGlobalTelemetryAPI({
        tracerProvider: createProvider("A", calls),
      });
      await manager.initialize({ enabled: true, serviceName: "test" });
      manager.getSpanOperations()?.startSpan("first");

      const providerB = installGlobalTelemetryAPI({
        tracerProvider: createProvider("B", calls),
      });
      manager.getSpanOperations()?.startSpan("second");
      assertEquals(providerA.dispose(), false);
      assertEquals(providerB.dispose(), true);

      assertEquals(manager.isEnabled(), false);
      assertEquals(manager.getSpanOperations(), null);
      assertEquals(calls, ["A:first", "B:second"]);
    });

    it("should mark as initialized with disabled config", async () => {
      await manager.initialize({ enabled: false });
      assertEquals(manager.getState().initialized, true);
      assertEquals(manager.isEnabled(), false);
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
          get: (key: string) => (key === "OTEL_TRACES_ENABLED" ? "false" : undefined),
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
    it("releases cached state and permits a fresh initialization", async () => {
      const calls: string[] = [];
      installGlobalTelemetryAPI({ tracerProvider: createProvider("A", calls) });
      await manager.initialize({ enabled: true, serviceName: "test" });
      const firstOperations = manager.getSpanOperations();

      manager.shutdown();

      assertEquals(manager.getState().initialized, false);
      assertEquals(manager.getSpanOperations(), null);
      installGlobalTelemetryAPI({ tracerProvider: createProvider("B", calls) });
      await manager.initialize({ enabled: true, serviceName: "test" });
      assertNotEquals(manager.getSpanOperations(), firstOperations);
      manager.getSpanOperations()?.startSpan("fresh");
      assertEquals(calls, ["B:fresh"]);
    });

    it("should not throw when not initialized", () => {
      manager.shutdown();
    });

    it("should not throw when called after initialization", async () => {
      await manager.initialize({ enabled: false });
      manager.shutdown();
    });

    it("should be idempotent", async () => {
      await manager.initialize({ enabled: false });
      manager.shutdown();
      manager.shutdown();
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
