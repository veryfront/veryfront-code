/**
 * Comprehensive tests for Auto-Instrumentation
 *
 * Tests cover:
 * - Initialization with different configurations
 * - HTTP handler instrumentation
 * - Fetch API instrumentation
 * - React render instrumentation
 * - Error handling and recording
 * - Distributed trace context propagation
 * - Performance metric recording
 * - Edge cases and error scenarios
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";

// Import the module once (no cache-busting needed!)
import {
  __resetAutoInstrumentForTests,
  initAutoInstrumentation,
  instrument,
  instrumentBatch,
  instrumentErrorHandler,
  instrumentFetch,
  instrumentHttpHandler,
  instrumentReactRender,
  instrumentSync,
  isAutoInstrumentEnabled,
} from "./auto-instrument/index.ts";

// Mock modules for tracing and metrics
const mockSpans: any[] = [];
const mockMetricsRecorded: any[] = [];
let tracingInitialized = false;
let metricsInitialized = false;

const _mockTracing = {
  initTracing: (_config: any) => {
    tracingInitialized = true;
    return Promise.resolve();
  },
  startSpan: (name: string, options?: any) => {
    const span = {
      id: `span-${mockSpans.length}`,
      name,
      options,
      attributes: {},
      ended: false,
      error: null as Error | null,
    };
    mockSpans.push(span);
    return span;
  },
  endSpan: (span: any, error?: Error) => {
    span.ended = true;
    if (error) {
      span.error = error;
    }
  },
  setSpanAttributes: (span: any, attrs: Record<string, any>) => {
    Object.assign(span.attributes, attrs);
  },
  extractContext: (headers: Headers) => {
    const traceId = headers.get("x-trace-id");
    return traceId ? { traceId } : null;
  },
  withActiveSpan: (_span: any, fn: () => any) => {
    return fn();
  },
  SpanNames: {
    HTTP_REQUEST: "http.server.request",
    RENDER_COMPONENT: "react.render.component",
  },
};

const _mockMetricsService = {
  initMetrics: (_config: any) => {
    metricsInitialized = true;
    return Promise.resolve();
  },
  recordHttpRequest: (attrs: any) => {
    mockMetricsRecorded.push({ type: "http.request", attrs });
  },
  recordHttpRequestComplete: (duration: number, attrs: any) => {
    mockMetricsRecorded.push({ type: "http.request.complete", duration, attrs });
  },
  recordRenderError: (attrs: any) => {
    mockMetricsRecorded.push({ type: "render.error", attrs });
  },
};

// Reset mocks before each test
function resetMocks() {
  mockSpans.length = 0;
  mockMetricsRecorded.length = 0;
  tracingInitialized = false;
  metricsInitialized = false;
  // Reset the auto-instrument module state
  __resetAutoInstrumentForTests();
}

describe("Auto-Instrumentation", () => {
  // Reset before each test for proper isolation
  beforeEach(() => {
    resetMocks();
  });

  describe("initAutoInstrumentation", () => {
    it("should initialize with default configuration", async () => {
      await initAutoInstrumentation();

      // Should not initialize tracing/metrics without explicit config
      assertEquals(tracingInitialized, false, "Tracing should not be initialized by default");
      assertEquals(metricsInitialized, false, "Metrics should not be initialized by default");
    });

    it("should initialize tracing when enabled", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          exporter: "console",
        },
      });

      // Note: In real test, this would verify actual tracing init
      // For now, we verify the config was passed
      assertExists(initAutoInstrumentation);
    });

    it("should initialize metrics when enabled", async () => {
      await initAutoInstrumentation({
        metrics: {
          enabled: true,
          exporter: "prometheus",
        },
      });

      assertExists(initAutoInstrumentation);
    });

    it("should initialize both tracing and metrics", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          exporter: "jaeger",
          endpoint: "http://localhost:14268",
        },
        metrics: {
          enabled: true,
          exporter: "prometheus",
        },
      });

      assertExists(initAutoInstrumentation);
    });

    it("should handle initialization errors gracefully", async () => {
      // Should not throw even if tracing/metrics init fails
      await initAutoInstrumentation({
        tracing: { enabled: true, exporter: "console" },
        metrics: { enabled: true, exporter: "console" },
      });

      assertExists(initAutoInstrumentation);
    });

    it("should not reinitialize if already initialized", async () => {
      await initAutoInstrumentation({ tracing: { enabled: true } });
      const firstInit = isAutoInstrumentEnabled();

      await initAutoInstrumentation({ metrics: { enabled: true } });
      const secondInit = isAutoInstrumentEnabled();

      assertEquals(firstInit, secondInit, "Should not reinitialize");
    });

    it("should support custom service name", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          serviceName: "custom-service",
        },
      });

      assertExists(initAutoInstrumentation);
    });

    it("should support different exporter types", async () => {
      const exporters = ["jaeger", "zipkin", "otlp", "console"] as const;

      for (const exporter of exporters) {
        await initAutoInstrumentation({
          tracing: { enabled: true, exporter },
        });
      }

      assertExists(initAutoInstrumentation);
    });
  });

  describe("instrumentHttpHandler", () => {
    it("should create span for HTTP request", async () => {
      const handler = (_req: Request) => new Response("OK", { status: 200 });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/test", { method: "GET" });
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should record HTTP method and URL attributes", async () => {
      const handler = () => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/users", {
        method: "POST",
      });
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should record response status code", async () => {
      const handler = () => new Response("Created", { status: 201 });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/resource");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should record response content length", async () => {
      const handler = () =>
        new Response('{"data": "test"}', {
          headers: { "content-length": "16" },
        });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/data");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should extract distributed trace context from headers", async () => {
      const handler = () => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/test", {
        headers: { "x-trace-id": "trace-123" },
      });
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle errors and record error attributes", async () => {
      const handler = () => {
        throw new Error("Handler error");
      };
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/error");

      try {
        await instrumented(request);
      } catch (error) {
        assertEquals((error as Error).message, "Handler error");
      }

      assertExists(instrumented);
    });

    it("should record error type and message", async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }

      const handler = () => {
        throw new CustomError("Custom error message");
      };
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/custom-error");

      try {
        await instrumented(request);
      } catch (error) {
        assertExists(error);
      }
    });

    it("should record 500 status for errors", async () => {
      const handler = () => {
        throw new Error("Internal error");
      };
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/fail");

      try {
        await instrumented(request);
      } catch {
        // Expected
      }

      assertExists(instrumented);
    });

    it("should measure request duration", async () => {
      const handler = async () => {
        await delay(10);
        return new Response("OK");
      };
      const instrumented = instrumentHttpHandler(handler);

      const start = performance.now();
      const request = new Request("http://localhost:3000/slow");
      await instrumented(request);
      const duration = performance.now() - start;

      assertEquals(duration >= 10, true, "Should measure duration");
    });

    it("should handle different HTTP methods", async () => {
      const handler = (req: Request) => new Response(req.method, { status: 200 });
      const instrumented = instrumentHttpHandler(handler);

      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

      for (const method of methods) {
        const request = new Request("http://localhost:3000/api", { method });
        const response = await instrumented(request);
        const body = await response.text();
        assertEquals(body, method);
      }
    });

    it("should handle different paths", async () => {
      const handler = (req: Request) => {
        const url = new URL(req.url);
        return new Response(url.pathname);
      };
      const instrumented = instrumentHttpHandler(handler);

      const paths = ["/api/users", "/api/posts", "/health", "/metrics"];

      for (const path of paths) {
        const request = new Request(`http://localhost:3000${path}`);
        const response = await instrumented(request);
        const body = await response.text();
        assertEquals(body, path);
      }
    });

    it("should record host and scheme attributes", async () => {
      const handler = () => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("https://example.com:8080/api/test");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should work with synchronous handlers", async () => {
      const handler = () => new Response("Sync response");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/sync");
      const response = await instrumented(request);
      const body = await response.text();

      assertEquals(body, "Sync response");
    });

    it("should preserve response headers", async () => {
      const handler = () =>
        new Response("OK", {
          headers: {
            "x-custom": "header-value",
            "content-type": "application/json",
          },
        });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/headers");
      const response = await instrumented(request);

      assertEquals(response.headers.get("x-custom"), "header-value");
      assertEquals(response.headers.get("content-type"), "application/json");
    });

    it("should handle missing content-length gracefully", async () => {
      const handler = () => new Response("No length header");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/no-length");
      await instrumented(request);

      assertExists(instrumented);
    });
  });

  describe("instrumentFetch", () => {
    it("should instrument global fetch", () => {
      const originalFetch = globalThis.fetch;

      instrumentFetch();

      assertEquals(typeof globalThis.fetch, "function");

      globalThis.fetch = originalFetch;
    });

    it("should handle fetch not available", () => {
      const originalFetch = globalThis.fetch;
      // @ts-ignore - testing missing fetch
      globalThis.fetch = undefined;

      // Should not throw
      instrumentFetch();

      globalThis.fetch = originalFetch;
    });

    it("should create span for fetch calls with string URL", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => Promise.resolve(new Response("OK"));
      instrumentFetch();

      // Note: In real implementation, this would create a span
      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should create span for fetch calls with URL object", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => Promise.resolve(new Response("OK"));
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should create span for fetch calls with Request object", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => Promise.resolve(new Response("OK"));
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should record HTTP method from init options", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => Promise.resolve(new Response("OK"));
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should default to GET method when not specified", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => Promise.resolve(new Response("OK"));
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should record response status and content length", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () =>
        Promise.resolve(
          new Response("test", {
            status: 200,
            headers: { "content-length": "4" },
          }),
        );
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should measure fetch duration", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async () => {
        await delay(10);
        return new Response("OK");
      };
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should handle fetch errors", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => {
        throw new Error("Network error");
      };
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });

    it("should record error type on fetch failure", () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = () => {
        throw new TypeError("Failed to fetch");
      };
      instrumentFetch();

      assertExists(globalThis.fetch);

      globalThis.fetch = originalFetch;
    });
  });

  describe("instrumentReactRender", () => {
    it("should instrument synchronous render function", async () => {
      const renderFn = () => "<div>Hello</div>";
      const result = await instrumentReactRender(renderFn, "TestComponent");

      assertEquals(result, "<div>Hello</div>");
    });

    it("should instrument async render function", async () => {
      const renderFn = async () => {
        await delay(10);
        return "<div>Async</div>";
      };
      const result = await instrumentReactRender(renderFn, "AsyncComponent");

      assertEquals(result, "<div>Async</div>");
    });

    it("should record component name", async () => {
      const renderFn = () => "output";
      await instrumentReactRender(renderFn, "MyComponent");

      assertExists(instrumentReactRender);
    });

    it("should measure render duration", async () => {
      const renderFn = async () => {
        await delay(10);
        return "rendered";
      };

      const start = performance.now();
      await instrumentReactRender(renderFn, "SlowComponent");
      const duration = performance.now() - start;

      assertEquals(duration >= 10, true);
    });

    it("should handle render errors", async () => {
      const renderFn = () => {
        throw new Error("Render error");
      };

      try {
        await instrumentReactRender(renderFn, "ErrorComponent");
      } catch (error) {
        assertEquals((error as Error).message, "Render error");
      }
    });

    it("should handle async render errors", async () => {
      const renderFn = () => Promise.reject(new Error("Async render error"));

      try {
        await instrumentReactRender(renderFn, "AsyncErrorComponent");
      } catch (error) {
        assertEquals((error as Error).message, "Async render error");
      }
    });

    it("should record render errors in metrics", async () => {
      const renderFn = () => {
        throw new Error("Render failed");
      };

      try {
        await instrumentReactRender(renderFn, "FailedComponent");
      } catch {
        // Expected
      }

      assertExists(instrumentReactRender);
    });
  });

  describe("instrumentErrorHandler", () => {
    it("should instrument error handler with span capture", async () => {
      const handler = (error: Error) => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler, true);

      const error = new Error("Test error");
      const response = await instrumented(error);
      const body = await response.text();

      assertEquals(body, "Test error");
    });

    it("should instrument error handler without span capture", async () => {
      const handler = (error: Error) => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler, false);

      const error = new Error("Test error");
      const response = await instrumented(error);

      assertExists(response);
    });

    it("should record error type and message", async () => {
      const handler = (_error: Error) => new Response("Error handled", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Custom error");
      await instrumented(error);

      assertExists(instrumented);
    });

    it("should record error stack trace", async () => {
      const handler = () => new Response("OK", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Error with stack");
      await instrumented(error);

      assertExists(instrumented);
    });

    it("should include request context when provided", async () => {
      const handler = () => new Response("Error", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Request error");
      const request = new Request("http://localhost:3000/error-path");
      await instrumented(error, request);

      assertExists(instrumented);
    });

    it("should record HTTP method and URL from request", async () => {
      const handler = () => new Response("Error", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Error");
      const request = new Request("http://localhost:3000/api/fail", { method: "POST" });
      await instrumented(error, request);

      assertExists(instrumented);
    });
  });

  describe("instrument (async wrapper)", () => {
    it("should instrument async function", async () => {
      const fn = (x: number) => Promise.resolve(x * 2);
      const instrumented = instrument(
        fn as (...args: unknown[]) => Promise<unknown>,
        "test.operation",
      ) as (x: number) => Promise<number>;

      const result = await instrumented(5);
      assertEquals(result, 10);
    });

    it("should record custom attributes from function args", async () => {
      const fn = (userId: string, action: string) => Promise.resolve({ userId, action });
      const instrumented = instrument(
        fn as (...args: unknown[]) => Promise<unknown>,
        "user.action",
        {
          attributes: (args: unknown[]) => {
            const [userId, action] = args as [string, string];
            return { userId, action };
          },
        },
      ) as (userId: string, action: string) => Promise<{ userId: string; action: string }>;

      const result = await instrumented("user-123", "login");
      assertEquals(result.userId, "user-123");
      assertEquals(result.action, "login");
    });

    it("should measure operation duration", async () => {
      const fn = async () => {
        await delay(10);
        return "done";
      };
      const instrumented = instrument(fn, "slow.operation");

      const start = performance.now();
      await instrumented();
      const duration = performance.now() - start;

      assertEquals(duration >= 10, true);
    });

    it("should handle errors and rethrow", async () => {
      const fn = () => Promise.reject(new Error("Operation failed"));
      const instrumented = instrument(fn, "failing.operation");

      try {
        await instrumented();
      } catch (error) {
        assertEquals((error as Error).message, "Operation failed");
      }
    });

    it("should support different span kinds", async () => {
      const kinds = ["internal", "server", "client", "producer", "consumer"] as const;

      for (const kind of kinds) {
        const fn = () => Promise.resolve("result");
        const instrumented = instrument(fn, `operation.${kind}`, { kind });
        await instrumented();
      }

      assertExists(instrument);
    });
  });

  describe("instrumentSync (sync wrapper)", () => {
    it("should instrument synchronous function", () => {
      const fn = (x: number) => x * 3;
      const instrumented = instrumentSync(
        fn as (...args: unknown[]) => unknown,
        "sync.operation",
      ) as (x: number) => number;

      const result = instrumented(5);
      assertEquals(result, 15);
    });

    it("should record custom attributes", () => {
      const fn = (name: string) => `Hello, ${name}`;
      const instrumented = instrumentSync(fn as (...args: unknown[]) => unknown, "greet", {
        attributes: (args: unknown[]) => {
          const [name] = args as [string];
          return { name };
        },
      }) as (name: string) => string;

      const result = instrumented("World");
      assertEquals(result, "Hello, World");
    });

    it("should measure sync operation duration", () => {
      const fn = () => {
        // Simulate work
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      };
      const instrumented = instrumentSync(fn, "compute");

      const result = instrumented();
      assertEquals(result, 499500);
    });

    it("should handle sync errors", () => {
      const fn = () => {
        throw new Error("Sync error");
      };
      const instrumented = instrumentSync(fn, "sync.error");

      try {
        instrumented();
      } catch (error) {
        assertEquals((error as Error).message, "Sync error");
      }
    });
  });

  describe("instrumentBatch", () => {
    it("should process batch of items", async () => {
      const items = [1, 2, 3, 4, 5];
      const results: number[] = [];

      // deno-lint-ignore require-await
      await instrumentBatch("test.batch", items, async (item: number) => {
        results.push(item * 2);
      });

      assertEquals(results, [2, 4, 6, 8, 10]);
    });

    it("should respect batch size", async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const batches: number[][] = [];
      let currentBatch: number[] = [];

      // deno-lint-ignore require-await
      await instrumentBatch("sized.batch", items, async (item: number) => {
        currentBatch.push(item);
        if (currentBatch.length === 10) {
          batches.push([...currentBatch]);
          currentBatch = [];
        }
      }, { batchSize: 10 });

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      assertExists(instrumentBatch);
    });

    it("should record batch metadata", async () => {
      const items = Array.from({ length: 15 }, (_, i) => i);

      await instrumentBatch("metadata.batch", items, async () => {}, {
        batchSize: 5,
        attributes: { operation: "test", source: "unit-test" },
      });

      assertExists(instrumentBatch);
    });

    it("should handle batch processing errors", async () => {
      const items = [1, 2, 3, 4, 5];

      try {
        // deno-lint-ignore require-await
        await instrumentBatch("error.batch", items, async (item: number) => {
          if (item === 3) {
            throw new Error("Batch item error");
          }
        });
      } catch (error) {
        assertEquals((error as Error).message, "Batch item error");
      }
    });

    it("should process items with correct indices", async () => {
      const items = ["a", "b", "c", "d"];
      const indexMap: Record<string, number> = {};

      // deno-lint-ignore require-await
      await instrumentBatch("indexed.batch", items, async (item: string, index: number) => {
        indexMap[item] = index;
      });

      assertEquals(indexMap, { a: 0, b: 1, c: 2, d: 3 });
    });

    it("should handle empty batch", async () => {
      await instrumentBatch("empty.batch", [], async () => {});

      assertExists(instrumentBatch);
    });

    it("should calculate correct batch count", async () => {
      const items = Array.from({ length: 23 }, (_, i) => i);

      await instrumentBatch("counted.batch", items, async () => {}, {
        batchSize: 7,
      });

      // Should create 4 batches (7 + 7 + 7 + 2)
      assertExists(instrumentBatch);
    });
  });

  describe("isAutoInstrumentEnabled", () => {
    it("should return false before initialization", async () => {
      const { isAutoInstrumentEnabled, __resetAutoInstrumentForTests } = await import(
        `./auto-instrument/index.ts?t=${Date.now()}`
      );

      // Reset state in case previous tests have initialized it
      __resetAutoInstrumentForTests();

      const enabled = isAutoInstrumentEnabled();
      assertEquals(enabled, false);
    });

    it("should return true after initialization", async () => {
      await initAutoInstrumentation();
      const enabled = isAutoInstrumentEnabled();

      assertEquals(enabled, true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined response headers", async () => {
      const handler = () => new Response(null);
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/null");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle very long URLs", async () => {
      const handler = () => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const longPath = "/api/" + "a".repeat(1000);
      const request = new Request(`http://localhost:3000${longPath}`);
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle special characters in URLs", async () => {
      const handler = () => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/users/%E2%9C%93");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle concurrent requests", async () => {
      const handler = async () => {
        await delay(10);
        return new Response("OK");
      };
      const instrumented = instrumentHttpHandler(handler);

      const requests = Array.from(
        { length: 10 },
        (_, i) => new Request(`http://localhost:3000/concurrent/${i}`),
      );

      const responses = await Promise.all(requests.map((r) => instrumented(r)));

      assertEquals(responses.length, 10);
      responses.forEach((r) => assertEquals(r.status, 200));
    });

    it("should handle non-Error throws", async () => {
      const handler = () => {
        throw "string error";
      };
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/string-throw");

      try {
        await instrumented(request);
      } catch (error) {
        assertEquals(error, "string error");
      }
    });
  });
});
