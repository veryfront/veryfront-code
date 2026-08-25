import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type Context,
  propagation,
  setGlobalTracerProvider,
  type Span,
  trace,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  endRequestTracing,
  executeWithTracingContext,
  getRequestTraceContext,
  setProjectAttributes,
  setRequestAttributes,
  startRequestTracing,
} from "./tracing.ts";

const INCOMING_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const INCOMING_SPAN_ID = "00f067aa0ba902b7";

function createFakeSpan(traceId: string, spanId: string): Span {
  const span = {
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => {},
    addEvent: () => span,
    end: () => {},
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    updateName: () => {},
  };
  return span as unknown as Span;
}

function randomHex(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/**
 * Wire a tracer that continues the trace found in the parent context and a
 * W3C-style propagator that reads `traceparent`, so trace continuity across the
 * runtime boundary is observable without the OTel SDK.
 */
function installFakeTracing(): { spanNames: string[] } {
  const spanNames: string[] = [];
  const tracer: Tracer = {
    startSpan: ((name: string, _options?: unknown, ctx?: Context) => {
      spanNames.push(name);
      const parent = ctx ? trace.getSpan(ctx) : undefined;
      const traceId = parent?.spanContext().traceId ?? randomHex(32);
      return createFakeSpan(traceId, randomHex(16));
    }) as Tracer["startSpan"],
    startActiveSpan: ((_name: string, ...rest: unknown[]) => {
      const fn = rest.find((arg) => typeof arg === "function") as
        | ((span: Span) => unknown)
        | undefined;
      return fn?.(createFakeSpan(randomHex(32), randomHex(16)));
    }) as Tracer["startActiveSpan"],
  };
  setGlobalTracerProvider({ getTracer: () => tracer });
  propagation.setGlobalPropagator({
    inject: () => {},
    extract: (ctx, carrier) => {
      const traceparent = (carrier as Record<string, string>)["traceparent"];
      if (!traceparent) return ctx;
      const [, traceId = "", spanId = ""] = traceparent.split("-");
      return trace.setSpan(ctx, createFakeSpan(traceId, spanId));
    },
    fields: () => ["traceparent"],
  });
  return { spanNames };
}

describe("server/runtime-handler/tracing", () => {
  describe("startRequestTracing", () => {
    let spanNames: string[];

    beforeEach(() => {
      _resetShimForTests();
      spanNames = installFakeTracing().spanNames;
    });

    afterEach(() => {
      _resetShimForTests();
    });

    it("continues the caller's trace from the traceparent header", () => {
      const req = new Request("http://localhost/test", {
        headers: { traceparent: `00-${INCOMING_TRACE_ID}-${INCOMING_SPAN_ID}-01` },
      });
      const spanInfo = startRequestTracing(req, "/test");

      assertEquals(
        spanInfo.span !== undefined && spanInfo.context !== undefined,
        true,
        "a started server span carries both the span and its context",
      );
      assertEquals(
        getRequestTraceContext(spanInfo.span).traceId,
        INCOMING_TRACE_ID,
        "the caller's trace must continue across the runtime boundary",
      );
      assertEquals(spanNames, ["GET /test"], "the server span is named by method then path");
    });

    it("starts a new trace when no traceparent header is present", () => {
      const req = new Request("http://localhost/test");
      const spanInfo = startRequestTracing(req, "/test");

      assertNotEquals(
        getRequestTraceContext(spanInfo.span).traceId,
        INCOMING_TRACE_ID,
        "a request without a traceparent must not inherit a foreign trace",
      );
    });
  });

  describe("setRequestAttributes", () => {
    it("should not throw when span is null/undefined", () => {
      const req = new Request("http://localhost/test");
      const url = new URL(req.url);
      // Should not throw
      setRequestAttributes(null, req, url);
      setRequestAttributes(undefined, req, url);
    });

    it("records the request url, host and scheme on the span", () => {
      const recorded: Record<string, unknown> = {};
      const span = {
        setAttribute: (k: string, v: unknown) => {
          recorded[k] = v;
        },
      };
      const req = new Request("http://localhost/test");
      const url = new URL(req.url);

      setRequestAttributes(span, req, url);

      assertEquals(
        recorded["http.url"],
        "http://localhost/test",
        "the request URL is recorded on the span",
      );
      assertEquals(recorded["http.host"], "localhost", "the request host is recorded on the span");
      assertEquals(recorded["http.scheme"], "http", "the request scheme is recorded on the span");
    });
  });

  describe("setProjectAttributes", () => {
    it("should not throw when span is null/undefined", () => {
      setProjectAttributes(null, "my-project", "production");
      setProjectAttributes(undefined, "my-project", "production");
    });

    it("should not throw when projectSlug is undefined", () => {
      const recorded: Record<string, unknown> = {};
      const span = {
        setAttribute: (k: string, v: unknown) => {
          recorded[k] = v;
        },
      };
      setProjectAttributes(span, undefined, "production");
      assertEquals(recorded, {}, "no attributes are recorded without a project slug");
    });

    it("records the project slug and environment on the span", () => {
      const recorded: Record<string, unknown> = {};
      const span = {
        setAttribute: (k: string, v: unknown) => {
          recorded[k] = v;
        },
      };

      setProjectAttributes(span, "my-project", "production");

      assertEquals(
        recorded["veryfront.project_slug"],
        "my-project",
        "the project slug is recorded",
      );
      assertEquals(recorded["veryfront.environment"], "production", "the environment is recorded");
    });

    it("defaults the environment to unknown", () => {
      const recorded: Record<string, unknown> = {};
      const span = {
        setAttribute: (k: string, v: unknown) => {
          recorded[k] = v;
        },
      };

      setProjectAttributes(span, "my-project", undefined);

      assertEquals(
        recorded["veryfront.environment"],
        "unknown",
        "a missing environment is recorded as unknown, not dropped",
      );
    });
  });

  describe("endRequestTracing", () => {
    it("should not throw when span is null/undefined", () => {
      endRequestTracing(null, 200);
      endRequestTracing(undefined, 404);
    });

    it("should accept optional error parameter", () => {
      endRequestTracing(null, 500, new Error("test error"));
    });
  });

  describe("executeWithTracingContext", () => {
    it("should execute handler directly when context is null", async () => {
      let called = false;
      const result = await executeWithTracingContext(
        { span: null, context: null },
        async () => {
          called = true;
          return 42;
        },
      );
      assertEquals(called, true);
      assertEquals(result, 42);
    });

    it("should execute handler directly when context is undefined", async () => {
      const result = await executeWithTracingContext(
        { span: undefined, context: undefined },
        async () => "hello",
      );
      assertEquals(result, "hello");
    });

    it("should propagate errors from handler", async () => {
      let caught = false;
      try {
        await executeWithTracingContext(
          { span: null, context: null },
          async () => {
            throw new Error("handler failed");
          },
        );
      } catch (e) {
        caught = true;
        assertEquals((e as Error).message, "handler failed");
      }
      assertEquals(caught, true);
    });
  });
});
