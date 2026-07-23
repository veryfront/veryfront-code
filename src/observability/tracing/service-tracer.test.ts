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
  endCalls = 0;

  constructor(
    readonly name: string,
    private readonly throwOnEnd = false,
    private readonly throwOnAttributes = false,
    private readonly throwOnSpanContext = false,
  ) {
    this.context = {
      traceId: `${name}-trace`,
      spanId: `${name}-span`,
    };
  }

  setAttribute(key: string, value: unknown): FakeSpan {
    this.attributes[key] = value;
    if (this.throwOnAttributes) throw new Error("tracer-attribute-failure");
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
    this.endCalls++;
    this.ended = true;
    if (this.throwOnEnd) throw new Error("tracer-end-failure");
  }

  spanContext(): { traceId: string; spanId: string } {
    if (this.throwOnSpanContext) throw new Error("tracer-context-failure");
    return this.context;
  }
}

function createHarness(
  options: {
    throwAfterActiveCallback?: boolean;
    throwAfterContextCallback?: boolean;
    throwOnAttributes?: boolean;
    throwOnEnd?: boolean;
    throwOnSpanContext?: boolean;
  } = {},
) {
  let activeContext: FakeContext = {};
  const startedSpans: FakeSpan[] = [];
  const startedOptions: Array<FakeSpanOptions | undefined> = [];
  const contextApi = {
    active: () => activeContext,
    with: <T>(context: FakeContext, fn: () => T): T => {
      const previous = activeContext;
      activeContext = context;
      let result: T;
      try {
        result = fn();
      } finally {
        activeContext = previous;
      }
      if (options.throwAfterContextCallback) {
        throw new Error("context-after-callback-failure");
      }
      return result;
    },
  };
  const traceApi = {
    getTracer: (_serviceName: string) => ({
      startSpan: (
        name: string,
        spanOptions: FakeSpanOptions | undefined,
        _context: FakeContext,
      ): FakeSpan => {
        startedOptions.push(spanOptions);
        const span = new FakeSpan(
          name,
          options.throwOnEnd,
          options.throwOnAttributes,
          options.throwOnSpanContext,
        );
        startedSpans.push(span);
        return span;
      },
      startActiveSpan: <T>(name: string, fn: (span: FakeSpan) => T): T => {
        const span = new FakeSpan(
          name,
          options.throwOnEnd,
          options.throwOnAttributes,
          options.throwOnSpanContext,
        );
        startedSpans.push(span);
        const result = contextApi.with({ span }, () => fn(span));
        if (options.throwAfterActiveCallback) {
          throw new Error("tracer-after-callback-failure");
        }
        return result;
      },
    }),
    setSpan: (_context: FakeContext, span: FakeSpan): FakeContext => ({ span }),
    getSpan: (context: FakeContext): FakeSpan | undefined => context.span,
  };

  return {
    contextApi,
    traceApi,
    startedSpans,
    startedOptions,
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
    assertEquals(syncHarness.startedSpans[0]?.exceptions, []);
    assertEquals(syncHarness.startedSpans[0]?.attributes, {
      error: true,
      "error.category": "error",
      "error.type": "error",
    });
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
    assertEquals(asyncHarness.startedSpans[0]?.exceptions, []);
    assertEquals(asyncHarness.startedSpans[0]?.attributes, {
      error: true,
      "error.category": "error",
      "error.type": "error",
    });
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

  it("uses childOf only to establish context", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const parent = serviceTracer.tracer.startSpan("parent");

    serviceTracer.tracer.startSpan("child", {
      childOf: parent,
      attributes: {
        operation: "child",
        credential: "token=private-value",
      },
    });

    assertEquals(harness.startedOptions[1]?.childOf, undefined);
    assertEquals(harness.startedOptions[1]?.attributes?.operation, "child");
    assertEquals(
      String(harness.startedOptions[1]?.attributes?.credential).includes("private-value"),
      false,
    );
  });

  it("bounds and redacts service tracer attributes", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const span = serviceTracer.tracer.startSpan("manual-operation");
    span.setTag("credential", "token=secret-value");
    span.setTag("object", { apiKey: "secret-value", safe: "value" });
    span.setAttributes(Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`dimension.${index}`, "x".repeat(500)]),
    ));

    assertEquals(
      String(harness.startedSpans[0]?.attributes.credential).includes("secret-value"),
      false,
    );
    assertEquals(
      String(harness.startedSpans[0]?.attributes.object).includes("secret-value"),
      false,
    );
    assertEquals(Object.keys(harness.startedSpans[0]?.attributes ?? {}).length, 34);
    assertEquals(
      String(harness.startedSpans[0]?.attributes["dimension.0"]).length,
      256,
    );
  });

  it("makes manual span finish idempotent and isolates hostile attribute snapshots", () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const span = serviceTracer.tracer.startSpan("manual-operation");
    const hostile = new Proxy<Record<string, string>>({}, {
      ownKeys() {
        throw new Error("attribute snapshot failed");
      },
    });

    span.setAttributes(hostile);
    span.finish();
    span.finish();

    assertEquals(harness.startedSpans[0]?.endCalls, 1);
  });

  it("keeps wrapped spans open until async failures settle", async () => {
    const harness = createHarness();
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const applicationError = new Error("private customer detail");
    const wrapped = serviceTracer.tracer.wrap("wrapped-operation", async () => {
      await Promise.resolve();
      throw applicationError;
    });

    const result = wrapped();
    assertEquals(harness.startedSpans[0]?.ended, false);
    await assertRejects(() => result, Error, "private customer detail");

    assertEquals(harness.startedSpans[0]?.status, { code: 2 });
    assertEquals(harness.startedSpans[0]?.exceptions, []);
    assertEquals(harness.startedSpans[0]?.attributes, {
      error: true,
      "error.category": "error",
      "error.type": "error",
    });
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("preserves one wrapped async invocation when context hooks fail", async () => {
    const harness = createHarness({
      throwAfterContextCallback: true,
      throwOnEnd: true,
    });
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    let calls = 0;
    const wrapped = serviceTracer.tracer.wrap("wrapped-operation", async () => {
      calls++;
      return "application-result";
    });

    assertEquals(await wrapped(), "application-result");
    assertEquals(calls, 1);
    assertEquals(harness.startedSpans[0]?.ended, true);
  });

  it("isolates active attribute and span-context hook failures", () => {
    const attributeHarness = createHarness({ throwOnAttributes: true });
    const attributeTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: attributeHarness.contextApi,
      trace: attributeHarness.traceApi,
      errorStatusCode: 2,
    });

    const attributeResult = attributeTracer.tracer.trace("operation", () => {
      attributeTracer.setActiveSpanAttributes({ "bounded.value": "ok" });
      return "application-result";
    });
    assertEquals(attributeResult, "application-result");

    const contextHarness = createHarness({ throwOnSpanContext: true });
    const contextTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: contextHarness.contextApi,
      trace: contextHarness.traceApi,
      errorStatusCode: 2,
    });
    const manualSpan = contextTracer.tracer.startSpan("manual-operation");

    assertEquals(manualSpan.context(), undefined);
    assertEquals(
      contextTracer.tracer.trace("operation", () => contextTracer.getTraceContext()),
      {},
    );
  });

  it("preserves one manual span context callback when hooks fail", () => {
    const harness = createHarness({
      throwAfterContextCallback: true,
      throwOnEnd: true,
    });
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    const span = serviceTracer.tracer.startSpan("manual-operation");
    let calls = 0;

    const result = span.withContext(() => {
      calls++;
      return "application-result";
    });
    span.finish();

    assertEquals(result, "application-result");
    assertEquals(calls, 1);
  });

  it("preserves one application invocation when active tracer hooks fail", () => {
    const harness = createHarness({
      throwAfterActiveCallback: true,
      throwOnEnd: true,
    });
    const serviceTracer = createOpenTelemetryServiceTracer({
      serviceName: "test-service",
      context: harness.contextApi,
      trace: harness.traceApi,
      errorStatusCode: 2,
    });
    let calls = 0;

    const result = serviceTracer.tracer.trace("operation", () => {
      calls++;
      return "application-result";
    });

    assertEquals(result, "application-result");
    assertEquals(calls, 1);
  });
});
