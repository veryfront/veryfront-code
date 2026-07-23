import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import {
  _resetShimForTests,
  type AttributeValue,
  type Context,
  propagation,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
  SpanKind,
  SpanStatusCode,
  type Tracer,
} from "./api-shim.ts";

describe("observability/tracing/otlp-setup", () => {
  afterEach(() => {
    _resetShimForTests();
  });

  it("withSpan should execute the callback when OTLP is unavailable", async () => {
    const { withSpan } = await import("./otlp-setup.ts");

    const result = await withSpan("test.operation", async () => "ok");

    assertEquals(result, "ok");
  });

  it("withSpan forwards explicit span kind options", async () => {
    const { withSpan } = await import("./otlp-setup.ts");
    let capturedKind: number | undefined;
    const spanContext: SpanContext = {
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: 0,
    };
    const span: Span = {
      setAttribute() {
        return span;
      },
      setAttributes() {
        return span;
      },
      setStatus() {
        return span;
      },
      recordException() {},
      addEvent() {
        return span;
      },
      end() {},
      spanContext() {
        return spanContext;
      },
      updateName() {},
    };

    setGlobalTracerProvider({
      getTracer() {
        return {
          startSpan(_name, options) {
            capturedKind = options?.kind;
            return span;
          },
          startActiveSpan<T>(
            _name: string,
            optionsOrFn:
              | { kind?: number; attributes?: Record<string, AttributeValue> }
              | ((span: Span) => T),
            contextOrFn?: unknown,
            fn?: (span: Span) => T,
          ): T {
            const callback = typeof optionsOrFn === "function"
              ? optionsOrFn
              : typeof contextOrFn === "function"
              ? contextOrFn as (span: Span) => T
              : fn!;
            return callback(span);
          },
        };
      },
    });

    await withSpan("genai.chat", async () => "ok", {}, { kind: SpanKind.CLIENT });

    assertEquals(capturedKind, SpanKind.CLIENT);
  });

  it("withSpan preserves callback-owned ERROR status on real OpenTelemetry spans", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const rootContext: Context = {
      getValue: () => undefined,
      setValue() {
        return this;
      },
      deleteValue() {
        return this;
      },
    };
    setGlobalContextAccessor({
      active: () => rootContext,
      with: (_context, fn) => fn(),
    });
    setGlobalTracerProvider({
      getTracer(name, version) {
        return provider.getTracer(name, version) as unknown as Tracer;
      },
    });
    const { withSpan } = await import("./otlp-setup.ts");

    try {
      await withSpan("test.callback-error", async (span) => {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "tool failed" });
      });
      await provider.forceFlush();

      const [finishedSpan] = exporter.getFinishedSpans();
      assertExists(finishedSpan);
      assertEquals(finishedSpan.status.code, SpanStatusCode.ERROR);
    } finally {
      _resetShimForTests();
      await provider.shutdown();
    }
  });

  it("withSpan preserves callback outcomes when span completion fails", async () => {
    const { withSpan } = await import("./otlp-setup.ts");
    const applicationError = new Error("application failed");
    const span = createTestSpan({
      setStatus: () => {
        throw new Error("telemetry status failed");
      },
      end: () => {
        throw new Error("telemetry end failed");
      },
    });
    setGlobalTracerProvider({
      getTracer: () => ({
        startSpan: () => span,
        startActiveSpan: (() => span) as never,
      }),
    });

    assertEquals(await withSpan("success", async () => "application result"), "application result");
    await assertRejects(
      () =>
        withSpan("failure", async () => {
          throw applicationError;
        }),
      Error,
      "application failed",
    );
  });

  it("withSpan invokes its callback once with an inert span when tracer setup fails", async () => {
    const { withSpan } = await import("./otlp-setup.ts");

    for (const failure of ["getTracer", "startSpan"] as const) {
      _resetShimForTests();
      setGlobalTracerProvider({
        getTracer() {
          if (failure === "getTracer") throw new Error("getTracer failed");
          return {
            startSpan() {
              throw new Error("startSpan failed");
            },
            startActiveSpan: (() => undefined) as never,
          };
        },
      });
      let calls = 0;

      const result = await withSpan("fallback", async (span) => {
        calls++;
        span.setAttribute("safe", true).addEvent("still-safe").end();
        return `application-${failure}`;
      });

      assertEquals(result, `application-${failure}`);
      assertEquals(calls, 1);
    }
  });

  it("withSpanSync invokes its callback once when tracer setup fails", async () => {
    const { withSpanSync } = await import("./otlp-setup.ts");
    setGlobalTracerProvider({
      getTracer() {
        throw new Error("getTracer failed");
      },
    });
    let calls = 0;

    const result = withSpanSync("fallback", () => {
      calls++;
      return "application result";
    });

    assertEquals(result, "application result");
    assertEquals(calls, 1);
  });

  it("withSpan preserves callback outcomes when context access and activation fail", async () => {
    const { withSpan } = await import("./otlp-setup.ts");
    setGlobalContextAccessor({
      active() {
        throw new Error("active context failed");
      },
      with(_context, callback) {
        callback();
        callback();
        throw new Error("context activation failed");
      },
    });
    let calls = 0;

    const result = await withSpan("context-fallback", async () => {
      calls++;
      return "application result";
    });

    assertEquals(result, "application result");
    assertEquals(calls, 1);
  });

  it("withSpanSync should execute the callback when OTLP is unavailable", async () => {
    const { withSpanSync } = await import("./otlp-setup.ts");

    const result = withSpanSync("test.operation", () => "ok");

    assertEquals(result, "ok");
  });

  it("extractContext should return the active context (shim returns noop context)", async () => {
    const { extractContext } = await import("./otlp-setup.ts");

    // With the api-shim, extractContext always returns a context object (noop when no provider).
    const ctx = extractContext(new Headers());
    assertExists(ctx);
  });

  it("injectContext should leave headers unchanged when APIs are unavailable", async () => {
    const { injectContext } = await import("./otlp-setup.ts");
    const headers = new Headers([["x-test", "1"]]);

    injectContext(headers);

    assertEquals(Array.from(headers.entries()), [["x-test", "1"]]);
  });

  it("context propagation helpers fail open when a propagator throws", async () => {
    const { extractContext, injectContext } = await import("./otlp-setup.ts");
    propagation.setGlobalPropagator({
      extract() {
        throw new Error("extract failed");
      },
      inject() {
        throw new Error("inject failed");
      },
      fields: () => [],
    });
    const headers = new Headers([["x-test", "1"]]);

    assertEquals(extractContext(headers), undefined);
    injectContext(headers);

    assertEquals(Array.from(headers.entries()), [["x-test", "1"]]);
  });

  it("withContext should execute the callback when APIs are unavailable", async () => {
    const { withContext } = await import("./otlp-setup.ts");

    const result = await withContext({ trace: "ctx" }, async () => "ok");

    assertEquals(result, "ok");
  });

  it("withContext invokes application code once when context activation misbehaves", async () => {
    const { withContext } = await import("./otlp-setup.ts");
    const context = createTestContext();
    setGlobalContextAccessor({
      active: () => context,
      with: (_context, fn) => {
        fn();
        fn();
        throw new Error("context provider failed");
      },
    });
    let calls = 0;

    const result = await withContext(context, async () => {
      calls++;
      return "application result";
    });

    assertEquals(result, "application result");
    assertEquals(calls, 1);
  });

  it("getTraceContext should return an empty object when no span is active", async () => {
    const { getTraceContext } = await import("./otlp-setup.ts");

    assertEquals(getTraceContext(), {});
  });

  it("span helpers reuse the resolved tracer until the provider changes", async () => {
    const { startServerSpan, withSpan, withSpanSync } = await import("./otlp-setup.ts");

    let getTracerCalls = 0;
    const spanContext: SpanContext = {
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      traceFlags: 1,
    };
    const span: Span = {
      setAttribute() {
        return span;
      },
      setAttributes() {
        return span;
      },
      setStatus() {
        return span;
      },
      recordException() {},
      addEvent() {
        return span;
      },
      end() {},
      spanContext() {
        return spanContext;
      },
      updateName() {},
    };
    const tracer: Tracer = {
      startSpan() {
        return span;
      },
      startActiveSpan<T>(
        _name: string,
        optionsOrFn:
          | { kind?: number; attributes?: Record<string, AttributeValue> }
          | ((span: Span) => T),
        contextOrFn?: unknown,
        fn?: (span: Span) => T,
      ): T {
        const callback = typeof optionsOrFn === "function"
          ? optionsOrFn
          : typeof contextOrFn === "function"
          ? contextOrFn as (span: Span) => T
          : fn!;
        return callback(span);
      },
    };

    setGlobalTracerProvider({
      getTracer() {
        getTracerCalls++;
        return tracer;
      },
    });

    await withSpan("test.async", async () => "ok");
    withSpanSync("test.sync", () => "ok");
    const serverSpan = startServerSpan("GET", "/cache");

    assertExists(serverSpan);
    assertEquals(getTracerCalls, 1);

    setGlobalTracerProvider({
      getTracer() {
        getTracerCalls++;
        return tracer;
      },
    });

    await withSpan("test.after-provider-swap", async () => "ok");

    assertEquals(getTracerCalls, 2);
  });

  it("startServerSpan removes query data from its name and target", async () => {
    const { startServerSpan } = await import("./otlp-setup.ts");
    let startedName = "";
    const attributes: Record<string, AttributeValue> = {};
    const span = createTestSpan({
      setAttribute(key, value) {
        attributes[key] = value;
        return span;
      },
    });
    setGlobalTracerProvider({
      getTracer: () => ({
        startSpan(name) {
          startedName = name;
          return span;
        },
        startActiveSpan: (() => span) as never,
      }),
    });

    startServerSpan("GET", "/items?access_token=secret");

    assertEquals(startedName, "GET /items");
    assertEquals(attributes["http.target"], "/items");
  });

  it("startServerSpan returns null when tracer setup fails", async () => {
    const { startServerSpan } = await import("./otlp-setup.ts");
    setGlobalTracerProvider({
      getTracer() {
        throw new Error("getTracer failed");
      },
    });

    assertEquals(startServerSpan("GET", "/items"), null);
  });

  it("withSpan starts nested spans with the active parent context", async () => {
    const { withSpan } = await import("./otlp-setup.ts");

    function makeContext(label: string): Context {
      const store = new Map<symbol, unknown>();
      return {
        getValue: (key) => store.get(key),
        setValue(key, value) {
          store.set(key, value);
          return this;
        },
        deleteValue(key) {
          store.delete(key);
          return this;
        },
        label,
      } as Context & { label: string };
    }

    let activeContext = makeContext("root");
    const contextSpans = new WeakMap<Context, Span>();
    const spansByName = new Map<string, Span>();
    const starts: Array<{ name: string; parentSpan: Span | undefined }> = [];

    setGlobalContextAccessor({
      active: () => activeContext,
      with: (ctx, fn) => {
        const previous = activeContext;
        activeContext = ctx;
        try {
          const result = fn();
          if (result && typeof (result as { finally?: unknown }).finally === "function") {
            return (result as unknown as Promise<unknown>).finally(() => {
              activeContext = previous;
            }) as never;
          }
          activeContext = previous;
          return result;
        } catch (error) {
          activeContext = previous;
          throw error;
        }
      },
    });
    setGlobalActiveSpanAccessor({
      getActiveSpan: () => contextSpans.get(activeContext),
      getSpan: (ctx) => contextSpans.get(ctx),
      setSpan: (_ctx, span) => {
        const next = makeContext(`span-${starts.length}`);
        contextSpans.set(next, span);
        return next;
      },
    });

    function createSpan(name: string): Span {
      const span: Span = {
        setAttribute() {
          return this;
        },
        setAttributes() {
          return this;
        },
        setStatus() {
          return this;
        },
        recordException() {},
        addEvent() {
          return this;
        },
        end() {},
        spanContext() {
          return {
            traceId: `trace-${name}`,
            spanId: `span-${name}`,
            traceFlags: 1,
          };
        },
        updateName() {},
      };
      spansByName.set(name, span);
      return span;
    }

    setGlobalTracerProvider({
      getTracer() {
        return {
          startSpan(name, _options, parentContext) {
            starts.push({ name, parentSpan: parentContext && contextSpans.get(parentContext) });
            return createSpan(name);
          },
          startActiveSpan<T>(
            _name: string,
            optionsOrFn:
              | {
                kind?: number;
                attributes?: Record<string, AttributeValue>;
              }
              | ((span: Span) => T),
            contextOrFn?: unknown,
            fn?: (span: Span) => T,
          ): T {
            const callback = typeof optionsOrFn === "function"
              ? optionsOrFn
              : typeof contextOrFn === "function"
              ? contextOrFn as (span: Span) => T
              : fn!;
            return callback(createSpan("active"));
          },
        };
      },
    });

    await withSpan("parent", async () => {
      await withSpan("child", async () => "ok");
    });

    assertEquals(starts.length, 2);
    const parentStart = starts[0];
    const childStart = starts[1];
    assertExists(parentStart);
    assertExists(childStart);
    assertEquals(parentStart.name, "parent");
    assertEquals(parentStart.parentSpan, undefined);
    assertEquals(childStart.name, "child");
    assertEquals(childStart.parentSpan, spansByName.get("parent"));
  });

  it("withSpanSync starts nested spans with the active parent context", async () => {
    const { withSpanSync } = await import("./otlp-setup.ts");
    const rootContext = createTestContext();
    let activeContext = rootContext;
    const contextSpans = new WeakMap<Context, Span>();
    const starts: Array<{ name: string; parentSpan: Span | undefined; span: Span }> = [];

    setGlobalContextAccessor({
      active: () => activeContext,
      with: (context, fn) => {
        const previous = activeContext;
        activeContext = context;
        try {
          return fn();
        } finally {
          activeContext = previous;
        }
      },
    });
    setGlobalActiveSpanAccessor({
      getActiveSpan: () => contextSpans.get(activeContext),
      getSpan: (context) => contextSpans.get(context),
      setSpan: (_context, span) => {
        const next = createTestContext();
        contextSpans.set(next, span);
        return next;
      },
    });
    setGlobalTracerProvider({
      getTracer: () => ({
        startSpan(name, _options, parentContext) {
          const span = createTestSpan({
            spanContext: () => ({
              traceId: "00000000000000000000000000000001",
              spanId: `000000000000000${starts.length + 1}`,
              traceFlags: 1,
            }),
          });
          starts.push({
            name,
            parentSpan: parentContext ? contextSpans.get(parentContext) : undefined,
            span,
          });
          return span;
        },
        startActiveSpan: (() => createTestSpan()) as never,
      }),
    });

    withSpanSync("parent", () => withSpanSync("child", () => "ok"));

    assertEquals(starts.length, 2);
    assertEquals(starts[1]?.parentSpan, starts[0]?.span);
  });
});

function createTestSpan(overrides: Partial<Span> = {}): Span {
  const spanContext: SpanContext = {
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  };
  const span: Span = {
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => {},
    addEvent: () => span,
    end: () => {},
    spanContext: () => spanContext,
    updateName: () => {},
    ...overrides,
  };
  return span;
}

function createTestContext(): Context {
  const values = new Map<symbol, unknown>();
  return {
    getValue: (key) => values.get(key),
    setValue(key, value) {
      values.set(key, value);
      return this;
    },
    deleteValue(key) {
      values.delete(key);
      return this;
    },
  };
}
