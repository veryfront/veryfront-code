import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
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
          | { kind?: number; attributes?: Record<string, string | number | boolean | undefined> }
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
});
