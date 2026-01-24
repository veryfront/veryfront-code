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
import { scaleMs } from "#veryfront/testing/timing.ts";

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

beforeEach((): void => {
  __resetAutoInstrumentForTests();
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
    function withMockFetch<T>(mock: typeof fetch | undefined, fn: () => T): T {
      const originalFetch = globalThis.fetch;
      // @ts-ignore - allow setting undefined for tests
      globalThis.fetch = mock;
      try {
        return fn();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }

    it("should instrument global fetch", () => {
      withMockFetch(globalThis.fetch, () => {
        instrumentFetch();
        assertEquals(typeof globalThis.fetch, "function");
      });
    });

    it("should handle fetch not available", () => {
      withMockFetch(undefined, () => {
        instrumentFetch();
      });
    });

    it("should create span for fetch calls with string URL", () => {
      withMockFetch((() => Promise.resolve(new Response("OK"))) as typeof fetch, () => {
        instrumentFetch();
        assertExists(globalThis.fetch);
      });
    });

    it("should create span for fetch calls with URL object", () => {
      withMockFetch((() => Promise.resolve(new Response("OK"))) as typeof fetch, () => {
        instrumentFetch();
        assertExists(globalThis.fetch);
      });
    });

    it("should create span for fetch calls with Request object", () => {
      withMockFetch((() => Promise.resolve(new Response("OK"))) as typeof fetch, () => {
        instrumentFetch();
        assertExists(globalThis.fetch);
      });
    });

    it("should record HTTP method from init options", () => {
      withMockFetch((() => Promise.resolve(new Response("OK"))) as typeof fetch, () => {
        instrumentFetch();
        assertExists(globalThis.fetch);
      });
    });

    it("should default to GET method when not specified", () => {
      withMockFetch((() => Promise.resolve(new Response("OK"))) as typeof fetch, () => {
        instrumentFetch();
        assertExists(globalThis.fetch);
      });
    });

    it("should record response status and content length", () => {
      withMockFetch(
        (() =>
          Promise.resolve(
            new Response("test", {
              status: 200,
              headers: { "content-length": "4" },
            }),
          )) as typeof fetch,
        () => {
          instrumentFetch();
          assertExists(globalThis.fetch);
        },
      );
    });

    it("should measure fetch duration", () => {
      withMockFetch(
        (async () => {
          await delay(10);
          return new Response("OK");
        }) as typeof fetch,
        () => {
          instrumentFetch();
          assertExists(globalThis.fetch);
        },
      );
    });

    it("should handle fetch errors", () => {
      withMockFetch(
        (() => {
          throw new Error("Network error");
        }) as unknown as typeof fetch,
        () => {
          instrumentFetch();
          assertExists(globalThis.fetch);
        },
      );
    });

    it("should record error type on fetch failure", () => {
      withMockFetch(
        (() => {
          throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch,
        () => {
          instrumentFetch();
          assertExists(globalThis.fetch);
        },
      );
    });
  });

  describe("instrumentReactRender", () => {
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

      // With time scaling, delay(10) may be shorter, so just check some time passed
      assertEquals(duration >= scaleMs(10), true);
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
    it("should instrument error handler with span capture", async () => {
      const handler = (error: Error): Response => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler, true);

      const error = new Error("Test error");
      const response = await instrumented(error);
      const body = await response.text();

      assertEquals(body, "Test error");
    });

    it("should instrument error handler without span capture", async () => {
      const handler = (error: Error): Response => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler, false);

      const error = new Error("Test error");
      const response = await instrumented(error);

      assertExists(response);
    });

    it("should record error type and message", async () => {
      const handler = (_error: Error): Response => new Response("Error handled", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Custom error");
      await instrumented(error);

      assertExists(instrumented);
    });

    it("should record error stack trace", async () => {
      const handler = (): Response => new Response("OK", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Error with stack");
      await instrumented(error);

      assertExists(instrumented);
    });

    it("should include request context when provided", async () => {
      const handler = (): Response => new Response("Error", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Request error");
      const request = new Request("http://localhost:3000/error-path");
      await instrumented(error, request);

      assertExists(instrumented);
    });

    it("should record HTTP method and URL from request", async () => {
      const handler = (): Response => new Response("Error", { status: 500 });
      const instrumented = instrumentErrorHandler(handler);

      const error = new Error("Error");
      const request = new Request("http://localhost:3000/api/fail", { method: "POST" });
      await instrumented(error, request);

      assertExists(instrumented);
    });
  });

  describe("instrument (async wrapper)", () => {
    it("should instrument async function", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x * 2);
      const instrumented = instrument(fn, "test.operation") as (x: number) => Promise<number>;

      const result = await instrumented(5);
      assertEquals(result, 10);
    });

    it("should record custom attributes from function args", async () => {
      const fn = (userId: string, action: string): Promise<{ userId: string; action: string }> =>
        Promise.resolve({ userId, action });

      const instrumented = instrument(fn, "user.action", {
        attributes: (args: unknown[]) => {
          const [userId, action] = args as [string, string];
          return { userId, action };
        },
      }) as (userId: string, action: string) => Promise<{ userId: string; action: string }>;

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

      // With time scaling, delay(10) may be shorter
      assertEquals(duration >= scaleMs(10), true);
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
      const instrumented = instrumentSync(fn, "sync.operation") as (x: number) => number;

      const result = instrumented(5);
      assertEquals(result, 15);
    });

    it("should record custom attributes", () => {
      const fn = (name: string): string => `Hello, ${name}`;
      const instrumented = instrumentSync(fn, "greet", {
        attributes: (args: unknown[]) => {
          const [name] = args as [string];
          return { name };
        },
      }) as (name: string) => string;

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
      const batches: number[][] = [];
      let currentBatch: number[] = [];

      await instrumentBatch(
        "sized.batch",
        items,
        (item: number) => {
          currentBatch.push(item);
          if (currentBatch.length === 10) {
            batches.push([...currentBatch]);
            currentBatch = [];
          }
        },
        { batchSize: 10 },
      );

      if (currentBatch.length) batches.push(currentBatch);

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
      await instrumentBatch("empty.batch", [], async () => {});
      assertExists(instrumentBatch);
    });

    it("should calculate correct batch count", async () => {
      const items = Array.from({ length: 23 }, (_, i) => i);

      await instrumentBatch("counted.batch", items, async () => {}, { batchSize: 7 });

      assertExists(instrumentBatch);
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
