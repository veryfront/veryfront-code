import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ContextPropagation } from "./context-propagation.ts";
import type { Context, OpenTelemetryAPI, Span, TextMapPropagator } from "./types.ts";

function createMockApi(): OpenTelemetryAPI {
  return {
    trace: {
      getTracer: () => ({}) as never,
      setSpan: (_context: unknown, _span: unknown) =>
        ({ _type: "span-context" }) as unknown as Context,
    },
    propagation: {
      setGlobalPropagator: () => {},
      extract: (_context: unknown, _carrier: Record<string, string>) =>
        ({ _type: "extracted-context" }) as unknown as Context,
      inject: (_context: unknown, carrier: Record<string, string>) => {
        carrier["traceparent"] = "00-trace-span-01";
      },
    },
    context: {
      active: () => ({ _type: "active-context" }) as unknown as Context,
      with: <T>(_context: unknown, fn: () => T): T => fn(),
    },
    SpanKind: {} as never,
    SpanStatusCode: { OK: 1, ERROR: 2 },
  };
}

function createMockPropagator(): TextMapPropagator {
  return {
    inject: () => {},
    extract: () => ({}) as never,
    fields: () => ["traceparent", "tracestate"],
  };
}

function createMockSpan(): Span {
  const span: Span = {
    end() {},
    setStatus() {
      return span;
    },
    setAttributes() {
      return span;
    },
    setAttribute() {
      return span;
    },
    addEvent() {
      return span;
    },
    recordException() {},
    spanContext() {
      return { traceId: "abc", spanId: "def", traceFlags: 1, isRemote: false };
    },
    updateName() {
      return span;
    },
  };

  return span;
}

