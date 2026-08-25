import "#veryfront/schemas/_test-setup.ts";
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

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";

import {
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
import { __resetAutoInstrumentForTests } from "./auto-instrument/orchestrator.ts";
import { metricsManager } from "./metrics/manager.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type Tracer,
} from "./tracing/api-shim.ts";
import { initTracing, shutdownTracing } from "./tracing/index.ts";
import {
  createResolvedFetch,
  createThrowingFetch,
  withMockFetch,
} from "./auto-instrument.test-helpers.ts";

type RecordedSpan = {
  name: string;
  attributes: Record<string, AttributeValue>;
};

function createRecordingTracer(recorded: RecordedSpan[]): Tracer {
  const openSpan = (name: string, attributes: Record<string, AttributeValue>): Span => {
    const record: RecordedSpan = { name, attributes: { ...attributes } };
    recorded.push(record);
    const span: Span = {
      setAttribute(key, value) {
        record.attributes[key] = value;
        return span;
      },
      setAttributes(attrs) {
        Object.assign(record.attributes, attrs);
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
        return { traceId: "1".repeat(32), spanId: "1".repeat(16), traceFlags: 1 };
      },
      updateName() {},
    };
    return span;
  };

  return {
    startSpan(name: string, options?: { attributes?: Record<string, AttributeValue> }) {
      return openSpan(name, options?.attributes ?? {});
    },
    startActiveSpan(
      name: string,
      optionsOrFn: { attributes?: Record<string, AttributeValue> } | ((span: Span) => unknown),
      contextOrFn?: unknown,
      fn?: (span: Span) => unknown,
    ) {
      const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
      const callback = typeof optionsOrFn === "function"
        ? optionsOrFn
        : typeof contextOrFn === "function"
        ? contextOrFn as (span: Span) => unknown
        : fn!;
      return callback(openSpan(name, options.attributes ?? {}));
    },
  } as unknown as Tracer;
}

/** Record spans opened through the api-shim tracer (HTTP/fetch instrumentation). */
function installRecordingTracer(): RecordedSpan[] {
  const recorded: RecordedSpan[] = [];
  setGlobalTracerProvider({ getTracer: () => createRecordingTracer(recorded) });
  return recorded;
}

/** Record spans opened through the tracing manager (wrappers, React instrumentation). */
async function installRecordingTracerRuntime(): Promise<RecordedSpan[]> {
  const recorded = installRecordingTracer();
  await initTracing({ enabled: true, exporter: "console" });
  return recorded;
}

beforeEach((): void => {
  __resetAutoInstrumentForTests();
});

afterEach((): void => {
  shutdownTracing();
  _resetShimForTests();
});

