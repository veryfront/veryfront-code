import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createOpenTelemetryServiceTracer } from "./service-tracer.ts";

type FakeContext = {
  readonly span?: FakeSpan;
};

type FakeSpanOptions = {
  childOf?: unknown;
  attributes?: Record<string, string | number | boolean>;
};

class FakeSpan {
  readonly context: { traceId: string; spanId: string };
  readonly attributes: Record<string, unknown> = {};
  status: { code: number } | null = null;
  exceptions: unknown[] = [];
  ended = false;
  throwOnSetAttribute = false;
  throwOnEnd = false;

  constructor(readonly name: string) {
    this.context = {
      traceId: `${name}-trace`,
      spanId: `${name}-span`,
    };
  }

  setAttribute(key: string, value: unknown): FakeSpan {
    if (this.throwOnSetAttribute) throw new Error("telemetry attribute failure");
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Record<string, unknown>): FakeSpan {
    for (const [key, value] of Object.entries(attributes)) {
      this.attributes[key] = value;
    }
    return this;
  }

  setStatus(status: { code: number }): FakeSpan {
    this.status = status;
    return this;
  }

  recordException(error: unknown): void {
    this.exceptions.push(error);
  }

  end(): void {
    if (this.throwOnEnd) throw new Error("telemetry end failure");
    this.ended = true;
  }

  spanContext(): { traceId: string; spanId: string } {
    return this.context;
  }
}

function createHarness() {
  let activeContext: FakeContext = {};
  const startedSpans: FakeSpan[] = [];
  const contextApi = {
    active: () => activeContext,
    with: <T>(context: FakeContext, fn: () => T): T => {
      const previous = activeContext;
      activeContext = context;
      try {
        return fn();
      } finally {
        activeContext = previous;
      }
    },
  };
  const traceApi = {
    getTracer: (_serviceName: string) => ({
      startSpan: (
        name: string,
        _options: FakeSpanOptions | undefined,
        _context: FakeContext,
      ): FakeSpan => {
        const span = new FakeSpan(name);
        startedSpans.push(span);
        return span;
      },
      startActiveSpan: <T>(name: string, fn: (span: FakeSpan) => T): T => {
        const span = new FakeSpan(name);
        startedSpans.push(span);
        return contextApi.with({ span }, () => fn(span));
      },
    }),
    setSpan: (_context: FakeContext, span: FakeSpan): FakeContext => ({ span }),
    getSpan: (context: FakeContext): FakeSpan | undefined => context.span,
  };

  return {
    contextApi,
    traceApi,
    startedSpans,
  };
}

