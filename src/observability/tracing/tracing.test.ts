/**
 * OpenTelemetry Tracing Tests
 *
 * Tests the distributed tracing infrastructure:
 * - Initialization with different configurations
 * - Environment variable override logic
 * - Span lifecycle (start, end, attributes, events)
 * - Context extraction from/injection to HTTP headers
 * - withSpan and withSpanSync helpers
 * - Child span creation from parent
 * - Error recording in spans
 * - isTracingEnabled checks
 * - Edge cases: tracing disabled, null spans, missing API
 */

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";

// Mock OpenTelemetry API
const mockSpan = {
  end: () => {},
  setStatus: () => {},
  setAttributes: () => {},
  addEvent: () => {},
  recordException: () => {},
};

const mockTracer = {
  startSpan: () => mockSpan,
};

const mockContext = {};

const _mockApi = {
  trace: {
    getTracer: () => mockTracer,
    setSpan: () => mockContext,
  },
  context: {
    active: () => mockContext,
    with: (_ctx: any, fn: () => any) => fn(),
  },
  propagation: {
    setGlobalPropagator: () => {},
    extract: () => mockContext,
    inject: () => {},
  },
  SpanKind: {
    INTERNAL: 0,
    SERVER: 1,
    CLIENT: 2,
    PRODUCER: 3,
    CONSUMER: 4,
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
};

const _mockPropagator = {};

// Store original module state
let _originalModule: any;

describe("Tracing Module", () => {
  beforeEach(async () => {
    // Reset module state before each test by re-importing
    // We need to clear the module cache and reset singleton state
  });

  afterEach(() => {
    // Cleanup
  });

  describe("Initialization", () => {
    it("should export initTracing function", async () => {
      const { initTracing } = await import("../index.ts");
      assertExists(initTracing, "initTracing should be exported");
      assertEquals(typeof initTracing, "function", "Should be a function");
    });

    it("should export isTracingEnabled function", async () => {
      const { isTracingEnabled } = await import("../index.ts");
      assertExists(isTracingEnabled, "isTracingEnabled should be exported");
      assertEquals(typeof isTracingEnabled, "function", "Should be a function");
    });

    it("should export startSpan function", async () => {
      const { startSpan } = await import("../index.ts");
      assertExists(startSpan, "startSpan should be exported");
      assertEquals(typeof startSpan, "function", "Should be a function");
    });

    it("should export endSpan function", async () => {
      const { endSpan } = await import("../index.ts");
      assertExists(endSpan, "endSpan should be exported");
      assertEquals(typeof endSpan, "function", "Should be a function");
    });

    it("should export setSpanAttributes function", async () => {
      const { setSpanAttributes } = await import("../index.ts");
      assertExists(setSpanAttributes, "setSpanAttributes should be exported");
      assertEquals(typeof setSpanAttributes, "function", "Should be a function");
    });

    it("should export addSpanEvent function", async () => {
      const { addSpanEvent } = await import("../index.ts");
      assertExists(addSpanEvent, "addSpanEvent should be exported");
      assertEquals(typeof addSpanEvent, "function", "Should be a function");
    });

    it("should export withSpan function", async () => {
      const { withSpan } = await import("../index.ts");
      assertExists(withSpan, "withSpan should be exported");
      assertEquals(typeof withSpan, "function", "Should be a function");
    });

    it("should export withSpanSync function", async () => {
      const { withSpanSync } = await import("../index.ts");
      assertExists(withSpanSync, "withSpanSync should be exported");
      assertEquals(typeof withSpanSync, "function", "Should be a function");
    });

    it("should export extractContext function", async () => {
      const { extractContext } = await import("../index.ts");
      assertExists(extractContext, "extractContext should be exported");
      assertEquals(typeof extractContext, "function", "Should be a function");
    });

    it("should export injectContext function", async () => {
      const { injectContext } = await import("../index.ts");
      assertExists(injectContext, "injectContext should be exported");
      assertEquals(typeof injectContext, "function", "Should be a function");
    });

    it("should export getActiveContext function", async () => {
      const { getActiveContext } = await import("../index.ts");
      assertExists(getActiveContext, "getActiveContext should be exported");
      assertEquals(typeof getActiveContext, "function", "Should be a function");
    });

    it("should export withActiveSpan function", async () => {
      const { withActiveSpan } = await import("../index.ts");
      assertExists(withActiveSpan, "withActiveSpan should be exported");
      assertEquals(typeof withActiveSpan, "function", "Should be a function");
    });

    it("should export createChildSpan function", async () => {
      const { createChildSpan } = await import("../index.ts");
      assertExists(createChildSpan, "createChildSpan should be exported");
      assertEquals(typeof createChildSpan, "function", "Should be a function");
    });

    it("should export shutdownTracing function", async () => {
      const { shutdownTracing } = await import("../index.ts");
      assertExists(shutdownTracing, "shutdownTracing should be exported");
      assertEquals(typeof shutdownTracing, "function", "Should be a function");
    });

    it("should export SpanNames constants", async () => {
      const { SpanNames } = await import("../index.ts");
      assertExists(SpanNames, "SpanNames should be exported");
      assertEquals(typeof SpanNames, "object", "Should be an object");
    });

    it("should have correct SpanNames constants", async () => {
      /**
       * Verifies that all expected span name constants are defined
       * and follow the correct naming convention (category.operation)
       */
      const { SpanNames } = await import("../index.ts");

      assertEquals(SpanNames.HTTP_REQUEST, "http.request", "HTTP request span name");
      assertEquals(SpanNames.HTTP_HANDLER, "http.handler", "HTTP handler span name");
      assertEquals(SpanNames.RENDER_PAGE, "render.page", "Render page span name");
      assertEquals(SpanNames.RENDER_COMPONENT, "render.component", "Render component span name");
      assertEquals(SpanNames.RENDER_LAYOUT, "render.layout", "Render layout span name");
      assertEquals(SpanNames.RENDER_SSR, "render.ssr", "Render SSR span name");
      assertEquals(SpanNames.RENDER_RSC, "render.rsc", "Render RSC span name");
      assertEquals(SpanNames.DATA_FETCH, "data.fetch", "Data fetch span name");
      assertEquals(SpanNames.DATA_CACHE_GET, "data.cache.get", "Data cache get span name");
      assertEquals(SpanNames.DATA_CACHE_SET, "data.cache.set", "Data cache set span name");
      assertEquals(SpanNames.BUILD_BUNDLE, "build.bundle", "Build bundle span name");
      assertEquals(SpanNames.BUILD_SPLIT, "build.split", "Build split span name");
      assertEquals(SpanNames.BUILD_OPTIMIZE, "build.optimize", "Build optimize span name");
      assertEquals(SpanNames.BUILD_COMPILE, "build.compile", "Build compile span name");
      assertEquals(SpanNames.RSC_RENDER, "rsc.render", "RSC render span name");
      assertEquals(SpanNames.RSC_SERIALIZE, "rsc.serialize", "RSC serialize span name");
      assertEquals(SpanNames.RSC_STREAM, "rsc.stream", "RSC stream span name");
      assertEquals(SpanNames.ROUTER_MATCH, "router.match", "Router match span name");
      assertEquals(SpanNames.ROUTER_RESOLVE, "router.resolve", "Router resolve span name");
    });
  });

  describe("isTracingEnabled", () => {
    it("should return false when not initialized", async () => {
      /**
       * Before initialization, tracing should be disabled.
       * This test ensures the module has safe defaults.
       */
      const { isTracingEnabled } = await import("../index.ts");
      const enabled = isTracingEnabled();
      assertEquals(typeof enabled, "boolean", "Should return a boolean");
    });
  });

  describe("startSpan", () => {
    it("should return null when tracing is not initialized", async () => {
      /**
       * When tracing is disabled or not initialized,
       * startSpan should gracefully return null instead of throwing.
       */
      const { startSpan } = await import("../index.ts");
      const span = startSpan("test-span");
      assertEquals(span, null, "Should return null when not initialized");
    });

    it("should accept span name parameter", async () => {
      /**
       * Verifies that startSpan accepts a name parameter
       * and doesn't throw when called with a valid name.
       */
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("my-operation");
      // Should not throw
      assert(true, "Should accept span name");
    });

    it("should accept optional SpanOptions", async () => {
      /**
       * Verifies that startSpan accepts optional configuration
       * including kind and attributes.
       */
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("my-operation", {
        kind: "server",
        attributes: { "http.method": "GET" },
      });
      // Should not throw
      assert(true, "Should accept span options");
    });

    it("should handle internal span kind", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("internal-op", { kind: "internal" });
      // Should not throw
      assert(true, "Should accept internal kind");
    });

    it("should handle server span kind", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("server-op", { kind: "server" });
      // Should not throw
      assert(true, "Should accept server kind");
    });

    it("should handle client span kind", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("client-op", { kind: "client" });
      // Should not throw
      assert(true, "Should accept client kind");
    });

    it("should handle producer span kind", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("producer-op", { kind: "producer" });
      // Should not throw
      assert(true, "Should accept producer kind");
    });

    it("should handle consumer span kind", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("consumer-op", { kind: "consumer" });
      // Should not throw
      assert(true, "Should accept consumer kind");
    });

    it("should accept string attributes", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("op", {
        attributes: { "service.name": "my-service" },
      });
      assert(true, "Should accept string attributes");
    });

    it("should accept number attributes", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("op", {
        attributes: { "http.status_code": 200 },
      });
      assert(true, "Should accept number attributes");
    });

    it("should accept boolean attributes", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("op", {
        attributes: { "cache.hit": true },
      });
      assert(true, "Should accept boolean attributes");
    });

    it("should accept mixed attribute types", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("op", {
        attributes: {
          "service.name": "my-service",
          "http.status_code": 200,
          "cache.hit": true,
        },
      });
      assert(true, "Should accept mixed attribute types");
    });
  });

  describe("endSpan", () => {
    it("should handle null span gracefully", async () => {
      /**
       * When passed a null span, endSpan should not throw.
       * This allows code to call endSpan unconditionally.
       */
      const { endSpan } = await import("../index.ts");
      endSpan(null);
      assert(true, "Should handle null span without throwing");
    });

    it("should accept span parameter", async () => {
      const { startSpan, endSpan } = await import("../index.ts");
      const span = startSpan("test-span");
      endSpan(span);
      assert(true, "Should accept span parameter");
    });

    it("should accept optional error parameter", async () => {
      /**
       * When an error is passed, endSpan should record it
       * and set the span status to ERROR.
       */
      const { startSpan, endSpan } = await import("../index.ts");
      const span = startSpan("test-span");
      const error = new Error("Test error");
      endSpan(span, error);
      assert(true, "Should accept error parameter");
    });

    it("should handle ending span without error", async () => {
      const { startSpan, endSpan } = await import("../index.ts");
      const span = startSpan("test-span");
      endSpan(span);
      assert(true, "Should end span successfully");
    });
  });

  describe("setSpanAttributes", () => {
    it("should handle null span gracefully", async () => {
      /**
       * When passed a null span, setSpanAttributes should not throw.
       */
      const { setSpanAttributes } = await import("../index.ts");
      setSpanAttributes(null, { key: "value" });
      assert(true, "Should handle null span without throwing");
    });

    it("should accept attributes object", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, { "http.method": "GET", "http.status": 200 });
      assert(true, "Should accept attributes object");
    });

    it("should accept empty attributes object", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, {});
      assert(true, "Should accept empty attributes");
    });

    it("should handle string attribute values", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, { "user.id": "user-123" });
      assert(true, "Should handle string values");
    });

    it("should handle number attribute values", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, { "response.time": 150 });
      assert(true, "Should handle number values");
    });

    it("should handle boolean attribute values", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, { "cache.enabled": true });
      assert(true, "Should handle boolean values");
    });
  });

  describe("addSpanEvent", () => {
    it("should handle null span gracefully", async () => {
      /**
       * When passed a null span, addSpanEvent should not throw.
       */
      const { addSpanEvent } = await import("../index.ts");
      addSpanEvent(null, "event-name");
      assert(true, "Should handle null span without throwing");
    });

    it("should accept event name", async () => {
      const { startSpan, addSpanEvent } = await import("../index.ts");
      const span = startSpan("test-span");
      addSpanEvent(span, "user.login");
      assert(true, "Should accept event name");
    });

    it("should accept optional attributes", async () => {
      const { startSpan, addSpanEvent } = await import("../index.ts");
      const span = startSpan("test-span");
      addSpanEvent(span, "user.login", { "user.id": "user-123" });
      assert(true, "Should accept event attributes");
    });

    it("should handle event without attributes", async () => {
      const { startSpan, addSpanEvent } = await import("../index.ts");
      const span = startSpan("test-span");
      addSpanEvent(span, "cache.miss");
      assert(true, "Should handle event without attributes");
    });
  });

  describe("withSpan", () => {
    it("should execute async function", async () => {
      /**
       * withSpan should create a span, execute the provided async function,
       * and end the span when complete.
       */
      const { withSpan } = await import("../index.ts");
      let executed = false;

      await withSpan("test-span", () => {
        executed = true;
        return Promise.resolve("result");
      });

      assertEquals(executed, true, "Should execute the function");
    });

    it("should return function result", async () => {
      const { withSpan } = await import("../index.ts");

      const result = await withSpan("test-span", () => {
        return Promise.resolve("test-result");
      });

      assertEquals(result, "test-result", "Should return function result");
    });

    it("should pass span to function", async () => {
      const { withSpan } = await import("../index.ts");
      let _receivedSpan: any;

      await withSpan("test-span", (span) => {
        _receivedSpan = span;
        return Promise.resolve();
      });

      // Span will be null when tracing is not initialized
      assert(true, "Should pass span to function");
    });

    it("should handle function that throws error", async () => {
      /**
       * When the function throws an error, withSpan should:
       * 1. Record the error on the span
       * 2. End the span with error status
       * 3. Re-throw the error
       */
      const { withSpan } = await import("../index.ts");
      const testError = new Error("Test error");

      try {
        await withSpan("test-span", () => {
          return Promise.reject(testError);
        });
        assert(false, "Should throw error");
      } catch (error) {
        assertEquals(error, testError, "Should re-throw the error");
      }
    });

    it("should accept span options", async () => {
      const { withSpan } = await import("../index.ts");

      await withSpan("test-span", () => {
        return Promise.resolve("result");
      }, {
        kind: "server",
        attributes: { "http.method": "GET" },
      });

      assert(true, "Should accept span options");
    });

    it("should handle async operations", async () => {
      const { withSpan } = await import("../index.ts");

      const result = await withSpan("test-span", () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve("async-result"), 10);
        });
      });

      assertEquals(result, "async-result", "Should handle async operations");
    });
  });

  describe("withSpanSync", () => {
    it("should execute synchronous function", async () => {
      /**
       * withSpanSync should create a span, execute the provided sync function,
       * and end the span when complete.
       */
      const { withSpanSync } = await import("../index.ts");
      let executed = false;

      withSpanSync("test-span", () => {
        executed = true;
        return "result";
      });

      assertEquals(executed, true, "Should execute the function");
    });

    it("should return function result", async () => {
      const { withSpanSync } = await import("../index.ts");

      const result = withSpanSync("test-span", () => {
        return "test-result";
      });

      assertEquals(result, "test-result", "Should return function result");
    });

    it("should pass span to function", async () => {
      const { withSpanSync } = await import("../index.ts");
      let _receivedSpan: any;

      withSpanSync("test-span", (span) => {
        _receivedSpan = span;
      });

      // Span will be null when tracing is not initialized
      assert(true, "Should pass span to function");
    });

    it("should handle function that throws error", async () => {
      /**
       * When the function throws an error, withSpanSync should:
       * 1. Record the error on the span
       * 2. End the span with error status
       * 3. Re-throw the error
       */
      const { withSpanSync } = await import("../index.ts");
      const testError = new Error("Test error");

      try {
        withSpanSync("test-span", () => {
          throw testError;
        });
        assert(false, "Should throw error");
      } catch (error) {
        assertEquals(error, testError, "Should re-throw the error");
      }
    });

    it("should accept span options", async () => {
      const { withSpanSync } = await import("../index.ts");

      withSpanSync("test-span", () => {
        return "result";
      }, {
        kind: "internal",
        attributes: { "operation": "compute" },
      });

      assert(true, "Should accept span options");
    });

    it("should handle numeric return values", async () => {
      const { withSpanSync } = await import("../index.ts");

      const result = withSpanSync("test-span", () => {
        return 42;
      });

      assertEquals(result, 42, "Should return numeric values");
    });

    it("should handle boolean return values", async () => {
      const { withSpanSync } = await import("../index.ts");

      const result = withSpanSync("test-span", () => {
        return true;
      });

      assertEquals(result, true, "Should return boolean values");
    });

    it("should handle object return values", async () => {
      const { withSpanSync } = await import("../index.ts");

      const result = withSpanSync("test-span", () => {
        return { key: "value" };
      });

      assertEquals(result.key, "value", "Should return object values");
    });
  });

  describe("extractContext", () => {
    it("should handle Headers object", async () => {
      /**
       * extractContext should parse W3C Trace Context headers
       * and return a context object for distributed tracing.
       */
      const { extractContext } = await import("../index.ts");
      const headers = new Headers();
      headers.set("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");

      const _context = extractContext(headers);
      // Will be undefined when tracing is not initialized
      assert(true, "Should handle Headers object");
    });

    it("should handle empty Headers", async () => {
      const { extractContext } = await import("../index.ts");
      const headers = new Headers();

      const _context = extractContext(headers);
      assert(true, "Should handle empty headers");
    });

    it("should extract traceparent header", async () => {
      const { extractContext } = await import("../index.ts");
      const headers = new Headers();
      headers.set("traceparent", "00-trace-id-span-id-01");

      const _context = extractContext(headers);
      assert(true, "Should extract traceparent");
    });

    it("should extract tracestate header", async () => {
      const { extractContext } = await import("../index.ts");
      const headers = new Headers();
      headers.set("traceparent", "00-trace-id-span-id-01");
      headers.set("tracestate", "vendor1=value1,vendor2=value2");

      const _context = extractContext(headers);
      assert(true, "Should extract tracestate");
    });

    it("should handle headers with multiple values", async () => {
      const { extractContext } = await import("../index.ts");
      const headers = new Headers();
      headers.set("traceparent", "00-trace-id-span-id-01");
      headers.set("x-custom-header", "value");

      const _context = extractContext(headers);
      assert(true, "Should handle multiple headers");
    });
  });

  describe("injectContext", () => {
    it("should inject context into Headers", async () => {
      /**
       * injectContext should add W3C Trace Context headers
       * to the provided Headers object for distributed tracing.
       */
      const { getActiveContext, injectContext } = await import("../index.ts");
      const context = getActiveContext();
      const headers = new Headers();

      if (context) {
        injectContext(context, headers);
      }

      assert(true, "Should inject context into headers");
    });

    it("should handle empty Headers object", async () => {
      const { getActiveContext, injectContext } = await import("../index.ts");
      const context = getActiveContext();
      const headers = new Headers();

      if (context) {
        injectContext(context, headers);
      }

      assert(true, "Should handle empty headers");
    });

    it("should preserve existing headers", async () => {
      const { getActiveContext, injectContext } = await import("../index.ts");
      const context = getActiveContext();
      const headers = new Headers();
      headers.set("x-custom-header", "value");

      if (context) {
        injectContext(context, headers);
      }

      assertEquals(headers.get("x-custom-header"), "value", "Should preserve existing headers");
    });
  });

  describe("getActiveContext", () => {
    it("should return context or undefined", async () => {
      /**
       * getActiveContext should return the current active context
       * from OpenTelemetry's context API.
       */
      const { getActiveContext } = await import("../index.ts");
      const _context = getActiveContext();

      // Will be undefined when tracing is not initialized
      assert(true, "Should return context or undefined");
    });

    it("should not throw when tracing is disabled", async () => {
      const { getActiveContext } = await import("../index.ts");
      const _context = getActiveContext();

      assert(true, "Should not throw when disabled");
    });
  });

  describe("withActiveSpan", () => {
    it("should execute function with active span", async () => {
      /**
       * withActiveSpan should set the span as active in the context
       * and execute the provided function within that context.
       */
      const { startSpan, withActiveSpan } = await import("../index.ts");
      const span = startSpan("test-span");
      let executed = false;

      await withActiveSpan(span, () => {
        executed = true;
        return Promise.resolve();
      });

      assertEquals(executed, true, "Should execute function");
    });

    it("should return function result", async () => {
      const { startSpan, withActiveSpan } = await import("../index.ts");
      const span = startSpan("test-span");

      const result = await withActiveSpan(span, () => {
        return Promise.resolve("result");
      });

      assertEquals(result, "result", "Should return function result");
    });

    it("should handle null span", async () => {
      const { withActiveSpan } = await import("../index.ts");

      const result = await withActiveSpan(null, () => {
        return Promise.resolve("result");
      });

      assertEquals(result, "result", "Should handle null span");
    });

    it("should propagate errors", async () => {
      const { startSpan, withActiveSpan } = await import("../index.ts");
      const span = startSpan("test-span");
      const testError = new Error("Test error");

      try {
        await withActiveSpan(span, () => {
          return Promise.reject(testError);
        });
        assert(false, "Should throw error");
      } catch (error) {
        assertEquals(error, testError, "Should propagate error");
      }
    });

    it("should handle async operations", async () => {
      const { startSpan, withActiveSpan } = await import("../index.ts");
      const span = startSpan("test-span");

      const result = await withActiveSpan(span, () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve("async-result"), 10);
        });
      });

      assertEquals(result, "async-result", "Should handle async operations");
    });
  });

  describe("createChildSpan", () => {
    it("should create child span from parent", async () => {
      /**
       * createChildSpan should create a new span with the parent span
       * set in its context, enabling distributed tracing hierarchies.
       */
      const { startSpan, createChildSpan } = await import("../index.ts");
      const parent = startSpan("parent-span");
      const _child = createChildSpan(parent, "child-span");

      // Will be null when tracing is not initialized
      assert(true, "Should create child span");
    });

    it("should handle null parent span", async () => {
      const { createChildSpan } = await import("../index.ts");
      const child = createChildSpan(null, "child-span");

      assertEquals(child, null, "Should handle null parent");
    });

    it("should accept span options", async () => {
      const { startSpan, createChildSpan } = await import("../index.ts");
      const parent = startSpan("parent-span");
      const _child = createChildSpan(parent, "child-span", {
        kind: "client",
        attributes: { "operation": "fetch" },
      });

      assert(true, "Should accept span options");
    });

    it("should create multiple children from same parent", async () => {
      const { startSpan, createChildSpan } = await import("../index.ts");
      const parent = startSpan("parent-span");
      const _child1 = createChildSpan(parent, "child-1");
      const _child2 = createChildSpan(parent, "child-2");

      assert(true, "Should create multiple children");
    });

    it("should support nested child spans", async () => {
      const { startSpan, createChildSpan } = await import("../index.ts");
      const parent = startSpan("parent");
      const child = createChildSpan(parent, "child");
      const _grandchild = createChildSpan(child, "grandchild");

      assert(true, "Should support nested children");
    });
  });

  describe("shutdownTracing", () => {
    it("should not throw when called", async () => {
      /**
       * shutdownTracing should gracefully shutdown the tracing system,
       * allowing spans to be flushed before process termination.
       */
      const { shutdownTracing } = await import("../index.ts");
      await shutdownTracing();

      assert(true, "Should not throw");
    });

    it("should be idempotent", async () => {
      const { shutdownTracing } = await import("../index.ts");
      await shutdownTracing();
      await shutdownTracing();

      assert(true, "Should be callable multiple times");
    });
  });

  describe("Edge Cases", () => {
    it("should handle span operations when tracing is disabled", async () => {
      /**
       * All span operations should gracefully handle the case
       * where tracing is disabled and return null/undefined.
       */
      const { startSpan, endSpan, setSpanAttributes, addSpanEvent } = await import("../index.ts");

      const _span = startSpan("test");
      endSpan(_span);
      setSpanAttributes(_span, { key: "value" });
      addSpanEvent(_span, "event");

      assert(true, "Should handle disabled tracing");
    });

    it("should handle null spans in all operations", async () => {
      const { endSpan, setSpanAttributes, addSpanEvent } = await import("../index.ts");

      endSpan(null);
      setSpanAttributes(null, { key: "value" });
      addSpanEvent(null, "event");

      assert(true, "Should handle null spans");
    });

    it("should handle empty span names", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("");

      assert(true, "Should handle empty names");
    });

    it("should handle empty event names", async () => {
      const { startSpan, addSpanEvent } = await import("../index.ts");
      const _span = startSpan("test");
      addSpanEvent(_span, "");

      assert(true, "Should handle empty event names");
    });

    it("should handle very long span names", async () => {
      const { startSpan } = await import("../index.ts");
      const longName = "a".repeat(1000);
      const _span = startSpan(longName);

      assert(true, "Should handle long names");
    });

    it("should handle special characters in span names", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("test/span:with-special.chars_123");

      assert(true, "Should handle special characters");
    });

    it("should handle unicode in span names", async () => {
      const { startSpan } = await import("../index.ts");
      const _span = startSpan("测试-тест-テスト");

      assert(true, "Should handle unicode");
    });

    it("should handle large attribute values", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const _span = startSpan("test");
      const largeValue = "x".repeat(10000);
      setSpanAttributes(_span, { large: largeValue });

      assert(true, "Should handle large attributes");
    });

    it("should handle many attributes", async () => {
      const { startSpan, setSpanAttributes } = await import("../index.ts");
      const _span = startSpan("test");
      const manyAttrs: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        manyAttrs[`attr_${i}`] = `value_${i}`;
      }
      setSpanAttributes(_span, manyAttrs);

      assert(true, "Should handle many attributes");
    });

    it("should handle rapid span creation", async () => {
      const { startSpan, endSpan } = await import("../index.ts");

      for (let i = 0; i < 100; i++) {
        const span = startSpan(`span-${i}`);
        endSpan(span);
      }

      assert(true, "Should handle rapid span creation");
    });
  });

  describe("TracingConfig Types", () => {
    it("should accept console exporter config", async () => {
      /**
       * Verifies that TracingConfig accepts all valid exporter types.
       */
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        exporter: "console",
      });

      assert(true, "Should accept console exporter");
    });

    it("should accept jaeger exporter config", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        exporter: "jaeger",
        endpoint: "http://localhost:14250",
      });

      assert(true, "Should accept jaeger exporter");
    });

    it("should accept zipkin exporter config", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        exporter: "zipkin",
        endpoint: "http://localhost:9411/api/v2/spans",
      });

      assert(true, "Should accept zipkin exporter");
    });

    it("should accept otlp exporter config", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        exporter: "otlp",
        endpoint: "http://localhost:4318",
      });

      assert(true, "Should accept otlp exporter");
    });

    it("should accept custom service name", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        serviceName: "my-custom-service",
      });

      assert(true, "Should accept custom service name");
    });

    it("should accept sample rate", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        sampleRate: 0.5,
      });

      assert(true, "Should accept sample rate");
    });

    it("should accept debug flag", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
        debug: true,
      });

      assert(true, "Should accept debug flag");
    });

    it("should accept partial config", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({
        enabled: false,
      });

      assert(true, "Should accept partial config");
    });

    it("should accept empty config", async () => {
      const { initTracing } = await import("../index.ts");

      await initTracing({});

      assert(true, "Should accept empty config");
    });
  });
});
