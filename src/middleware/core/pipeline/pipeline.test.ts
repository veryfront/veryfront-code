import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import { MiddlewarePipeline } from "./pipeline.ts";
import type { MiddlewareHandler } from "../types.ts";

afterEach(() => {
  _resetShimForTests();
});

describe("middleware/core/pipeline/MiddlewarePipeline", () => {
  const encoder = new TextEncoder();
  const supportsByobReader = (body: ReadableStream<Uint8Array> | null): boolean => {
    if (!body) return false;

    try {
      const reader = body.getReader({ mode: "byob" });
      reader.releaseLock();
      return true;
    } catch {
      return false;
    }
  };

  describe("use", () => {
    it("should add middleware and return this for chaining", () => {
      const pipeline = new MiddlewarePipeline();
      const mw: MiddlewareHandler = (_c, next) => next();

      const result = pipeline.use(mw);

      assert(result === pipeline);
    });

    it("should add multiple middlewares via chaining", () => {
      const pipeline = new MiddlewarePipeline();
      const mw1: MiddlewareHandler = (_c, next) => next();
      const mw2: MiddlewareHandler = (_c, next) => next();

      pipeline.use(mw1).use(mw2);

      assertEquals(pipeline.getMiddleware().length, 2);
    });
  });

  describe("useFor", () => {
    it("should register scoped middleware and return this", () => {
      const pipeline = new MiddlewarePipeline();
      const mw: MiddlewareHandler = (_c, next) => next();

      const result = pipeline.useFor(/^\/api/, mw);

      assert(result === pipeline);
    });

    it("should apply scoped middleware only to matching paths", async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      const globalMw: MiddlewareHandler = async (_c, next) => {
        order.push("global");
        return await next();
      };

      const apiMw: MiddlewareHandler = async (_c, next) => {
        order.push("api");
        return await next();
      };

      pipeline.use(globalMw);
      pipeline.useFor(/^\/api/, apiMw);

      const res1 = await pipeline.execute(new Request("http://localhost/api/users"));
      assertEquals(res1.status, 404);
      assertEquals(order, ["global", "api"]);

      order.length = 0;
      await pipeline.execute(new Request("http://localhost/home"));
      assertEquals(order, ["global"]);
    });
  });

  describe("compose", () => {
    it("should return a composed middleware handler", () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use((_c, next) => next());

      const handler = pipeline.compose();

      assertEquals(typeof handler, "function");
    });
  });

  describe("execute", () => {
    it("should execute the pipeline and return a response", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(() => new Response("Hello"));

      const res = await pipeline.execute(new Request("http://localhost/"));

      assertEquals(res.status, 200);
      assertEquals(await res.text(), "Hello");
    });

    it("should return 404 when no middleware handles the request", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use((_c, next) => next());

      const res = await pipeline.execute(new Request("http://localhost/"));

      assertEquals(res.status, 404);
    });

    it("should return 500 on middleware error", async () => {
      const pipeline = new MiddlewarePipeline();
      pipeline.use(() => {
        throw new Error("test error");
      });

      const res = await pipeline.execute(new Request("http://localhost/"));

      assertEquals(res.status, 500);
    });

    it("should pass env and executionCtx to the context", async () => {
      const pipeline = new MiddlewarePipeline();
      let capturedEnv: Record<string, unknown> | undefined;

      pipeline.use((c) => {
        capturedEnv = c.env;
        return new Response("ok");
      });

      const env = { MY_VAR: "test" };
      await pipeline.execute(new Request("http://localhost/"), env);

      assertEquals(capturedEnv?.MY_VAR, "test");
    });

    it("should execute middlewares in the correct order", async () => {
      const pipeline = new MiddlewarePipeline();
      const order: number[] = [];

      pipeline.use(async (_c, next) => {
        order.push(1);
        const res = await next();
        order.push(4);
        return res;
      });

      pipeline.use(async (_c, next) => {
        order.push(2);
        const res = await next();
        order.push(3);
        return res;
      });

      await pipeline.execute(new Request("http://localhost/"));

      assertEquals(order, [1, 2, 3, 4]);
    });
  });

  describe("onTeardown", () => {
    it("should register teardown callback and return this", () => {
      const pipeline = new MiddlewarePipeline();

      const result = pipeline.onTeardown(() => {});

      assert(result === pipeline);
    });

    it("should run teardown callbacks after handle() response bodies finish", async () => {
      const pipeline = new MiddlewarePipeline();
      const called: number[] = [];

      pipeline.onTeardown(() => {
        called.push(1);
      });

      const response = await pipeline.handle(
        new Request("http://localhost/"),
        () => Response.json({ ok: true }),
      );

      assertEquals(response.status, 200);
      assertEquals(called, []);
      assertEquals(await response.json(), { ok: true });
      assertEquals(called, [1]);
    });

    it("should run teardown callbacks after execute() response bodies finish", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleaned = false;

      pipeline.onTeardown(() => {
        cleaned = true;
      });

      const response = await pipeline.execute(new Request("http://localhost/"));

      assertEquals(cleaned, false);
      assertEquals(await response.text(), "Not Found");
      assertEquals(cleaned, true);
    });

    it("should run teardown callbacks on every request without discarding them", async () => {
      const pipeline = new MiddlewarePipeline();
      let count = 0;

      pipeline.onTeardown(() => {
        count++;
      });

      const handler = () => Response.json({ ok: true });
      await (await pipeline.handle(new Request("http://localhost/"), handler)).text();
      await (await pipeline.handle(new Request("http://localhost/"), handler)).text();
      await (await pipeline.handle(new Request("http://localhost/"), handler)).text();

      assertEquals(count, 3);
    });

    it("should preserve the original response when no teardown callbacks are registered", async () => {
      const pipeline = new MiddlewarePipeline();
      const originalResponse = new Response("ok");

      const response = await pipeline.handle(
        new Request("http://localhost/"),
        () => originalResponse,
      );

      assert(response === originalResponse);
      assertEquals(await response.text(), "ok");
    });

    it("should preserve response metadata while deferring teardown for streaming bodies", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const originalResponse = await fetch("data:text/plain,wrapped metadata");
      const response = await pipeline.handle(
        new Request("http://localhost/"),
        () => originalResponse,
      );

      assert(response !== originalResponse);
      assertEquals(response.url, originalResponse.url);
      assertEquals(response.redirected, originalResponse.redirected);
      assertEquals(response.type, originalResponse.type);
      assertEquals(cleanupCount, 0);
      assertEquals(await response.text(), "wrapped metadata");
      assertEquals(cleanupCount, 1);
    });

    it("should preserve BYOB reader support when wrapping byte-stream responses", async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.onTeardown(() => {});

      const originalResponse = new Response(
        new ReadableStream({
          type: "bytes",
          start(controller) {
            controller.enqueue(encoder.encode("byob"));
            controller.close();
          },
        }),
      );
      assert(supportsByobReader(originalResponse.body));

      const response = await pipeline.handle(
        new Request("http://localhost/"),
        () => originalResponse,
      );

      assert(supportsByobReader(response.body));
      assertEquals(await response.text(), "byob");
    });

    it("should still run teardown callbacks when the handler throws", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleaned = false;

      pipeline.onTeardown(() => {
        cleaned = true;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/"),
        () => {
          throw new Error("handler blew up");
        },
      );

      assertEquals(response.status, 500);
      assertEquals(cleaned, true);
    });

    it("should defer teardown when middleware recovers from a handler error with a lazy stream", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      pipeline.use(async (_ctx, next) => {
        try {
          return await next();
        } catch {
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (cleanupCount > 0) {
                  controller.error(new Error("resource was cleaned before read"));
                  return;
                }

                controller.enqueue(encoder.encode("recovered"));
                controller.close();
              },
            }),
          );
        }
      });

      const response = await pipeline.handle(
        new Request("http://localhost/"),
        () => {
          throw new Error("handler blew up");
        },
      );

      assertEquals(cleanupCount, 0);
      assertEquals(await response.text(), "recovered");
      assertEquals(cleanupCount, 1);
    });

    it("should run teardown callbacks when execution rejects before a response exists", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });
      pipeline.use(() => {
        throw new Error("middleware blew up");
      });
      // The pipeline turns a middleware failure into a 500, so the rejection
      // has to come from the error response itself failing to build.
      const adapter = {
        env: {
          get() {
            throw new Error("adapter unavailable");
          },
        },
      };

      await assertRejects(
        () =>
          pipeline.execute(
            new Request("http://localhost/"),
            undefined,
            undefined,
            adapter as unknown as Parameters<MiddlewarePipeline["execute"]>[3],
          ),
        Error,
        "adapter unavailable",
      );
      assertEquals(cleanupCount, 1);
    });

    it("should keep execution working when the tracer provider fails", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });
      setGlobalTracerProvider({
        getTracer() {
          throw new Error("tracing unavailable");
        },
      });

      const response = await pipeline.execute(new Request("http://localhost/"));

      assertEquals(response.status, 404);
      assertEquals(await response.text(), "Not Found");
      assertEquals(cleanupCount, 1);
    });

    it("should defer handle() teardown until a streaming body reaches EOF", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;
      let controller!: ReadableStreamDefaultController<Uint8Array>;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                controller = c;
                c.enqueue(encoder.encode("first"));
              },
            }),
            {
              status: 201,
              statusText: "Created",
              headers: { "x-stream": "yes" },
            },
          ),
      );

      assertEquals(response.status, 201);
      assertEquals(response.statusText, "Created");
      assertEquals(response.headers.get("x-stream"), "yes");
      assertEquals(cleanupCount, 0);

      const reader = response.body?.getReader();
      assertExists(reader);
      assertEquals((await reader.read()).done, false);
      assertEquals(cleanupCount, 0);

      controller.close();
      assertEquals((await reader.read()).done, true);
      assertEquals(cleanupCount, 1);
      assertEquals((await reader.read()).done, true);
      assertEquals(cleanupCount, 1);
    });

    it("should defer execute() teardown until a streaming body reaches EOF", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;
      let controller!: ReadableStreamDefaultController<Uint8Array>;

      pipeline.use(() =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
              c.enqueue(encoder.encode("chunk"));
            },
          }),
        )
      );
      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.execute(new Request("http://localhost/stream"));

      assertEquals(cleanupCount, 0);
      const reader = response.body?.getReader();
      assertExists(reader);
      assertEquals((await reader.read()).done, false);
      assertEquals(cleanupCount, 0);

      controller.close();
      assertEquals((await reader.read()).done, true);
      assertEquals(cleanupCount, 1);
    });

    it("should run streaming teardown once when the body is canceled", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;
      let cancelReason: unknown;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode("partial"));
              },
              cancel(reason) {
                cancelReason = reason;
              },
            }),
          ),
      );

      assertEquals(cleanupCount, 0);
      const reader = response.body?.getReader();
      assertExists(reader);
      assertEquals((await reader.read()).done, false);

      await reader.cancel("client disconnected");

      assertEquals(cancelReason, "client disconnected");
      assertEquals(cleanupCount, 1);
    });

    it("should run teardown immediately when the response body is already locked", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;
      let heldReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/locked"),
        () => {
          const response = new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode("held"));
              },
            }),
          );
          heldReader = response.body?.getReader();
          return response;
        },
      );

      assertEquals(response.body?.locked, true);
      assertEquals(cleanupCount, 1);
      heldReader?.releaseLock();
    });

    it("should not throw when the response body is disturbed but unlocked", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/disturbed"),
        async () => {
          const response = new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode("already read"));
                controller.close();
              },
            }),
          );
          const reader = response.body?.getReader();
          assertExists(reader);
          await reader.read();
          reader.releaseLock();
          return response;
        },
      );

      assertEquals(response.bodyUsed, true);
      assertEquals(response.body?.locked, false);
      assertEquals(cleanupCount, 1);
    });

    it("should run streaming teardown once when a pending read is canceled", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                return new Promise(() => {});
              },
            }),
          ),
      );

      const reader = response.body?.getReader();
      assertExists(reader);
      const pendingRead = reader.read();

      await reader.cancel("client disconnected");
      assertEquals(cleanupCount, 1);
      assertEquals(await pendingRead, { done: true, value: undefined });
      assertEquals(cleanupCount, 1);
    });

    it("should run teardown when upstream stream cancellation stalls", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode("partial"));
              },
              cancel() {
                return new Promise(() => {});
              },
            }),
          ),
      );

      const reader = response.body?.getReader();
      assertExists(reader);
      assertEquals((await reader.read()).done, false);

      let cancelSettled = false;
      const cancelPromise = reader.cancel("client disconnected").then(() => {
        cancelSettled = true;
      });
      cancelPromise.catch(() => {});

      for (let i = 0; i < 10 && cleanupCount === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      assertEquals(cleanupCount, 1);
      assertEquals(cancelSettled, false);
    });

    it("should make concurrent stream terminal paths await the same teardown", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;
      let cleanupResolved = false;
      let resolveCleanup!: () => void;
      let controller!: ReadableStreamDefaultController<Uint8Array>;

      pipeline.onTeardown(async () => {
        cleanupCount++;
        await new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        });
        cleanupResolved = true;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                controller = c;
                c.enqueue(encoder.encode("chunk"));
              },
            }),
          ),
      );

      const reader = response.body?.getReader();
      assertExists(reader);
      assertEquals((await reader.read()).done, false);

      const eofRead = reader.read();
      controller.close();
      for (let i = 0; i < 10 && cleanupCount === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(cleanupCount, 1);

      let cancelResolved = false;
      const cancelPromise = reader.cancel("client disconnected").then(() => {
        cancelResolved = true;
      });
      await Promise.resolve();

      assertEquals(cancelResolved, false);
      assertEquals(cleanupResolved, false);
      resolveCleanup();
      await cancelPromise;
      assertEquals(await eofRead, { done: true, value: undefined });
      assertEquals(cleanupCount, 1);
      assertEquals(cleanupResolved, true);
    });

    it("should run streaming teardown once when the body errors", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;
      const streamError = new Error("stream source failed");

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode("partial"));
              },
              pull(controller) {
                controller.error(streamError);
              },
            }),
          ),
      );

      assertEquals(cleanupCount, 0);
      const reader = response.body?.getReader();
      assertExists(reader);
      assertEquals((await reader.read()).done, false);

      await assertRejects(
        () => reader.read(),
        Error,
        "stream source failed",
      );
      assertEquals(cleanupCount, 1);
    });

    it("should swallow cleanup failures after streaming EOF", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
        throw new Error("cleanup failed");
      });

      const response = await pipeline.handle(
        new Request("http://localhost/stream"),
        () => new Response(new ReadableStream<Uint8Array>({ start: (c) => c.close() })),
      );

      assertEquals(await response.text(), "");
      assertEquals(cleanupCount, 1);
    });

    it("should run teardown immediately for responses without a body", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleanupCount = 0;

      pipeline.onTeardown(() => {
        cleanupCount++;
      });

      const response = await pipeline.handle(
        new Request("http://localhost/no-content"),
        () => new Response(null, { status: 204 }),
      );

      assertEquals(response.status, 204);
      assertEquals(response.body, null);
      assertEquals(cleanupCount, 1);
    });
  });

  describe("teardown", () => {
    it("should call all registered teardown callbacks", async () => {
      const pipeline = new MiddlewarePipeline();
      const called: number[] = [];

      pipeline.onTeardown(() => {
        called.push(1);
      });
      pipeline.onTeardown(() => {
        called.push(2);
      });

      await pipeline.teardown();

      assertEquals(called, [1, 2]);
    });

    it("should clear callbacks after teardown", async () => {
      const pipeline = new MiddlewarePipeline();
      let count = 0;

      pipeline.onTeardown(() => {
        count++;
      });

      await pipeline.teardown();
      assertEquals(count, 1);

      await pipeline.teardown();
      assertEquals(count, 1);
    });

    it("should handle async teardown callbacks", async () => {
      const pipeline = new MiddlewarePipeline();
      let cleaned = false;

      pipeline.onTeardown(async () => {
        await new Promise((r) => setTimeout(r, 5));
        cleaned = true;
      });

      await pipeline.teardown();

      assertEquals(cleaned, true);
    });

    it("should continue teardown even if a callback throws", async () => {
      const pipeline = new MiddlewarePipeline();
      const called: number[] = [];

      pipeline.onTeardown(() => {
        called.push(1);
        throw new Error("teardown error");
      });
      pipeline.onTeardown(() => {
        called.push(2);
      });

      await pipeline.teardown();

      assertEquals(called, [1, 2]);
    });
  });

  describe("getMiddleware", () => {
    it("should return middleware info with names and order", () => {
      const pipeline = new MiddlewarePipeline();

      const namedMiddleware: MiddlewareHandler = (_c, next) => next();

      pipeline.use(namedMiddleware);
      pipeline.use((_c, next) => next());

      const list = pipeline.getMiddleware();
      assertEquals(list.length, 2);

      const first = list[0];
      const second = list[1];

      assertExists(first);
      assertExists(second);
      assertEquals(first.name, "namedMiddleware");
      assertEquals(first.order, 0);
      assertEquals(second.order, 1);
    });

    it("should return empty array for empty pipeline", () => {
      const pipeline = new MiddlewarePipeline();
      assertEquals(pipeline.getMiddleware(), []);
    });
  });
});
