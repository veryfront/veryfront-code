import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
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
      installGlobalTelemetryAPI({ tracerProvider: createProvider("A", []) });
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true, serviceName: "second" });
      assertEquals(manager.isEnabled(), false, "a duplicate initialize must not enable tracing");
      assertEquals(
        manager.getState().api,
        null,
        "a duplicate initialize must not build a tracer runtime",
      );
      assertEquals(
        manager.getState().tracer,
        null,
        "a duplicate initialize must not create a tracer",
      );
    });

    it("shares one readiness promise across concurrent initialization", async () => {
      installGlobalTelemetryAPI({ tracerProvider: createProvider("A", []) });

      const first = manager.initialize({ enabled: true, serviceName: "test" });
      const second = manager.initialize({ enabled: true, serviceName: "ignored" });

      assertStrictEquals(second, first);
      await first;
      assertEquals(manager.getState().initialized, true);
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

    it("reports degraded mode instead of throwing when a provider's getTracer fails", async () => {
      installGlobalTelemetryAPI({ tracerProvider: createProvider("A", []) });
      await manager.initialize({ enabled: true, serviceName: "test" });
      assertEquals(manager.isEnabled(), true, "a healthy provider enables tracing");

      installGlobalTelemetryAPI({
        tracerProvider: {
          getTracer: () => {
            throw new Error("provider failed");
          },
        },
      });

      assertEquals(
        manager.isEnabled(),
        false,
        "a failing getTracer must not report tracing as enabled",
      );
      assertEquals(manager.getSpanOperations(), null, "a failed refresh clears span operations");
      assertEquals(
        manager.getContextPropagation(),
        null,
        "a failed refresh clears context propagation",
      );
      assertEquals(manager.isDegraded(), true, "a failing getTracer must be reported as degraded");
    });
  });

  describe("shutdown", () => {
    it("prevents an in-flight initialization from restoring stale state", async () => {
      installGlobalTelemetryAPI({ tracerProvider: createProvider("A", []) });

      const initializing = manager.initialize({ enabled: true, serviceName: "test" });
      manager.shutdown();
      await initializing;

      assertEquals(manager.getState(), {
        initialized: false,
        degraded: false,
        tracer: null,
        api: null,
        propagator: null,
      });
      assertEquals(manager.getSpanOperations(), null);
    });

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
      state1.initialized = true;
      assertEquals(manager.getState().initialized, false);
    });
  });
});