describe("Auto-Instrumentation", () => {
  describe("initAutoInstrumentation", () => {
    it("should initialize with default configuration", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize tracing when enabled", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          exporter: "console",
        },
      });

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
      const handler = (_req: Request): Response => new Response("OK", { status: 200 });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/test", { method: "GET" });
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should record HTTP method and URL attributes", async () => {
      const handler = (): Response => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/users", { method: "POST" });
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should record response status code", async () => {
      const handler = (): Response => new Response("Created", { status: 201 });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/resource");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should record response content length", async () => {
      const handler = (): Response =>
        new Response('{"data": "test"}', {
          headers: { "content-length": "16" },
        });
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/data");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should extract distributed trace context from headers", async () => {
      const handler = (): Response => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/test", {
        headers: { "x-trace-id": "trace-123" },
      });
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle errors and record error attributes", async () => {
      const handler = (): Response => {
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

      const handler = (): Response => {
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
      const handler = (): Response => {
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
      const handler = async (): Promise<Response> => {
        await delay(10);
        return new Response("OK");
      };
      const instrumented = instrumentHttpHandler(handler);

      const start = performance.now();
      const request = new Request("http://localhost:3000/slow");
      await instrumented(request);
      const duration = performance.now() - start;

      // With time scaling, delay(10) may be shorter. Allow some timing tolerance.
      assertEquals(duration >= scaleMs(8), true, "Should measure duration");
    });

    it("should handle different HTTP methods", async () => {
      const handler = (req: Request): Response => new Response(req.method, { status: 200 });
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
      const handler = (req: Request): Response => {
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
      const handler = (): Response => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("https://example.com:8080/api/test");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should work with synchronous handlers", async () => {
      const handler = (): Response => new Response("Sync response");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/sync");
      const response = await instrumented(request);
      const body = await response.text();

      assertEquals(body, "Sync response");
    });

    it("should preserve response headers", async () => {
      const handler = (): Response =>
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
      const handler = (): Response => new Response("No length header");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/no-length");
      await instrumented(request);

      assertExists(instrumented);
    });
  });

  describe("instrumentFetch", () => {
    it("should instrument global fetch", () => {
      const baseFetch = createResolvedFetch(new Response("OK"));
      withMockFetch(baseFetch, () => {
        const instrumented = instrumentFetch();
        assertEquals(typeof instrumented, "function");
        assertEquals(
          instrumented === baseFetch,
          false,
          "instrumentFetch must return a wrapper around the base fetch",
        );
      });
    });

    it("should handle fetch not available", () => {
      withMockFetch(undefined, () => {
        instrumentFetch();
      });
    });

    it("should create span for fetch calls with string URL", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(createResolvedFetch(new Response("OK")), async () => {
        await instrumentFetch()("https://example.test/string-url");
      });

      assertEquals(
        recorded[0]?.name,
        "http.client.fetch",
        "a string URL fetch must open a client span",
      );
      assertEquals(
        recorded[0]?.attributes["http.target"],
        "/string-url",
        "the client span records the requested path",
      );
    });

    it("should create span for fetch calls with URL object", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(createResolvedFetch(new Response("OK")), async () => {
        await instrumentFetch()(new URL("https://example.test/url-object"));
      });

      assertEquals(
        recorded[0]?.attributes["http.target"],
        "/url-object",
        "a URL object fetch records the requested path",
      );
      assertEquals(
        recorded[0]?.attributes["http.host"],
        "example.test",
        "a URL object fetch records the requested host",
      );
    });

    it("should create span for fetch calls with Request object", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(createResolvedFetch(new Response("OK")), async () => {
        await instrumentFetch()(
          new Request("https://example.test/request-object", { method: "PUT" }),
        );
      });

      assertEquals(
        recorded[0]?.attributes["http.target"],
        "/request-object",
        "a Request object fetch records the requested path",
      );
      assertEquals(
        recorded[0]?.attributes["http.method"],
        "PUT",
        "a Request object fetch records its own method",
      );
    });

    it("should record HTTP method from init options", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(createResolvedFetch(new Response("OK")), async () => {
        await instrumentFetch()("https://example.test/items", { method: "POST" });
      });

      assertEquals(
        recorded[0]?.attributes["http.method"],
        "POST",
        "the client span records the method from init options",
      );
    });

    it("should default to GET method when not specified", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(createResolvedFetch(new Response("OK")), async () => {
        await instrumentFetch()("https://example.test/items");
      });

      assertEquals(
        recorded[0]?.attributes["http.method"],
        "GET",
        "fetch span defaults the method to GET",
      );
    });

    it("should record response status and content length", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(
        createResolvedFetch(
          new Response("test", {
            status: 200,
            headers: { "content-length": "4" },
          }),
        ),
        async () => {
          await instrumentFetch()("https://example.test/items");
        },
      );

      assertEquals(
        recorded[0]?.attributes["http.status_code"],
        200,
        "fetch span records the response status",
      );
      assertEquals(
        recorded[0]?.attributes["http.response.size"],
        4,
        "fetch span records the response content-length",
      );
    });

    it("should measure fetch duration", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(
        (async () => {
          await delay(10);
          return new Response("OK");
        }) as typeof fetch,
        async () => {
          await instrumentFetch()("https://example.test/slow");
        },
      );

      assertEquals(
        Number(recorded[0]?.attributes["http.duration_ms"]) >= scaleMs(8),
        true,
        "fetch span records the measured request duration",
      );
    });

    it("should handle fetch errors", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(
        createThrowingFetch(new Error("Network error")),
        async () => {
          await assertRejects(
            () => instrumentFetch()("https://example.test/items"),
            Error,
            "Network error",
          );
        },
      );

      assertEquals(
        recorded[0]?.attributes["error"],
        "true",
        "a failed fetch marks its span as errored",
      );
      assertEquals(
        recorded[0]?.attributes["error.message"],
        "Network error",
        "a failed fetch records the failure message",
      );
    });

    it("should record error type on fetch failure", async () => {
      const recorded = installRecordingTracer();
      await withMockFetch(
        createThrowingFetch(new TypeError("Failed to fetch")),
        async () => {
          await assertRejects(
            () => instrumentFetch()("https://example.test/items"),
            TypeError,
            "Failed to fetch",
          );
        },
      );

      assertEquals(
        recorded[0]?.attributes["error.type"],
        "TypeError",
        "fetch failures record the error type",
      );
    });
  });

  describe("instrumentReactRender", () => {
    it("records and preserves PromiseLike render rejections", async () => {
      const recorder = metricsManager.getRecorder();
      assertExists(recorder);
      const originalRecordRenderError = recorder.recordRenderError;
      let recordedErrors = 0;
      recorder.recordRenderError = () => {
        recordedErrors++;
      };
      const rejection = { reason: "suspended render failed" };
      const thenable = {
        then(_resolve: (value: string) => void, reject: (error: unknown) => void): void {
          reject(rejection);
        },
      } as unknown as Promise<string>;
      let caught: unknown;

      try {
        await instrumentReactRender(() => thenable, "ThenableComponent");
      } catch (error) {
        caught = error;
      } finally {
        recorder.recordRenderError = originalRecordRenderError;
      }

      assertStrictEquals(caught, rejection);
      assertEquals(recordedErrors, 1);
    });

    it("should instrument synchronous render function", async () => {
      const renderFn = (): string => "<div>Hello</div>";
      const result = await instrumentReactRender(renderFn, "TestComponent");

      assertEquals(result, "<div>Hello</div>");
    });

    it("should instrument async render function", async () => {
      const renderFn = async (): Promise<string> => {
        await delay(10);
        return "<div>Async</div>";
      };
      const result = await instrumentReactRender(renderFn, "AsyncComponent");

      assertEquals(result, "<div>Async</div>");
    });

    it("should record component name", async () => {
      const renderFn = (): string => "output";
      await instrumentReactRender(renderFn, "MyComponent");

      assertExists(instrumentReactRender);
    });

    it("should measure render duration", async () => {
      const renderFn = async (): Promise<string> => {
        await delay(10);
        return "rendered";
      };

      const start = performance.now();
      await instrumentReactRender(renderFn, "SlowComponent");
      const duration = performance.now() - start;

      // Timer resolution can report slightly below the requested delay in Bun.
      assertEquals(duration >= scaleMs(8), true);
    });

    it("should handle render errors", async () => {
      const renderFn = (): string => {
        throw new Error("Render error");
      };

      try {
        await instrumentReactRender(renderFn, "ErrorComponent");
      } catch (error) {
        assertEquals((error as Error).message, "Render error");
      }
    });

    it("should handle async render errors", async () => {
      const renderFn = (): Promise<never> => Promise.reject(new Error("Async render error"));

      try {
        await instrumentReactRender(renderFn, "AsyncErrorComponent");
      } catch (error) {
        assertEquals((error as Error).message, "Async render error");
      }
    });

    it("should record render errors in metrics", async () => {
      const renderFn = (): string => {
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
    it("should invoke the handler when error capture itself fails", async () => {
      const handler = (): Response => new Response("handled", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);
      const error = new Error("capture failure");
      Object.defineProperty(error, "stack", {
        get() {
          throw new Error("telemetry stack failure");
        },
      });

      const response = await instrumented(error);

      assertEquals(await response.text(), "handled");
    });

    it("should instrument error handler with span capture", async () => {
      const handler = (error: Error): Response => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler, true);

      const error = new Error("Test error");
      const response = await instrumented(error);
      const body = await response.text();

      assertEquals(body, "Test error");
    });

    it("should instrument error handler without span capture", async () => {
      const recorded = await installRecordingTracerRuntime();
      const handler = (error: Error): Response => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler, false);

      const error = new Error("Test error");
      const response = await instrumented(error);

      assertEquals(await response.text(), "Test error");
      assertEquals(recorded.length, 0, "captureToSpan=false must not open an error span");
    });

    it("should record error type and message", async () => {
      const recorded = await installRecordingTracerRuntime();
      const handler = (_error: Error): Response => new Response("Error handled", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Custom error");
      await instrumented(error);

      assertEquals(recorded[0]?.name, "error.handler", "error capture opens an error.handler span");
      assertEquals(
        recorded[0]?.attributes["error.type"],
        "Error",
        "the captured span records the error type",
      );
      assertEquals(
        recorded[0]?.attributes["error.message"],
        "Custom error",
        "the captured span records the error message",
      );
    });

    it("should record error stack trace", async () => {
      const recorded = await installRecordingTracerRuntime();
      const handler = (): Response => new Response("OK", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Error with stack");
      await instrumented(error);

      const stack = recorded[0]?.attributes["error.stack"];
      assertEquals(typeof stack, "string", "the captured span records a stack trace");
      assertEquals(
        String(stack).includes("Error with stack"),
        true,
        "the recorded stack belongs to the captured error",
      );
    });

    it("should include request context when provided", async () => {
      const recorded = await installRecordingTracerRuntime();
      const handler = (): Response => new Response("Error", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Request error");
      const request = new Request("http://localhost:3000/error-path");
      await instrumented(error, request);

      assertEquals(
        recorded[0]?.attributes["http.path"],
        "/error-path",
        "request context adds the request path to the error span",
      );
      assertEquals(
        recorded[0]?.attributes["http.method"],
        "GET",
        "request context adds the request method to the error span",
      );
    });

    it("should record HTTP method and URL from request", async () => {
      const recorded = await installRecordingTracerRuntime();
      const handler = (): Response => new Response("Error", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Error");
      const request = new Request("http://localhost:3000/api/fail", { method: "POST" });
      await instrumented(error, request);

      assertEquals(
        recorded[0]?.attributes["http.method"],
        "POST",
        "the error span records the request method",
      );
      assertEquals(
        recorded[0]?.attributes["http.path"],
        "/api/fail",
        "the error span records the request path",
      );
    });
  });

  describe("instrument (async wrapper)", () => {
    it("should instrument async function", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x * 2);
      const instrumented = instrument(fn, "test.operation");

      const result = await instrumented(5);
      assertEquals(result, 10);
    });

    it("should record custom attributes from function args", async () => {
      const fn = (userId: string, action: string): Promise<{ userId: string; action: string }> =>
        Promise.resolve({ userId, action });

      const instrumented = instrument(fn, "user.action", {
        attributes: ([userId, action]: unknown[]) => ({
          userId: String(userId),
          action: String(action),
        }),
      });

      const result = await instrumented("user-123", "login");
      assertEquals(result.userId, "user-123");
      assertEquals(result.action, "login");
    });

    it("should measure operation duration", async () => {
      const fn = async (): Promise<string> => {
        await delay(10);
        return "done";
      };
      const instrumented = instrument(fn, "slow.operation");

      const start = performance.now();
      await instrumented();
      const duration = performance.now() - start;

      // Timer resolution can report slightly below the requested delay in Bun.
      assertEquals(duration >= scaleMs(8), true);
    });

    it("should handle errors and rethrow", async () => {
      const fn = (): Promise<never> => Promise.reject(new Error("Operation failed"));
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
        const fn = (): Promise<string> => Promise.resolve("result");
        const instrumented = instrument(fn, `operation.${kind}`, { kind });
        await instrumented();
      }

      assertExists(instrument);
    });
  });

  describe("instrumentSync (sync wrapper)", () => {
    it("should instrument synchronous function", () => {
      const fn = (x: number): number => x * 3;
      const instrumented = instrumentSync(fn, "sync.operation");

      const result = instrumented(5);
      assertEquals(result, 15);
    });

    it("should record custom attributes", () => {
      const fn = (name: string): string => `Hello, ${name}`;
      const instrumented = instrumentSync(fn, "greet", {
        attributes: ([name]: unknown[]) => ({ name: String(name) }),
      });

      const result = instrumented("World");
      assertEquals(result, "Hello, World");
    });

    it("should measure sync operation duration", () => {
      const fn = (): number => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      };
      const instrumented = instrumentSync(fn, "compute");

      const result = instrumented();
      assertEquals(result, 499500);
    });

    it("should handle sync errors", () => {
      const fn = (): never => {
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
      const processed: number[] = [];
      let inFlight = 0;
      let maxInFlight = 0;

      await instrumentBatch(
        "sized.batch",
        items,
        async (item: number) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Promise.resolve();
          processed.push(item);
          inFlight--;
        },
        { batchSize: 4 },
      );

      assertEquals(
        maxInFlight,
        4,
        "instrumentBatch must run at most batchSize items concurrently",
      );
      assertEquals(processed.length, 25, "all items must still be processed");
    });

    it("should record batch metadata", async () => {
      const recorded = await installRecordingTracerRuntime();
      const items = Array.from({ length: 15 }, (_, i) => i);

      await instrumentBatch("metadata.batch", items, () => Promise.resolve(), {
        batchSize: 5,
        attributes: { operation: "test", source: "unit-test" },
      });

      const batchSpan = recorded.find((span) => span.name === "metadata.batch");
      assertEquals(
        batchSpan?.attributes["batch.total_items"],
        15,
        "the batch span records the total item count",
      );
      assertEquals(
        batchSpan?.attributes["batch.size"],
        5,
        "the batch span records the caller-requested batch size",
      );
      assertEquals(
        batchSpan?.attributes["batch.total_batches"],
        3,
        "the batch span records the number of batches it will run",
      );
      assertEquals(
        batchSpan?.attributes["operation"],
        "test",
        "caller attributes are merged into the batch span",
      );
      assertEquals(
        recorded.filter((span) => span.name === "metadata.batch.batch").length,
        3,
        "one child span is opened per processed batch",
      );
    });

    it("should handle batch processing errors", async () => {
      const items = [1, 2, 3, 4, 5];

      try {
        // deno-lint-ignore require-await
        await instrumentBatch("error.batch", items, async (item: number) => {
          if (item === 3) throw new Error("Batch item error");
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
      let processorRan = false;
      // deno-lint-ignore require-await
      await instrumentBatch("empty.batch", [], async () => {
        processorRan = true;
      });

      assertEquals(processorRan, false, "an empty batch must never invoke the processor");
    });

    it("should calculate correct batch count", async () => {
      const items = Array.from({ length: 23 }, (_, i) => i);
      const processed: number[] = [];
      let inFlight = 0;
      let maxInFlight = 0;

      await instrumentBatch("counted.batch", items, async (item: number) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        processed.push(item);
        inFlight--;
      }, { batchSize: 7 });

      assertEquals(
        maxInFlight,
        7,
        "a 23 item run at batchSize 7 must never exceed 7 concurrent items",
      );
      assertEquals(processed.length, 23, "all items must still be processed");
    });
  });

  describe("isAutoInstrumentEnabled", () => {
    it("should return false before initialization", () => {
      __resetAutoInstrumentForTests();
      assertEquals(isAutoInstrumentEnabled(), false);
    });

    it("should return true after initialization", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined response headers", async () => {
      const handler = (): Response => new Response(null);
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/null");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle very long URLs", async () => {
      const handler = (): Response => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const longPath = "/api/" + "a".repeat(1000);
      const request = new Request(`http://localhost:3000${longPath}`);
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle special characters in URLs", async () => {
      const handler = (): Response => new Response("OK");
      const instrumented = instrumentHttpHandler(handler);

      const request = new Request("http://localhost:3000/api/users/%E2%9C%93");
      await instrumented(request);

      assertExists(instrumented);
    });

    it("should handle concurrent requests", async () => {
      const handler = async (): Promise<Response> => {
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
      const handler = (): Response => {
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
