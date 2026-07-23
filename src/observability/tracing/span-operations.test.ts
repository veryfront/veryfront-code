import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { SpanOperations } from "./span-operations.ts";
import type { OpenTelemetryAPI, Span, Tracer } from "./types.ts";

type MockSpan = Span & {
  _ended: boolean;
  _status: { code: number; message?: string } | null;
  _attributes: Record<string, unknown>;
  _events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  _exception: Error | null;
};

function createMockSpan(): MockSpan {
  const span = {
    _ended: false,
    _status: null as { code: number; message?: string } | null,
    _attributes: {} as Record<string, unknown>,
    _events: [] as Array<{ name: string; attributes?: Record<string, unknown> }>,
    _exception: null as Error | null,
    end() {
      span._ended = true;
    },
    setStatus(status: { code: number; message?: string }) {
      span._status = status;
      return span;
    },
    setAttributes(attrs: Record<string, unknown>) {
      Object.assign(span._attributes, attrs);
      return span;
    },
    setAttribute(key: string, value: unknown) {
      span._attributes[key] = value;
      return span;
    },
    addEvent(name: string, attributes?: Record<string, unknown>) {
      span._events.push({ name, attributes });
      return span;
    },
    recordException(error: Error) {
      span._exception = error;
    },
    spanContext() {
      return { traceId: "abc", spanId: "def", traceFlags: 1, isRemote: false };
    },
    isRecording() {
      return true;
    },
    updateName() {
      return span;
    },
  };

  return span as unknown as MockSpan;
}

function createMockTracer(): Tracer {
  return {
    startSpan: () => createMockSpan(),
    startActiveSpan: (() => {}) as never,
  };
}

function createMockApi(): OpenTelemetryAPI {
  return {
    trace: {
      getTracer: () => createMockTracer(),
      setSpan: () => ({ _type: "context" }) as never,
    },
    propagation: {
      setGlobalPropagator: () => {},
      extract: () => ({}) as never,
      inject: () => {},
    },
    context: {
      active: () => ({ _type: "active-context" }) as never,
      with: <T>(_context: unknown, fn: () => T): T => fn(),
    },
    SpanKind: {
      INTERNAL: 0 as never,
      SERVER: 1 as never,
      CLIENT: 2 as never,
      PRODUCER: 3 as never,
      CONSUMER: 4 as never,
    },
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
    },
  };
}

