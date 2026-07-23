import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AttributeValue, Span } from "#veryfront/observability/tracing/api-shim.ts";
import {
  endRequestTracing,
  executeWithTracingContext,
  setProjectAttributes,
  setRequestAttributes,
  startRequestTracing,
} from "./tracing.ts";

describe("server/runtime-handler/tracing", () => {
  function createRecordingSpan(attributes: Record<string, AttributeValue>): Span {
    const span: Span = {
      setAttribute(key, value) {
        attributes[key] = value;
        return span;
      },
      setAttributes(values) {
        Object.assign(attributes, values);
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
        return { traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 };
      },
      updateName() {},
    };
    return span;
  }

  describe("startRequestTracing", () => {
    it("should return a SpanInfo with span and context properties", () => {
      const req = new Request("http://localhost/test");
      const spanInfo = startRequestTracing(req, "/test");
      assertEquals("span" in spanInfo, true);
      assertEquals("context" in spanInfo, true);
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

    it("records only the bounded HTTP scheme", () => {
      const attributes: Record<string, AttributeValue> = {};
      const span = createRecordingSpan(attributes);
      const req = new Request(
        "https://private-host-canary.example/projects/private-project-canary?value=private-query-canary",
      );

      setRequestAttributes(span, req, new URL(req.url));

      assertEquals(attributes, { "http.scheme": "https" });
    });
  });

  describe("setProjectAttributes", () => {
    it("should not throw when span is null/undefined", () => {
      setProjectAttributes(null, "my-project", "production");
      setProjectAttributes(undefined, "my-project", "production");
    });

    it("should not throw when projectSlug is undefined", () => {
      setProjectAttributes({}, undefined, "production");
    });

    it("does not attach concrete project or environment identity", () => {
      const attributes: Record<string, AttributeValue> = {};
      const span = createRecordingSpan(attributes);

      setProjectAttributes(span, "private-project-canary", "private-environment-canary");

      assertEquals(attributes, {});
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
