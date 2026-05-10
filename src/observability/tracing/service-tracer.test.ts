import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
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

  constructor(readonly name: string) {
    this.context = {
      traceId: `${name}-trace`,
      spanId: `${name}-span`,
    };
  }

  setAttribute(key: string, value: unknown): FakeSpan {
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
    assertEquals(syncHarness.startedSpans[0]?.exceptions, [syncError]);
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
    assertEquals(asyncHarness.startedSpans[0]?.exceptions, [asyncError]);
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
});
