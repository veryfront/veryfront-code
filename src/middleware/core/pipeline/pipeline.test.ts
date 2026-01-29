import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MiddlewarePipeline } from "./pipeline.ts";
import type { MiddlewareHandler } from "../types.ts";

describe("middleware/core/pipeline/MiddlewarePipeline", () => {
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
      const list = pipeline.getMiddleware();
      assertEquals(list.length, 2);
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

      // Request matching /api
      const res1 = await pipeline.execute(new Request("http://localhost/api/users"));
      assertEquals(res1.status, 404); // default not-found
      assertEquals(order, ["global", "api"]);

      // Request not matching /api
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
      pipeline.use((_c) => new Response("Hello"));

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

      // Second teardown should have no callbacks
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

      function namedMiddleware(_c: unknown, next: () => unknown) {
        return next();
      }

      pipeline.use(namedMiddleware as unknown as MiddlewareHandler);
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
