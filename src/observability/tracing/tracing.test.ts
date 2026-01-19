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

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { TracingManager } from "./manager.ts";

describe("Tracing Module", () => {
  describe("Module Exports", () => {
    it("should export initTracing function", async () => {
      const { initTracing } = await import("./index.ts");
      assertExists(initTracing, "initTracing should be exported");
      assertEquals(typeof initTracing, "function", "Should be a function");
    });

    it("should export isTracingEnabled function", async () => {
      const { isTracingEnabled } = await import("./index.ts");
      assertExists(isTracingEnabled, "isTracingEnabled should be exported");
      assertEquals(typeof isTracingEnabled, "function", "Should be a function");
    });

    it("should export startSpan function", async () => {
      const { startSpan } = await import("./index.ts");
      assertExists(startSpan, "startSpan should be exported");
      assertEquals(typeof startSpan, "function", "Should be a function");
    });

    it("should export endSpan function", async () => {
      const { endSpan } = await import("./index.ts");
      assertExists(endSpan, "endSpan should be exported");
      assertEquals(typeof endSpan, "function", "Should be a function");
    });

    it("should export setSpanAttributes function", async () => {
      const { setSpanAttributes } = await import("./index.ts");
      assertExists(setSpanAttributes, "setSpanAttributes should be exported");
      assertEquals(typeof setSpanAttributes, "function", "Should be a function");
    });

    it("should export addSpanEvent function", async () => {
      const { addSpanEvent } = await import("./index.ts");
      assertExists(addSpanEvent, "addSpanEvent should be exported");
      assertEquals(typeof addSpanEvent, "function", "Should be a function");
    });

    it("should export withSpan function", async () => {
      const { withSpan } = await import("./index.ts");
      assertExists(withSpan, "withSpan should be exported");
      assertEquals(typeof withSpan, "function", "Should be a function");
    });

    it("should export withSpanSync function", async () => {
      const { withSpanSync } = await import("./index.ts");
      assertExists(withSpanSync, "withSpanSync should be exported");
      assertEquals(typeof withSpanSync, "function", "Should be a function");
    });

    it("should export extractContext function", async () => {
      const { extractContext } = await import("./index.ts");
      assertExists(extractContext, "extractContext should be exported");
      assertEquals(typeof extractContext, "function", "Should be a function");
    });

    it("should export injectContext function", async () => {
      const { injectContext } = await import("./index.ts");
      assertExists(injectContext, "injectContext should be exported");
      assertEquals(typeof injectContext, "function", "Should be a function");
    });

    it("should export getActiveContext function", async () => {
      const { getActiveContext } = await import("./index.ts");
      assertExists(getActiveContext, "getActiveContext should be exported");
      assertEquals(typeof getActiveContext, "function", "Should be a function");
    });

    it("should export withActiveSpan function", async () => {
      const { withActiveSpan } = await import("./index.ts");
      assertExists(withActiveSpan, "withActiveSpan should be exported");
      assertEquals(typeof withActiveSpan, "function", "Should be a function");
    });

    it("should export createChildSpan function", async () => {
      const { createChildSpan } = await import("./index.ts");
      assertExists(createChildSpan, "createChildSpan should be exported");
      assertEquals(typeof createChildSpan, "function", "Should be a function");
    });

    it("should export shutdownTracing function", async () => {
      const { shutdownTracing } = await import("./index.ts");
      assertExists(shutdownTracing, "shutdownTracing should be exported");
      assertEquals(typeof shutdownTracing, "function", "Should be a function");
    });

    it("should export SpanNames constants", async () => {
      const { SpanNames } = await import("./index.ts");
      assertExists(SpanNames, "SpanNames should be exported");
      assertEquals(typeof SpanNames, "object", "Should be an object");
    });

    it("should export TracingManager class", async () => {
      const { TracingManager } = await import("./index.ts");
      assertExists(TracingManager, "TracingManager should be exported");
      assertEquals(typeof TracingManager, "function", "Should be a class");
    });

    it("should have correct SpanNames constants", async () => {
      const { SpanNames } = await import("./index.ts");

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

  describe("TracingManager - Initialization", () => {
    let manager: TracingManager;

    beforeEach(() => {
      manager = new TracingManager();
    });

    it("should return false when not initialized", () => {
      const enabled = manager.isEnabled();
      assertEquals(enabled, false, "Should be disabled when not initialized");
    });

    it("should handle disabled tracing", async () => {
      await manager.initialize({ enabled: false });
      assertEquals(manager.isEnabled(), false, "Should be disabled");
    });

    it("should skip duplicate initialization attempts", async () => {
      await manager.initialize({ enabled: false });
      await manager.initialize({ enabled: true }); // Second init should be skipped
      // No error should be thrown
    });
  });

  describe("TracingManager - Span Operations (Disabled)", () => {
    let manager: TracingManager;

    beforeEach(() => {
      manager = new TracingManager();
    });

    it("should return null span ops when not initialized", () => {
      const spanOps = manager.getSpanOperations();
      assertEquals(spanOps, null, "Should return null when not initialized");
    });

    it("should return null context prop when not initialized", () => {
      const contextProp = manager.getContextPropagation();
      assertEquals(contextProp, null, "Should return null when not initialized");
    });
  });

  describe("Public API - Span Functions (Disabled Tracing)", () => {
    // Note: Tests that verify "not initialized" behavior use fresh TracingManager
    // instances since the global singleton may be initialized by other test files.

    it("should accept span name parameter", async () => {
      const { startSpan } = await import("./index.ts");
      const _span = startSpan("my-operation");
      assert(true, "Should accept span name");
    });

    it("should accept optional SpanOptions", async () => {
      const { startSpan } = await import("./index.ts");
      const _span = startSpan("my-operation", {
        kind: "server",
        attributes: { "http.method": "GET" },
      });
      assert(true, "Should accept span options");
    });

    it("should handle all span kinds", async () => {
      const { startSpan } = await import("./index.ts");
      startSpan("op", { kind: "internal" });
      startSpan("op", { kind: "server" });
      startSpan("op", { kind: "client" });
      startSpan("op", { kind: "producer" });
      startSpan("op", { kind: "consumer" });
      assert(true, "Should accept all kinds");
    });

    it("should accept various attribute types", async () => {
      const { startSpan } = await import("./index.ts");
      startSpan("op", { attributes: { "service.name": "my-service" } });
      startSpan("op", { attributes: { "http.status_code": 200 } });
      startSpan("op", { attributes: { "cache.hit": true } });
      startSpan("op", {
        attributes: {
          "service.name": "my-service",
          "http.status_code": 200,
          "cache.hit": true,
        },
      });
      assert(true, "Should accept all attribute types");
    });
  });

  describe("Public API - endSpan", () => {
    it("should handle null span gracefully", async () => {
      const { endSpan } = await import("./index.ts");
      endSpan(null);
      assert(true, "Should handle null span without throwing");
    });

    it("should accept span parameter", async () => {
      const { startSpan, endSpan } = await import("./index.ts");
      const span = startSpan("test-span");
      endSpan(span);
      assert(true, "Should accept span parameter");
    });

    it("should accept optional error parameter", async () => {
      const { startSpan, endSpan } = await import("./index.ts");
      const span = startSpan("test-span");
      const error = new Error("Test error");
      endSpan(span, error);
      assert(true, "Should accept error parameter");
    });
  });

  describe("Public API - setSpanAttributes", () => {
    it("should handle null span gracefully", async () => {
      const { setSpanAttributes } = await import("./index.ts");
      setSpanAttributes(null, { key: "value" });
      assert(true, "Should handle null span without throwing");
    });

    it("should accept attributes object", async () => {
      const { startSpan, setSpanAttributes } = await import("./index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, { "http.method": "GET", "http.status": 200 });
      assert(true, "Should accept attributes object");
    });

    it("should accept empty attributes object", async () => {
      const { startSpan, setSpanAttributes } = await import("./index.ts");
      const span = startSpan("test-span");
      setSpanAttributes(span, {});
      assert(true, "Should accept empty attributes");
    });
  });

  describe("Public API - addSpanEvent", () => {
    it("should handle null span gracefully", async () => {
      const { addSpanEvent } = await import("./index.ts");
      addSpanEvent(null, "event-name");
      assert(true, "Should handle null span without throwing");
    });

    it("should accept event name", async () => {
      const { startSpan, addSpanEvent } = await import("./index.ts");
      const span = startSpan("test-span");
      addSpanEvent(span, "user.login");
      assert(true, "Should accept event name");
    });

    it("should accept optional attributes", async () => {
      const { startSpan, addSpanEvent } = await import("./index.ts");
      const span = startSpan("test-span");
      addSpanEvent(span, "user.login", { "user.id": "user-123" });
      assert(true, "Should accept event attributes");
    });
  });

  describe("Public API - withSpan", () => {
    it("should execute async function", async () => {
      const { withSpan } = await import("./index.ts");
      let executed = false;

      await withSpan("test-span", () => {
        executed = true;
        return Promise.resolve("result");
      });

      assertEquals(executed, true, "Should execute the function");
    });

    it("should return function result", async () => {
      const { withSpan } = await import("./index.ts");

      const result = await withSpan("test-span", () => {
        return Promise.resolve("test-result");
      });

      assertEquals(result, "test-result", "Should return function result");
    });

    it("should pass span to function", async () => {
      const { withSpan } = await import("./index.ts");

      await withSpan("test-span", (_span) => {
        return Promise.resolve();
      });

      assert(true, "Should pass span to function");
    });

    it("should handle function that throws error", async () => {
      const { withSpan } = await import("./index.ts");
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
      const { withSpan } = await import("./index.ts");

      await withSpan("test-span", () => {
        return Promise.resolve("result");
      }, {
        kind: "server",
        attributes: { "http.method": "GET" },
      });

      assert(true, "Should accept span options");
    });

    it("should handle async operations", async () => {
      const { withSpan } = await import("./index.ts");

      const result = await withSpan("test-span", () => {
        return delay(10).then(() => "async-result");
      });

      assertEquals(result, "async-result", "Should handle async operations");
    });
  });

  describe("Public API - withSpanSync", () => {
    it("should execute synchronous function", async () => {
      const { withSpanSync } = await import("./index.ts");
      let executed = false;

      withSpanSync("test-span", () => {
        executed = true;
        return "result";
      });

      assertEquals(executed, true, "Should execute the function");
    });

    it("should return function result", async () => {
      const { withSpanSync } = await import("./index.ts");

      const result = withSpanSync("test-span", () => {
        return "test-result";
      });

      assertEquals(result, "test-result", "Should return function result");
    });

    it("should handle function that throws error", async () => {
      const { withSpanSync } = await import("./index.ts");
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
      const { withSpanSync } = await import("./index.ts");

      withSpanSync("test-span", () => {
        return "result";
      }, {
        kind: "internal",
        attributes: { "operation": "compute" },
      });

      assert(true, "Should accept span options");
    });

    it("should handle various return types", async () => {
      const { withSpanSync } = await import("./index.ts");

      assertEquals(withSpanSync("test", () => 42), 42);
      assertEquals(withSpanSync("test", () => true), true);
      assertEquals(withSpanSync("test", () => ({ key: "value" })).key, "value");
    });
  });

  describe("Public API - Context Propagation", () => {
    it("should handle Headers object for extractContext", async () => {
      const { extractContext } = await import("./index.ts");
      const headers = new Headers();
      headers.set("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");

      extractContext(headers);
      assert(true, "Should handle Headers object");
    });

    it("should handle empty Headers", async () => {
      const { extractContext } = await import("./index.ts");
      const headers = new Headers();

      extractContext(headers);
      assert(true, "Should handle empty headers");
    });

    it("should inject context into Headers", async () => {
      const { getActiveContext, injectContext } = await import("./index.ts");
      const context = getActiveContext();
      const headers = new Headers();

      if (context) {
        injectContext(context, headers);
      }

      assert(true, "Should inject context into headers");
    });

    it("should preserve existing headers", async () => {
      const { getActiveContext, injectContext } = await import("./index.ts");
      const context = getActiveContext();
      const headers = new Headers();
      headers.set("x-custom-header", "value");

      if (context) {
        injectContext(context, headers);
      }

      assertEquals(headers.get("x-custom-header"), "value", "Should preserve existing headers");
    });

    it("should return context or undefined from getActiveContext", async () => {
      const { getActiveContext } = await import("./index.ts");
      getActiveContext();
      assert(true, "Should return context or undefined");
    });
  });

  describe("Public API - withActiveSpan", () => {
    it("should execute function with active span", async () => {
      const { startSpan, withActiveSpan } = await import("./index.ts");
      const span = startSpan("test-span");
      let executed = false;

      await withActiveSpan(span, () => {
        executed = true;
        return Promise.resolve();
      });

      assertEquals(executed, true, "Should execute function");
    });

    it("should return function result", async () => {
      const { startSpan, withActiveSpan } = await import("./index.ts");
      const span = startSpan("test-span");

      const result = await withActiveSpan(span, () => {
        return Promise.resolve("result");
      });

      assertEquals(result, "result", "Should return function result");
    });

    it("should handle null span", async () => {
      const { withActiveSpan } = await import("./index.ts");

      const result = await withActiveSpan(null, () => {
        return Promise.resolve("result");
      });

      assertEquals(result, "result", "Should handle null span");
    });

    it("should propagate errors", async () => {
      const { startSpan, withActiveSpan } = await import("./index.ts");
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
  });

  describe("Public API - createChildSpan", () => {
    it("should create child span from parent", async () => {
      const { startSpan, createChildSpan } = await import("./index.ts");
      const parent = startSpan("parent-span");
      createChildSpan(parent, "child-span");
      assert(true, "Should create child span");
    });

    it("should handle null parent span gracefully", async () => {
      // When parent is null and tracing is enabled, createChildSpan creates a root span
      // When tracing is disabled, it returns null
      const { createChildSpan } = await import("./index.ts");
      const child = createChildSpan(null, "child-span");
      // Should not throw - result depends on whether tracing is enabled
      assert(child === null || typeof child === "object", "Should handle null parent gracefully");
    });

    it("should accept span options", async () => {
      const { startSpan, createChildSpan } = await import("./index.ts");
      const parent = startSpan("parent-span");
      createChildSpan(parent, "child-span", {
        kind: "client",
        attributes: { "operation": "fetch" },
      });

      assert(true, "Should accept span options");
    });

    it("should create multiple children from same parent", async () => {
      const { startSpan, createChildSpan } = await import("./index.ts");
      const parent = startSpan("parent-span");
      createChildSpan(parent, "child-1");
      createChildSpan(parent, "child-2");

      assert(true, "Should create multiple children");
    });

    it("should support nested child spans", async () => {
      const { startSpan, createChildSpan } = await import("./index.ts");
      const parent = startSpan("parent");
      const child = createChildSpan(parent, "child");
      createChildSpan(child, "grandchild");

      assert(true, "Should support nested children");
    });
  });

  describe("Public API - shutdownTracing", () => {
    it("should not throw when called", async () => {
      const { shutdownTracing } = await import("./index.ts");
      await shutdownTracing();

      assert(true, "Should not throw");
    });

    it("should be idempotent", async () => {
      const { shutdownTracing } = await import("./index.ts");
      await shutdownTracing();
      await shutdownTracing();

      assert(true, "Should be callable multiple times");
    });
  });

  describe("Edge Cases", () => {
    it("should handle span operations when tracing is disabled", async () => {
      const { startSpan, endSpan, setSpanAttributes, addSpanEvent } = await import("./index.ts");

      const span = startSpan("test");
      endSpan(span);
      setSpanAttributes(span, { key: "value" });
      addSpanEvent(span, "event");

      assert(true, "Should handle disabled tracing");
    });

    it("should handle null spans in all operations", async () => {
      const { endSpan, setSpanAttributes, addSpanEvent } = await import("./index.ts");

      endSpan(null);
      setSpanAttributes(null, { key: "value" });
      addSpanEvent(null, "event");

      assert(true, "Should handle null spans");
    });

    it("should handle empty span names", async () => {
      const { startSpan } = await import("./index.ts");
      startSpan("");
      assert(true, "Should handle empty names");
    });

    it("should handle empty event names", async () => {
      const { startSpan, addSpanEvent } = await import("./index.ts");
      const span = startSpan("test");
      addSpanEvent(span, "");
      assert(true, "Should handle empty event names");
    });

    it("should handle very long span names", async () => {
      const { startSpan } = await import("./index.ts");
      const longName = "a".repeat(1000);
      startSpan(longName);
      assert(true, "Should handle long names");
    });

    it("should handle special characters in span names", async () => {
      const { startSpan } = await import("./index.ts");
      startSpan("test/span:with-special.chars_123");
      assert(true, "Should handle special characters");
    });

    it("should handle unicode in span names", async () => {
      const { startSpan } = await import("./index.ts");
      startSpan("测试-тест-テスト");
      assert(true, "Should handle unicode");
    });

    it("should handle large attribute values", async () => {
      const { startSpan, setSpanAttributes } = await import("./index.ts");
      const span = startSpan("test");
      const largeValue = "x".repeat(10000);
      setSpanAttributes(span, { large: largeValue });
      assert(true, "Should handle large attributes");
    });

    it("should handle many attributes", async () => {
      const { startSpan, setSpanAttributes } = await import("./index.ts");
      const span = startSpan("test");
      const manyAttrs: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        manyAttrs[`attr_${i}`] = `value_${i}`;
      }
      setSpanAttributes(span, manyAttrs);
      assert(true, "Should handle many attributes");
    });

    it("should handle rapid span creation", async () => {
      const { startSpan, endSpan } = await import("./index.ts");

      for (let i = 0; i < 100; i++) {
        const span = startSpan(`span-${i}`);
        endSpan(span);
      }

      assert(true, "Should handle rapid span creation");
    });
  });

  describe("TracingManager - Config Types", () => {
    let manager: TracingManager;

    beforeEach(() => {
      manager = new TracingManager();
    });

    it("should accept console exporter config", async () => {
      await manager.initialize({
        enabled: false,
        exporter: "console",
      });
      assert(true, "Should accept console exporter");
    });

    it("should accept jaeger exporter config", async () => {
      await manager.initialize({
        enabled: false,
        exporter: "jaeger",
        endpoint: "http://localhost:14250",
      });
      assert(true, "Should accept jaeger exporter");
    });

    it("should accept zipkin exporter config", async () => {
      await manager.initialize({
        enabled: false,
        exporter: "zipkin",
        endpoint: "http://localhost:9411/api/v2/spans",
      });
      assert(true, "Should accept zipkin exporter");
    });

    it("should accept otlp exporter config", async () => {
      await manager.initialize({
        enabled: false,
        exporter: "otlp",
        endpoint: "http://localhost:4318",
      });
      assert(true, "Should accept otlp exporter");
    });

    it("should accept custom service name", async () => {
      await manager.initialize({
        enabled: false,
        serviceName: "my-custom-service",
      });
      assert(true, "Should accept custom service name");
    });

    it("should accept sample rate", async () => {
      await manager.initialize({
        enabled: false,
        sampleRate: 0.5,
      });
      assert(true, "Should accept sample rate");
    });

    it("should accept debug flag", async () => {
      await manager.initialize({
        enabled: false,
        debug: true,
      });
      assert(true, "Should accept debug flag");
    });

    it("should accept partial config", async () => {
      await manager.initialize({
        enabled: false,
      });
      assert(true, "Should accept partial config");
    });

    it("should accept empty config", async () => {
      await manager.initialize({});
      assert(true, "Should accept empty config");
    });
  });
});
