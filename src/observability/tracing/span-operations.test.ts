import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { SpanOperations } from "./span-operations.ts";
import type { OpenTelemetryAPI, Span, Tracer } from "./types.ts";

function createMockSpan(): Span & {
  _ended: boolean;
  _status: { code: number; message?: string } | null;
  _attributes: Record<string, unknown>;
  _events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  _exception: Error | null;
} {
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
    },
    setAttributes(attrs: Record<string, unknown>) {
      Object.assign(span._attributes, attrs);
    },
    setAttribute(key: string, value: unknown) {
      span._attributes[key] = value;
    },
    addEvent(name: string, attributes?: Record<string, unknown>) {
      span._events.push({ name, attributes });
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
  return span as Span & typeof span;
}

function createMockApi(): OpenTelemetryAPI {
  return {
    trace: {
      getTracer: () => createMockTracer(),
      setSpan: (_context: unknown, _span: unknown) => ({ _type: "context" }) as never,
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

function createMockTracer(): Tracer {
  return {
    startSpan: (_name: string, _options?: unknown, _context?: unknown) => createMockSpan(),
    startActiveSpan: (() => {}) as never,
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
    it("should end a span with OK status", () => {
      const mockSpan = createMockSpan();
      ops.endSpan(mockSpan);
      assertEquals(mockSpan._ended, true);
      assertEquals(mockSpan._status?.code, 1); // OK
    });

    it("should end a span with error status", () => {
      const mockSpan = createMockSpan();
      const error = new Error("test error");
      ops.endSpan(mockSpan, error);
      assertEquals(mockSpan._ended, true);
      assertEquals(mockSpan._status?.code, 2); // ERROR
      assertEquals(mockSpan._status?.message, "test error");
      assertEquals(mockSpan._exception, error);
    });

    it("should handle null span gracefully", () => {
      ops.endSpan(null);
      // Should not throw
    });

    it("should handle span.end() throwing", () => {
      const badSpan = {
        ...createMockSpan(),
        setStatus() {
          throw new Error("setStatus failed");
        },
      } as unknown as Span;
      ops.endSpan(badSpan);
      // Should not throw
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
      // Should not throw
    });

    it("should handle span.setAttributes() throwing", () => {
      const badSpan = {
        setAttributes() {
          throw new Error("setAttributes failed");
        },
      } as unknown as Span;
      ops.setAttributes(badSpan, { key: "value" });
      // Should not throw
    });
  });

  describe("addEvent", () => {
    it("should add an event to a span", () => {
      const mockSpan = createMockSpan();
      ops.addEvent(mockSpan, "user.action", { "user.id": "123" });
      assertEquals(mockSpan._events.length, 1);
      assertEquals(mockSpan._events[0].name, "user.action");
    });

    it("should add an event without attributes", () => {
      const mockSpan = createMockSpan();
      ops.addEvent(mockSpan, "checkpoint");
      assertEquals(mockSpan._events.length, 1);
      assertEquals(mockSpan._events[0].name, "checkpoint");
    });

    it("should handle null span gracefully", () => {
      ops.addEvent(null, "event.name");
      // Should not throw
    });

    it("should handle span.addEvent() throwing", () => {
      const badSpan = {
        addEvent() {
          throw new Error("addEvent failed");
        },
      } as unknown as Span;
      ops.addEvent(badSpan, "event");
      // Should not throw
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
