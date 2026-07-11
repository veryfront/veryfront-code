import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  type Context,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
  SpanKind,
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

  it("withContext should execute the callback when APIs are unavailable", async () => {
    const { withContext } = await import("./otlp-setup.ts");

    const result = await withContext({ trace: "ctx" }, async () => "ok");

    assertEquals(result, "ok");
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
});