describe("observability/tracing/context-propagation", () => {
  let api: OpenTelemetryAPI;
  let propagator: TextMapPropagator;
  let ctx: ContextPropagation;

  beforeEach(() => {
    api = createMockApi();
    propagator = createMockPropagator();
    ctx = new ContextPropagation(api, propagator);
  });

  describe("extractContext", () => {
    it("should extract context from headers", () => {
      const headers = new Headers({
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      });
      const result = ctx.extractContext(headers);
      assertEquals(result !== undefined, true);
    });

    it("should extract context from empty headers", () => {
      const result = ctx.extractContext(new Headers());
      assertEquals(result !== undefined, true);
    });

    it("should return undefined when extraction throws", () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        propagation: {
          ...api.propagation,
          extract() {
            throw new Error("extract failed");
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      const result = badCtx.extractContext(new Headers());
      assertEquals(result, undefined);
    });
  });

  describe("injectContext", () => {
    it("should inject context into headers", () => {
      const context = { _type: "test-context" } as unknown as Context;
      const headers = new Headers();
      ctx.injectContext(context, headers);
      assertEquals(headers.get("traceparent"), "00-trace-span-01");
    });

    it("should preserve existing headers", () => {
      const context = { _type: "test-context" } as unknown as Context;
      const headers = new Headers({ "x-custom": "value" });
      ctx.injectContext(context, headers);
      assertEquals(headers.get("x-custom"), "value");
    });

    it("should not throw when injection fails", () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        propagation: {
          ...api.propagation,
          inject() {
            throw new Error("inject failed");
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      badCtx.injectContext({} as Context, new Headers());
    });
  });

  describe("getActiveContext", () => {
    it("should return active context", () => {
      const result = ctx.getActiveContext();
      assertEquals(result !== undefined, true);
    });

    it("should return undefined when api throws", () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          active() {
            throw new Error("active failed");
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      const result = badCtx.getActiveContext();
      assertEquals(result, undefined);
    });
  });

  describe("withActiveSpan", () => {
    it("returns the application promise without waiting for a provider-owned promise", async () => {
      const never = new Promise<never>(() => {});
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: <T>(_context: Context, fn: () => T): T => {
            fn();
            return never as T;
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      const applicationPromise = Promise.resolve("application result");

      const result = badCtx.withActiveSpan(createMockSpan(), () => applicationPromise);

      assertStrictEquals(result, applicationPromise);
      assertEquals(await result, "application result");
    });

    it("preserves the callback result when the context provider replaces it", async () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: <T>(_context: Context, fn: () => T): T => {
            fn();
            return Promise.resolve("provider result") as T;
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);

      const result = await badCtx.withActiveSpan(
        createMockSpan(),
        () => Promise.resolve("application result"),
      );

      assertEquals(result, "application result");
    });

    it("runs the callback when the context provider returns without invoking it", async () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: <T>(_context: Context, _fn: () => T): T => "provider result" as T,
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      let calls = 0;

      const result = await badCtx.withActiveSpan(createMockSpan(), async () => {
        calls++;
        return "application result";
      });

      assertEquals(result, "application result");
      assertEquals(calls, 1);
    });

    it("invokes the callback at most once when the context provider invokes it repeatedly", async () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: (_context, fn) => {
            const result = fn();
            fn();
            return result;
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      let calls = 0;

      await badCtx.withActiveSpan(createMockSpan(), async () => {
        calls++;
      });

      assertEquals(calls, 1);
    });

    it("preserves the callback result when the context provider fails after invocation", async () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: (_context, fn) => {
            fn();
            throw new Error("context provider failed");
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      let calls = 0;

      const result = await badCtx.withActiveSpan(createMockSpan(), async () => {
        calls++;
        return "application result";
      });

      assertEquals(result, "application result");
      assertEquals(calls, 1);
    });

    it("should execute function with span context", async () => {
      const span = createMockSpan();
      let executed = false;

      await ctx.withActiveSpan(span, async () => {
        executed = true;
      });

      assertEquals(executed, true);
    });

    it("should return function result", async () => {
      const span = createMockSpan();
      const result = await ctx.withActiveSpan(span, async () => "test-result");
      assertEquals(result, "test-result");
    });

    it("should execute function directly when span is null", async () => {
      let executed = false;

      await ctx.withActiveSpan(null, async () => {
        executed = true;
      });

      assertEquals(executed, true);
    });

    it("should propagate errors", async () => {
      const span = createMockSpan();

      await assertRejects(
        () =>
          // deno-lint-ignore require-await
          ctx.withActiveSpan(span, async () => {
            throw new Error("test error");
          }),
        Error,
        "test error",
      );
    });
  });

  describe("withSpan", () => {
    it("passes the exact unknown thrown value through span finalization", () => {
      const thrown = { reason: "non-error" };
      let finalizedError: unknown;

      try {
        ctx.withSpan(
          "test",
          () => {
            throw thrown;
          },
          () => createMockSpan(),
          (_span, error) => {
            finalizedError = error;
          },
        );
      } catch (error) {
        assertStrictEquals(error, thrown);
      }

      assertStrictEquals(finalizedError, thrown);
    });

    it("distinguishes falsey thrown values from successful span completion", () => {
      for (const thrown of [undefined, null, 0, ""] as const) {
        let caught = false;
        let finalized: unknown[] = [];
        try {
          ctx.withSpan(
            "test",
            () => {
              throw thrown;
            },
            () => createMockSpan(),
            (_span, ...failure) => {
              finalized = failure;
            },
          );
        } catch (error) {
          caught = true;
          assertStrictEquals(error, thrown);
        }
        assertEquals(caught, true);
        assertEquals(finalized.length, 1);
        assertStrictEquals(finalized[0], thrown);
      }
    });

    it("preserves a callback error when the context provider swallows it", () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: <T>(_context: Context, fn: () => T): T => {
            try {
              fn();
            } catch (_) {
              return "provider result" as T;
            }
            return "provider result" as T;
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);

      assertThrows(
        () =>
          badCtx.withSpan(
            "test",
            () => {
              throw new Error("application failure");
            },
            () => createMockSpan(),
            () => {},
          ),
        Error,
        "application failure",
      );
    });

    it("runs the callback when the context provider returns without invoking it", () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: <T>(_context: Context, _fn: () => T): T => "provider result" as T,
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      let calls = 0;

      const result = badCtx.withSpan(
        "test",
        () => {
          calls++;
          return "application result";
        },
        () => createMockSpan(),
        () => {},
      );

      assertEquals(result, "application result");
      assertEquals(calls, 1);
    });

    it("preserves a completed callback result when context and finalization fail", () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: (_context, fn) => {
            fn();
            throw new Error("context provider failed");
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      let calls = 0;

      const result = badCtx.withSpan(
        "test",
        () => {
          calls++;
          return "application result";
        },
        () => createMockSpan(),
        () => {
          throw new Error("telemetry end failed");
        },
      );

      assertEquals(result, "application result");
      assertEquals(calls, 1);
    });

    it("should create span, execute fn, and end span", () => {
      let startCalled = false;
      let endCalled = false;
      const mockSpan = createMockSpan();

      const result = ctx.withSpan(
        "test-operation",
        () => "result",
        () => {
          startCalled = true;
          return mockSpan;
        },
        () => {
          endCalled = true;
        },
      );

      assertEquals(result, "result");
      assertEquals(startCalled, true);
      assertEquals(endCalled, true);
    });

    it("should execute fn inside the started span context", () => {
      const mockSpan = createMockSpan();
      const spanContext = { _type: "span-context" } as unknown as Context;
      let withContext: Context | null = null;
      const apiWithContextCapture: OpenTelemetryAPI = {
        ...api,
        trace: {
          ...api.trace,
          setSpan: () => spanContext,
        },
        context: {
          ...api.context,
          with: (context, fn) => {
            withContext = context;
            return fn();
          },
        },
      };
      const contextPropagation = new ContextPropagation(apiWithContextCapture, propagator);

      const result = contextPropagation.withSpan(
        "test",
        () => withContext,
        () => mockSpan,
        () => {},
      );

      assertEquals(result, spanContext);
      assertEquals(withContext, spanContext);
    });

    it("should pass span to function", () => {
      const mockSpan = createMockSpan();
      let receivedSpan: Span | null = null;

      ctx.withSpan(
        "test",
        (span) => {
          receivedSpan = span;
          return "ok";
        },
        () => mockSpan,
        () => {},
      );

      assertEquals(receivedSpan, mockSpan);
    });

    it("should end span with error when function throws", () => {
      const mockSpan = createMockSpan();
      let endError: unknown;

      assertThrows(
        () =>
          ctx.withSpan(
            "test",
            () => {
              throw new Error("sync error");
            },
            () => mockSpan,
            (_span, error) => {
              endError = error;
            },
          ),
        Error,
        "sync error",
      );

      assert(endError instanceof Error);
      assertEquals(endError.message, "sync error");
    });
  });

  describe("withSpanAsync", () => {
    it("passes the exact unknown rejection through span finalization", async () => {
      const thrown = { reason: "async non-error" };
      let finalizedError: unknown;
      let caught: unknown;

      try {
        await ctx.withSpanAsync(
          "test",
          () => Promise.reject(thrown),
          () => createMockSpan(),
          (_span, error) => {
            finalizedError = error;
          },
        );
      } catch (error) {
        caught = error;
      }

      assertStrictEquals(caught, thrown);
      assertStrictEquals(finalizedError, thrown);
    });

    it("preserves a completed callback result when context and finalization fail", async () => {
      const badApi: OpenTelemetryAPI = {
        ...api,
        context: {
          ...api.context,
          with: (_context, fn) => {
            fn();
            throw new Error("context provider failed");
          },
        },
      };
      const badCtx = new ContextPropagation(badApi, propagator);
      let calls = 0;

      const result = await badCtx.withSpanAsync(
        "test",
        async () => {
          calls++;
          return "application result";
        },
        () => createMockSpan(),
        () => {
          throw new Error("telemetry end failed");
        },
      );

      assertEquals(result, "application result");
      assertEquals(calls, 1);
    });

    it("should create span, execute async fn, and end span", async () => {
      let startCalled = false;
      let endCalled = false;
      const mockSpan = createMockSpan();

      const result = await ctx.withSpanAsync(
        "test-operation",
        () => Promise.resolve("async-result"),
        () => {
          startCalled = true;
          return mockSpan;
        },
        () => {
          endCalled = true;
        },
      );

      assertEquals(result, "async-result");
      assertEquals(startCalled, true);
      assertEquals(endCalled, true);
    });

    it("should execute async fn inside the started span context", async () => {
      const mockSpan = createMockSpan();
      const spanContext = { _type: "span-context" } as unknown as Context;
      let withContext: Context | null = null;
      const apiWithContextCapture: OpenTelemetryAPI = {
        ...api,
        trace: {
          ...api.trace,
          setSpan: () => spanContext,
        },
        context: {
          ...api.context,
          with: (context, fn) => {
            withContext = context;
            return fn();
          },
        },
      };
      const contextPropagation = new ContextPropagation(apiWithContextCapture, propagator);

      const result = await contextPropagation.withSpanAsync(
        "test",
        () => Promise.resolve(withContext),
        () => mockSpan,
        () => {},
      );

      assertEquals(result, spanContext);
      assertEquals(withContext, spanContext);
    });

    it("should end span with error when async function rejects", async () => {
      const mockSpan = createMockSpan();
      let endError: unknown;

      await assertRejects(
        () =>
          ctx.withSpanAsync(
            "test",
            () => Promise.reject(new Error("async error")),
            () => mockSpan,
            (_span, error) => {
              endError = error;
            },
          ),
        Error,
        "async error",
      );

      assert(endError instanceof Error);
      assertEquals(endError.message, "async error");
    });
  });
});
