import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  setRequestAttributes,
  setProjectAttributes,
  endRequestTracing,
  executeWithTracingContext,
  startRequestTracing,
} from "./tracing.ts";

describe("server/runtime-handler/tracing", () => {
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
  });

  describe("setProjectAttributes", () => {
    it("should not throw when span is null/undefined", () => {
      setProjectAttributes(null, "my-project", "production");
      setProjectAttributes(undefined, "my-project", "production");
    });

    it("should not throw when projectSlug is undefined", () => {
      setProjectAttributes({}, undefined, "production");
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