describe("observability/tracing/service-tracer", () => {
  it("resolves the current tracer for every operation after provider transitions", () => {
    const harness = createHarness();
    const providerNames: string[] = [];
    let provider = "A";
    harness.traceApi.getTracer = () => ({
      startSpan: (name: string) => {
        providerNames.push(`${provider}:${name}`);
        return new FakeSpan(`${provider}:${name}`);
      },
      startActiveSpan: <T>(name: string, fn: (span: FakeSpan) => T): T => {
        providerNames.push(`${provider}:${name}`);
        return fn(new FakeSpan(`${provider}:${name}`));
      },
    });
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });

    serviceTracer.tracer.wrap("wrapped-a", () => undefined)();
    provider = "B";
    serviceTracer.tracer.wrap("wrapped-b", () => undefined)();
    serviceTracer.tracer.trace("traced-b", () => undefined);

    assertEquals(providerNames, ["A:wrapped-a", "B:wrapped-b", "B:traced-b"]);
  });

  it("preserves the exact promise returned by wrapped application code", async () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationPromise = Promise.resolve("application result");
    const wrapped = serviceTracer.tracer.wrap("async-operation", () => applicationPromise);

    const result = wrapped();

    assertStrictEquals(result, applicationPromise);
    assertEquals(await result, "application result");
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("preserves custom thenable identity while observing its settlement", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    let settle!: (value: string) => void;
    const thenable = {
      then(onFulfilled: (value: string) => void) {
        settle = onFulfilled;
      },
    };
    const wrapped = serviceTracer.tracer.wrap("thenable-operation", () => thenable);

    const result = wrapped();

    assertStrictEquals(result, thenable);
    assertEquals(harness.startedSpans[0]?.ended, false);
    settle("done");
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("returns objects with hostile then getters unchanged and closes their spans", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationResult = Object.defineProperty({}, "then", {
      get() {
        throw new Error("hostile then getter");
      },
    });
    const wrapped = serviceTracer.tracer.wrap("hostile-then", () => applicationResult);

    const result = wrapped();

    assertStrictEquals(result, applicationResult);
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("runs wrapped code once when tracer and context setup fail", () => {
    for (const failure of ["getTracer", "active", "startSpan", "setSpan"] as const) {
      const harness = createHarness();
      const baseTracer = harness.traceApi.getTracer("test-service");
      if (failure === "getTracer") {
        harness.traceApi.getTracer = () => {
          throw new Error("getTracer failed");
        };
      } else if (failure === "active") {
        harness.contextApi.active = () => {
          throw new Error("active failed");
        };
      } else if (failure === "startSpan") {
        harness.traceApi.getTracer = () => ({
          ...baseTracer,
          startSpan() {
            throw new Error("startSpan failed");
          },
        });
      } else {
        harness.traceApi.setSpan = () => {
          throw new Error("setSpan failed");
        };
      }
      const serviceTracer = createOpenTelemetryServiceTracer({
        serviceName: "test-service",
        context: harness.contextApi,
        trace: harness.traceApi,
        errorStatusCode: 2,
      });
      let calls = 0;
      const expected = { failure };
      const wrapped = serviceTracer.tracer.wrap("operation", () => {
        calls++;
        return expected;
      });

      assertStrictEquals(wrapped(), expected);
      assertEquals(calls, 1);
    }
  });

  it("runs traced code once despite adversarial active-span providers", () => {
    for (const behavior of ["duplicate", "omit", "replace", "throw-after"] as const) {
      const harness = createHarness();
      const baseTracer = harness.traceApi.getTracer("test-service");
      harness.traceApi.getTracer = () => ({
        ...baseTracer,
        startActiveSpan: <T>(_name: string, callback: (span: FakeSpan) => T): T => {
          const span = new FakeSpan(`active-${behavior}`);
          harness.startedSpans.push(span);
          if (behavior === "omit") return "provider replacement" as T;
          const applicationResult = callback(span);
          if (behavior === "duplicate") callback(span);
          if (behavior === "throw-after") throw new Error("provider failed after callback");
          if (behavior === "replace") return "provider replacement" as T;
          return applicationResult;
        },
      });
      const serviceTracer = createOpenTelemetryServiceTracer({
        serviceName: "test-service",
        context: harness.contextApi,
        trace: harness.traceApi,
        errorStatusCode: 2,
      });
      let calls = 0;
      const expected = { behavior };

      const result = serviceTracer.tracer.trace("operation", () => {
        calls++;
        return expected;
      });

      assertStrictEquals(result, expected);
      assertEquals(calls, 1);
    }
  });

  it("preserves exact traced failures when the provider replaces callback results", () => {
    const harness = createHarness();
    const baseTracer = harness.traceApi.getTracer("test-service");
    harness.traceApi.getTracer = () => ({
      ...baseTracer,
      startActiveSpan: <T>(_name: string, callback: (span: FakeSpan) => T): T => {
        callback(new FakeSpan("replacement"));
        return "provider replacement" as T;
      },
    });
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationError = new Error("application failure");
    let caught: unknown;

    try {
      serviceTracer.tracer.trace("operation", () => {
        throw applicationError;
      });
    } catch (error) {
      caught = error;
    }

    assertStrictEquals(caught, applicationError);
  });

  it("keeps wrapped async spans open until the operation settles", async () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wrapped = serviceTracer.tracer.wrap("async-operation", async () => {
      await gate;
      return "done";
    });

    const resultPromise = wrapped();
    assertEquals(harness.startedSpans[0]?.ended, false);

    release();
    assertEquals(await resultPromise, "done");
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("invokes wrapped application code at most once when context activation misbehaves", () => {
    const harness = createHarness();
    harness.contextApi.with = <T>(_context: FakeContext, fn: () => T): T => {
      const result = fn();
      fn();
      return result;
    };
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    let calls = 0;
    const wrapped = serviceTracer.tracer.wrap("operation", () => ++calls);

    assertEquals(wrapped(), 1);
    assertEquals(calls, 1);
  });

  it("records wrapped async failures before ending and rethrowing", async () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationError = new Error("async wrapped failure");
    const wrapped = serviceTracer.tracer.wrap(
      "async-operation",
      () => Promise.reject(applicationError),
    );

    await assertRejects(() => wrapped(), Error, "async wrapped failure");

    assertEquals(harness.startedSpans[0]?.status, { code: 2 });
    assertEquals(
      (harness.startedSpans[0]?.exceptions[0] as Error | undefined)?.message,
      applicationError.message,
    );
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("preserves hostile thrown values and still closes the span", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationError = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("prototype inspection failed");
      },
      get() {
        throw new Error("property inspection failed");
      },
    });
    const wrapped = serviceTracer.tracer.wrap("hostile-error", () => {
      throw applicationError;
    });
    let caught: unknown;

    try {
      wrapped();
    } catch (error) {
      caught = error;
    }

    assertEquals(caught === applicationError, true);
    assertEquals(harness.startedSpans[0]?.status, { code: 2 });
    assertEquals(harness.startedSpans[0]?.ended, true);
    assertEquals((harness.startedSpans[0]?.exceptions[0] as Error).name, "Unknown");
  });

  it("redacts URL credentials from recorded exceptions without changing the rejection", async () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationError = new Error(
      "failed https://user:password@example.test/path?access_token=secret",
    );
    const wrapped = serviceTracer.tracer.wrap(
      "async-operation",
      () => Promise.reject(applicationError),
    );

    try {
      await wrapped();
      throw new Error("expected wrapped operation to reject");
    } catch (error) {
      assertEquals(error, applicationError);
    }

    const recorded = harness.startedSpans[0]?.exceptions[0] as Error;
    assertEquals(recorded.message.includes("secret"), false);
    assertEquals(recorded.message.includes("[REDACTED]"), true);
  });

  it("creates active spans and exposes trace context", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });

    const result = serviceTracer.tracer.trace("operation", () => {
      serviceTracer.setActiveSpanAttributes({
        "service.value": "ok",
      });
      return serviceTracer.getTraceContext();
    });

    assertEquals(result, {
      traceId: "operation-trace",
      spanId: "operation-span",
    });
    assertEquals(harness.startedSpans[0]?.attributes, {
      "service.value": "ok",
    });
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("records sync and async trace failures before rethrowing", async () => {
    const syncHarness = createHarness();
    const syncTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: syncHarness.contextApi,
      trace: syncHarness.traceApi,
      errorStatusCode: 2,
    });
    const syncError = new Error("sync failed");

    assertThrows(
      () =>
        syncTracer.tracer.trace("sync-operation", () => {
          throw syncError;
        }),
      Error,
      "sync failed",
    );
    assertEquals(syncHarness.startedSpans[0]?.status, { code: 2 });
    assertEquals(
      (syncHarness.startedSpans[0]?.exceptions[0] as Error | undefined)?.message,
      syncError.message,
    );
    assertEquals(syncHarness.startedSpans[0]?.ended, true);

    const asyncHarness = createHarness();
    const asyncTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: asyncHarness.contextApi,
      trace: asyncHarness.traceApi,
      errorStatusCode: 2,
    });
    const asyncError = new Error("async failed");

    await assertRejects(
      () =>
        asyncTracer.tracer.trace("async-operation", async () => {
          throw asyncError;
        }),
      Error,
      "async failed",
    );
    assertEquals(asyncHarness.startedSpans[0]?.status, { code: 2 });
    assertEquals(
      (asyncHarness.startedSpans[0]?.exceptions[0] as Error | undefined)?.message,
      asyncError.message,
    );
    assertEquals(asyncHarness.startedSpans[0]?.ended, true);
  });

  it("provides a datadog-style startSpan wrapper with attribute coercion", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });

    const span = serviceTracer.tracer.startSpan("manual-operation");
    span.setTag("nullable", null);
    span.setTag("object", { ok: true });
    span.setAttributes({
      number: 1,
      undefinedValue: undefined,
    });

    assertEquals(span.context()?.toTraceId(), "manual-operation-trace");
    assertEquals(span.context()?.toSpanId(), "manual-operation-span");
    assertEquals(harness.startedSpans[0]?.attributes, {
      nullable: "",
      object: '{"ok":true}',
      number: 1,
      undefinedValue: "",
    });
  });

  it("redacts sensitive object attributes and safely serializes cycles", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const cyclic: { safe: string; self?: unknown } = { safe: "value" };
    cyclic.self = cyclic;

    const span = serviceTracer.tracer.startSpan("manual-operation");
    span.setTag("apiKey", "secret");
    span.setTag("endpoint", "https://example.test/path?access_token=secret");
    span.setTag("metadata", {
      apiKey: "secret",
      nested: { password: "also-secret" },
    });
    span.setTag("cyclic", cyclic);

    assertEquals(harness.startedSpans[0]?.attributes, {
      apiKey: "[REDACTED]",
      endpoint: "https://example.test/path?access_token=[REDACTED]",
      metadata: '{"apiKey":"[REDACTED]","nested":{"password":"[REDACTED]"}}',
      cyclic: '{"safe":"value","self":"[REDACTED]"}',
    });
  });

  it("isolates manual span attribute and finish failures", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const span = serviceTracer.tracer.startSpan("manual-operation");
    const otelSpan = harness.startedSpans[0];
    if (!otelSpan) throw new Error("expected span");
    otelSpan.throwOnSetAttribute = true;
    otelSpan.throwOnEnd = true;

    span.setTag("safe", "value");
    span.setAttributes({ another: "value" });
    span.finish();
  });
});
