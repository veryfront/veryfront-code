import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type Context,
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  getGlobalMetricsAPI,
  getGlobalTelemetryAPISnapshot,
  getGlobalTracerProvider,
  getMetricsApiRevision,
  getTracer,
  getTracerProviderRevision,
  installGlobalTelemetryAPI,
  type MetricsAPI,
  propagation,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalMetricsAPI,
  setGlobalTracerProvider,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TextMapPropagator,
  trace,
  type Tracer,
  type TracerProvider,
} from "./api-shim.ts";

describe("observability/tracing/api-shim", () => {
  afterEach(() => {
    // Restore global shim state so tests don't leak into each other.
    _resetShimForTests();
  });

  describe("no-op defaults (extension not installed)", () => {
    it("getTracer returns a no-op tracer whose spans are inert but chainable", () => {
      const tracer = getTracer("test", "1.0");
      const span = tracer.startSpan("op");

      // All mutators are chainable no-ops and never throw.
      assertEquals(span.setAttribute("k", "v"), span);
      assertEquals(span.setAttributes({ a: 1 }), span);
      assertEquals(span.setStatus({ code: SpanStatusCode.OK }), span);
      assertEquals(span.addEvent("evt"), span);
      span.recordException(new Error("x"));
      span.updateName("renamed");
      span.end();

      // The no-op span context has all-zero ids.
      const ctx = span.spanContext();
      assertEquals(ctx.traceId, "00000000000000000000000000000000");
      assertEquals(ctx.spanId, "0000000000000000");
      assertEquals(ctx.traceFlags, 0);
    });

    it("startActiveSpan invokes the callback with a span (fn-as-2nd-arg form)", () => {
      const tracer = getTracer("test");
      let received: Span | undefined;
      const result = tracer.startActiveSpan("op", (span) => {
        received = span;
        return 42;
      });
      assertEquals(result, 42);
      assertExists(received);
    });

    it("startActiveSpan invokes the callback in the options + fn form", () => {
      const tracer = getTracer("test");
      const result = tracer.startActiveSpan("op", { kind: SpanKind.SERVER }, (span) => {
        span.setAttribute("k", "v");
        return "done";
      });
      assertEquals(result, "done");
    });

    it("trace.getActiveSpan / getSpan return undefined with no accessor wired", () => {
      assertEquals(trace.getActiveSpan(), undefined);
      assertEquals(trace.getSpan(context.active()), undefined);
    });
  });

  describe("global tracer provider", () => {
    it("setGlobalTracerProvider swaps the provider used by getTracer", () => {
      const calls: Array<[string, string | undefined]> = [];
      const fakeTracer = { startSpan: () => ({}) as Span } as unknown as Tracer;
      const provider: TracerProvider = {
        getTracer(name, version) {
          calls.push([name, version]);
          return fakeTracer;
        },
      };

      setGlobalTracerProvider(provider);
      assertEquals(getGlobalTracerProvider(), provider);
      assertEquals(getTracer("svc", "2.0"), fakeTracer);
      assertEquals(trace.getTracer("svc2"), fakeTracer);
      assertEquals(calls, [["svc", "2.0"], ["svc2", undefined]]);
    });

    it("_resetShimForTests restores the no-op provider", () => {
      setGlobalTracerProvider({ getTracer: () => ({}) as Tracer });
      _resetShimForTests();
      // Back to the no-op tracer, whose span has zero ids.
      const span = getGlobalTracerProvider().getTracer("x").startSpan("s");
      assertEquals(span.spanContext().traceId, "00000000000000000000000000000000");
    });
  });

  describe("atomic global telemetry API", () => {
    it("installs and clears one complete provider generation atomically", () => {
      const tracerProvider = { getTracer: () => getTracer("fallback") };
      const metricsApi = { getMeter: () => ({}) } as unknown as MetricsAPI;
      const owner = installGlobalTelemetryAPI({ tracerProvider, metricsApi });

      const installed = getGlobalTelemetryAPISnapshot();
      assertEquals(installed.generation, owner.generation);
      assertEquals(installed.tracerProvider, tracerProvider);
      assertEquals(installed.metricsApi, metricsApi);

      assertEquals(owner.dispose(), true);
      assertEquals(owner.dispose(), false);
      const cleared = getGlobalTelemetryAPISnapshot();
      assertEquals(cleared.generation > owner.generation, true);
      assertEquals(cleared.metricsApi, null);
      assertEquals(
        cleared.tracerProvider.getTracer("cleared").startSpan("span").spanContext().traceId,
        "00000000000000000000000000000000",
      );
    });

    it("increments both revisions for every explicit install of stable facades", () => {
      const tracerProvider = { getTracer: () => getTracer("fallback") };
      const metricsApi = { getMeter: () => ({}) } as unknown as MetricsAPI;
      const tracerRevision = getTracerProviderRevision();
      const metricsRevision = getMetricsApiRevision();

      installGlobalTelemetryAPI({ tracerProvider, metricsApi });
      installGlobalTelemetryAPI({ tracerProvider, metricsApi });

      assertEquals(getTracerProviderRevision(), tracerRevision + 2);
      assertEquals(getMetricsApiRevision(), metricsRevision + 2);
    });

    it("does not let a stale owner clear a newer provider generation", () => {
      const first = installGlobalTelemetryAPI({});
      const secondProvider = { getTracer: () => getTracer("fallback") };
      const second = installGlobalTelemetryAPI({ tracerProvider: secondProvider });

      assertEquals(first.dispose(), false);
      assertEquals(getGlobalTracerProvider(), secondProvider);
      assertEquals(getGlobalTelemetryAPISnapshot().generation, second.generation);
    });

    it("pre-reads the complete install input before changing global state", () => {
      const original = getGlobalTelemetryAPISnapshot();
      const input = {
        get tracerProvider(): TracerProvider {
          return { getTracer: () => getTracer("fallback") };
        },
        get metricsApi(): MetricsAPI {
          throw new Error("hostile metrics getter");
        },
      };

      let threw = false;
      try {
        installGlobalTelemetryAPI(input);
      } catch {
        threw = true;
      }

      assertEquals(threw, true);
      const after = getGlobalTelemetryAPISnapshot();
      assertEquals(after.generation, original.generation);
      assertEquals(after.tracerProvider, original.tracerProvider);
      assertEquals(after.metricsApi, original.metricsApi);
    });
  });

  describe("active-span accessor", () => {
    it("returns real spans once an accessor is wired", () => {
      const real = { updateName() {} } as unknown as Span;
      setGlobalActiveSpanAccessor({
        getActiveSpan: () => real,
        getSpan: () => real,
        setSpan: (ctx) => ctx,
      });
      assertEquals(trace.getActiveSpan(), real);
      assertEquals(trace.getSpan(context.active()), real);
    });

    it("stores spans in shim context when no SDK accessor is wired", () => {
      const real = { updateName() {} } as unknown as Span;
      const scoped = trace.setSpan(context.active(), real);

      assertEquals(trace.getSpan(scoped), real);
      assertEquals(context.with(scoped, () => trace.getActiveSpan()), real);
    });
  });

  describe("context API", () => {
    // A minimal, hand-rolled Context that is a NEW object reference distinct
    // from the no-op `context.active()`. The no-op Context.setValue returns
    // `this`, so deriving a "scoped" context via setValue would yield the same
    // singleton — making any identity assertion tautological. Building a fresh
    // object lets us prove `context.with` actually swaps and restores the
    // active context.
    function makeScopedContext(): Context {
      const store = new Map<symbol, unknown>();
      const ctx: Context = {
        getValue: (key) => store.get(key),
        setValue: (key, value) => {
          store.set(key, value);
          return ctx;
        },
        deleteValue: (key) => {
          store.delete(key);
          return ctx;
        },
      };
      return ctx;
    }

    it("derives immutable fallback contexts", () => {
      const key = Symbol("immutable-context");
      const base = context.active();
      const derived = base.setValue(key, "scoped");

      assertEquals(derived === base, false);
      assertEquals(base.getValue(key), undefined);
      assertEquals(derived.getValue(key), "scoped");

      const deleted = derived.deleteValue(key);
      assertEquals(deleted === derived, false);
      assertEquals(derived.getValue(key), "scoped");
      assertEquals(deleted.getValue(key), undefined);
    });

    it("reset installs a fresh fallback context without prior spans", () => {
      const span = { updateName() {} } as unknown as Span;
      const beforeReset = context.active();
      const scoped = trace.setSpan(beforeReset, span);
      assertEquals(trace.getSpan(scoped), span);

      _resetShimForTests();

      const afterReset = context.active();
      assertEquals(afterReset === beforeReset, false);
      assertEquals(trace.getSpan(afterReset), undefined);
    });

    it("context.with sets the active context for the duration of fn then restores it", () => {
      const base = context.active();
      const scoped = makeScopedContext();
      // Sanity: the scoped context must be a distinct reference from base.
      assertEquals(scoped === base, false);

      const inner = context.with(scoped, () => context.active());
      // Inside the callback the active context is the scoped one.
      assertEquals(inner === scoped, true);
      // Restored afterwards.
      assertEquals(context.active() === base, true);
    });

    it("context.with restores the previous context even if fn throws", () => {
      const base = context.active();
      const scoped = makeScopedContext();
      assertEquals(scoped === base, false);

      let threw = false;
      try {
        context.with(scoped, () => {
          throw new Error("boom");
        });
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
      // The finally-restore must put the original context back.
      assertEquals(context.active() === base, true);
    });

    it("restores fallback context synchronously for async callbacks", async () => {
      const base = context.active();
      const scoped = makeScopedContext();
      let synchronousContext: Context | undefined;

      const applicationPromise = context.with(scoped, async () => {
        synchronousContext = context.active();
        await Promise.resolve();
        return context.active();
      });

      assertEquals(synchronousContext === scoped, true);
      assertEquals(context.active() === base, true);
      assertEquals(await applicationPromise === base, true);
    });

    it("does not restore a stale span context when an async scope settles after reset", async () => {
      const staleSpan = { updateName() {} } as unknown as Span;
      const staleContext = trace.setSpan(context.active(), staleSpan);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = context.with(staleContext, async () => {
        await gate;
      });

      _resetShimForTests();
      const freshContext = context.active();
      release();
      await pending;

      assertEquals(context.active() === freshContext, true);
      assertEquals(trace.getActiveSpan(), undefined);
    });

    it("does not cross-contaminate overlapping fallback async scopes", async () => {
      const base = context.active();
      const first = makeScopedContext();
      const second = makeScopedContext();
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });

      const firstScope = context.with(first, () => {
        assertEquals(context.active() === first, true);
        return firstGate;
      });
      assertEquals(context.active() === base, true);
      const secondScope = context.with(second, () => {
        assertEquals(context.active() === second, true);
        return secondGate;
      });
      assertEquals(context.active() === base, true);
      releaseFirst();
      await firstScope;
      assertEquals(context.active() === base, true);

      releaseSecond();
      await secondScope;
      assertEquals(context.active() === base, true);
    });

    it("delegates active and with to a registered context accessor", () => {
      const scoped = makeScopedContext();
      let withContext: Context | null = null;
      setGlobalContextAccessor({
        active: () => scoped,
        with: (ctx, fn) => {
          withContext = ctx;
          return fn();
        },
      });

      assertEquals(context.active() === scoped, true);
      assertEquals(context.with(scoped, () => "ok"), "ok");
      assertEquals(withContext === scoped, true);
    });
  });

  describe("propagation API", () => {
    it("extract returns the context unchanged and inject is a no-op without a propagator", () => {
      const ctx = context.active();
      const carrier: Record<string, string> = {};
      assertEquals(propagation.extract(ctx, carrier), ctx);
      propagation.inject(ctx, carrier);
      assertEquals(Object.keys(carrier).length, 0);
    });

    it("delegates to a registered propagator", () => {
      const ctx = context.active();
      const injected: Record<string, string> = {};
      const propagator: TextMapPropagator = {
        inject(_c, carrier) {
          (carrier as Record<string, string>).traceparent = "abc";
        },
        extract(c) {
          return c;
        },
        fields: () => ["traceparent"],
      };
      propagation.setGlobalPropagator(propagator);
      propagation.inject(ctx, injected);
      assertEquals(injected.traceparent, "abc");
    });
  });

  describe("default TextMap getter/setter", () => {
    it("getter reads keys and values from a record carrier", () => {
      const carrier = { traceparent: "tp", baggage: "b" };
      assertEquals(defaultTextMapGetter.keys(carrier).sort(), ["baggage", "traceparent"]);
      assertEquals(defaultTextMapGetter.get(carrier, "traceparent"), "tp");
      assertEquals(defaultTextMapGetter.get(carrier, "missing"), undefined);
    });

    it("setter writes a value into a record carrier", () => {
      const carrier: Record<string, string> = {};
      defaultTextMapSetter.set(carrier, "traceparent", "tp");
      assertEquals(carrier.traceparent, "tp");
    });
  });

  describe("metrics API registry", () => {
    it("is null by default and round-trips a registered API", () => {
      assertEquals(getGlobalMetricsAPI(), null);
      const api = { getMeter: () => ({}) } as unknown as MetricsAPI;
      setGlobalMetricsAPI(api);
      assertEquals(getGlobalMetricsAPI(), api);
    });
  });

  describe("constant maps", () => {
    it("expose stable SpanKind and SpanStatusCode values", () => {
      assertEquals(SpanKind.INTERNAL, 0);
      assertEquals(SpanKind.SERVER, 1);
      assertEquals(SpanKind.CLIENT, 2);
      assertEquals(SpanStatusCode.UNSET, 0);
      assertEquals(SpanStatusCode.OK, 1);
      assertEquals(SpanStatusCode.ERROR, 2);
    });
  });
});