describe("observability/tracing/span-operations", () => {
  let api: OpenTelemetryAPI;
  let tracer: Tracer;
  let ops: SpanOperations;

  beforeEach(() => {
    api = createMockApi();
    tracer = createMockTracer();
    ops = new SpanOperations(api, tracer);
  });

  describe("startSpan", () => {
    it("redacts sensitive and URL credential attribute values", () => {
      let receivedAttributes: Record<string, unknown> | undefined;
      tracer = {
        startSpan: (_name, options) => {
          receivedAttributes = options?.attributes;
          return createMockSpan();
        },
        startActiveSpan: (() => {}) as never,
      };
      ops = new SpanOperations(api, tracer);

      ops.startSpan("test", {
        attributes: {
          apiKey: "secret",
          endpoint: "https://example.test/path?token=secret",
        },
      });

      assertEquals(receivedAttributes, {
        apiKey: "[REDACTED]",
        endpoint: "https://example.test/path?token=[REDACTED]",
      });
    });

    it("converts a Span parent into an OpenTelemetry Context", () => {
      const parent = createMockSpan();
      const expectedContext = { _type: "parent-context" } as never;
      let receivedContext: unknown;
      api.trace.setSpan = (_context, span) => {
        assertEquals(span, parent);
        return expectedContext;
      };
      tracer = {
        startSpan: (_name, _options, context) => {
          receivedContext = context;
          return createMockSpan();
        },
        startActiveSpan: (() => {}) as never,
      };
      ops = new SpanOperations(api, tracer);

      ops.startSpan("child", { parent });

      assertEquals(receivedContext, expectedContext);
    });

    it("should create a span with given name", () => {
      const span = ops.startSpan("test.operation");
      assertEquals(span !== null, true);
    });

    it("should create a span with default options", () => {
      const span = ops.startSpan("test.operation");
      assertEquals(span !== null, true);
    });

    it("should accept span options with kind", () => {
      const span = ops.startSpan("test.operation", { kind: "server" });
      assertEquals(span !== null, true);
    });

    it("should accept span options with attributes", () => {
      const span = ops.startSpan("test.operation", {
        attributes: { "http.method": "GET", "http.status_code": 200 },
      });
      assertEquals(span !== null, true);
    });

    it("should return null when tracer throws", () => {
      const badTracer = {
        startSpan: () => {
          throw new Error("tracer error");
        },
        startActiveSpan: (() => {}) as never,
      } as Tracer;

      const badOps = new SpanOperations(api, badTracer);
      const span = badOps.startSpan("test");
      assertEquals(span, null);
    });
  });

  describe("endSpan", () => {
    it("still attempts to end a span when status recording fails", () => {
      let ended = false;
      const badSpan = {
        ...createMockSpan(),
        setStatus() {
          throw new Error("setStatus failed");
        },
        end() {
          ended = true;
        },
      } as unknown as Span;

      ops.endSpan(badSpan);

      assertEquals(ended, true);
    });

    it("should end a span with OK status", () => {
      const mockSpan = createMockSpan();
      ops.endSpan(mockSpan);
      assertEquals(mockSpan._ended, true);
      assertEquals(mockSpan._status?.code, 1);
    });

    it("should end a span with error status", () => {
      const mockSpan = createMockSpan();
      const error = new Error("test error");
      ops.endSpan(mockSpan, error);
      assertEquals(mockSpan._ended, true);
      assertEquals(mockSpan._status?.code, 2);
      assertEquals(mockSpan._status?.message, "test error");
      assertEquals(mockSpan._exception?.message, error.message);
    });

    it("redacts URL credentials from error telemetry", () => {
      const mockSpan = createMockSpan();
      const error = new Error(
        "failed https://user:password@example.test/path?access_token=secret",
      );

      ops.endSpan(mockSpan, error);

      assertEquals(mockSpan._status?.message?.includes("secret"), false);
      assertEquals(mockSpan._exception?.message.includes("secret"), false);
      assertEquals(error.message.includes("secret"), true);
    });

    it("should handle null span gracefully", () => {
      ops.endSpan(null);
    });

    it("should handle span.end() throwing", () => {
      const badSpan = {
        ...createMockSpan(),
        setStatus() {
          throw new Error("setStatus failed");
        },
      } as unknown as Span;

      ops.endSpan(badSpan);
    });
  });

  describe("setAttributes", () => {
    it("should set attributes on a span", () => {
      const mockSpan = createMockSpan();
      ops.setAttributes(mockSpan, { key: "value", count: 42 });
      assertEquals(mockSpan._attributes.key, "value");
      assertEquals(mockSpan._attributes.count, 42);
    });

    it("should handle null span gracefully", () => {
      ops.setAttributes(null, { key: "value" });
    });

    it("should handle span.setAttributes() throwing", () => {
      const badSpan = {
        setAttributes() {
          throw new Error("setAttributes failed");
        },
      } as unknown as Span;

      ops.setAttributes(badSpan, { key: "value" });
    });
  });

  describe("addEvent", () => {
    it("should add an event to a span", () => {
      const mockSpan = createMockSpan();
      ops.addEvent(mockSpan, "user.action", { "user.id": "123" });
      assertEquals(mockSpan._events.length, 1);
      assertEquals(mockSpan._events[0]?.name, "user.action");
    });

    it("should add an event without attributes", () => {
      const mockSpan = createMockSpan();
      ops.addEvent(mockSpan, "checkpoint");
      assertEquals(mockSpan._events.length, 1);
      assertEquals(mockSpan._events[0]?.name, "checkpoint");
    });

    it("should handle null span gracefully", () => {
      ops.addEvent(null, "event.name");
    });

    it("should handle span.addEvent() throwing", () => {
      const badSpan = {
        addEvent() {
          throw new Error("addEvent failed");
        },
      } as unknown as Span;

      ops.addEvent(badSpan, "event");
    });
  });

  describe("createChildSpan", () => {
    it("should create a child span from parent", () => {
      const parentSpan = createMockSpan();
      const child = ops.createChildSpan(parentSpan, "child.operation");
      assertEquals(child !== null, true);
    });

    it("should create root span when parent is null", () => {
      const span = ops.createChildSpan(null, "root.operation");
      assertEquals(span !== null, true);
    });

    it("should accept span options for child span", () => {
      const parentSpan = createMockSpan();
      const child = ops.createChildSpan(parentSpan, "child.operation", {
        kind: "client",
        attributes: { "db.system": "postgres" },
      });
      assertEquals(child !== null, true);
    });

    it("should handle api.trace.setSpan() throwing", () => {
      const badApi = {
        ...api,
        trace: {
          ...api.trace,
          setSpan() {
            throw new Error("setSpan failed");
          },
        },
      } as OpenTelemetryAPI;

      const badOps = new SpanOperations(badApi, tracer);
      const parent = createMockSpan();
      const child = badOps.createChildSpan(parent, "child");
      assertEquals(child, null);
    });
  });

  describe("mapSpanKind (via startSpan)", () => {
    it("should map 'internal' kind", () => {
      const span = ops.startSpan("test", { kind: "internal" });
      assertEquals(span !== null, true);
    });

    it("should map 'server' kind", () => {
      const span = ops.startSpan("test", { kind: "server" });
      assertEquals(span !== null, true);
    });

    it("should map 'client' kind", () => {
      const span = ops.startSpan("test", { kind: "client" });
      assertEquals(span !== null, true);
    });

    it("should map 'producer' kind", () => {
      const span = ops.startSpan("test", { kind: "producer" });
      assertEquals(span !== null, true);
    });

    it("should map 'consumer' kind", () => {
      const span = ops.startSpan("test", { kind: "consumer" });
      assertEquals(span !== null, true);
    });

    it("should default to INTERNAL when kind is undefined", () => {
      const span = ops.startSpan("test", {});
      assertEquals(span !== null, true);
    });
  });
});
