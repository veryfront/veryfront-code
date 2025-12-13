import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { MiddlewarePipeline } from "./pipeline.ts";
import type { MiddlewareHandler } from "../types.ts";
import { HTTP_NOT_FOUND } from "@veryfront/utils";

describe("MiddlewarePipeline", () => {
  it("should create pipeline instance", () => {
    const pipeline = new MiddlewarePipeline();
    assertExists(pipeline);
  });

  it("should add middleware with use()", () => {
    const pipeline = new MiddlewarePipeline();
    const middleware: MiddlewareHandler = (_ctx, next) => next();

    const result = pipeline.use(middleware);

    assertEquals(result, pipeline); // Should return this for chaining
  });

  it("should chain multiple use() calls", () => {
    const pipeline = new MiddlewarePipeline();
    const mw1: MiddlewareHandler = (_ctx, next) => next();
    const mw2: MiddlewareHandler = (_ctx, next) => next();
    const mw3: MiddlewareHandler = (_ctx, next) => next();

    const result = pipeline.use(mw1).use(mw2).use(mw3);

    assertEquals(result, pipeline);
  });

  it("should add scoped middleware with useFor()", () => {
    const pipeline = new MiddlewarePipeline();
    const middleware: MiddlewareHandler = (_ctx, next) => next();

    const result = pipeline.useFor(/^\/api/, middleware);

    assertEquals(result, pipeline);
  });

  it("should compose middleware", () => {
    const pipeline = new MiddlewarePipeline();
    const middleware: MiddlewareHandler = (_ctx, next) => next();
    pipeline.use(middleware);

    const composed = pipeline.compose();

    assertExists(composed);
    assertEquals(typeof composed, "function");
  });

  it("should execute pipeline and return response", async () => {
    const pipeline = new MiddlewarePipeline();
    const middleware: MiddlewareHandler = () => new Response("OK", { status: 200 });
    pipeline.use(middleware);

    const req = new Request("http://localhost/test");
    const response = await pipeline.execute(req);

    assertExists(response);
    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text, "OK");
  });

  it("should execute with env", async () => {
    const pipeline = new MiddlewarePipeline();
    let capturedEnv: Record<string, unknown> = {};
    const middleware: MiddlewareHandler = (ctx, next) => {
      capturedEnv = ctx.env;
      return next();
    };
    pipeline.use(middleware);

    const req = new Request("http://localhost/test");
    const env = { API_KEY: "secret" };
    await pipeline.execute(req, env);

    assertEquals(capturedEnv.API_KEY, "secret");
  });

  it("should execute with execution context", async () => {
    const pipeline = new MiddlewarePipeline();
    let capturedExecutionCtx;
    const middleware: MiddlewareHandler = (ctx, next) => {
      capturedExecutionCtx = ctx.executionCtx;
      return next();
    };
    pipeline.use(middleware);

    const req = new Request("http://localhost/test");
    const executionCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };
    await pipeline.execute(req, {}, executionCtx);

    assertEquals(capturedExecutionCtx, executionCtx);
  });

  it("should register teardown callback", () => {
    const pipeline = new MiddlewarePipeline();
    const callback = () => {};

    const result = pipeline.onTeardown(callback);

    assertEquals(result, pipeline);
  });

  it("should execute teardown callbacks", async () => {
    const pipeline = new MiddlewarePipeline();
    let called = false;
    pipeline.onTeardown(() => {
      called = true;
    });

    await pipeline.teardown();

    assertEquals(called, true);
  });

  it("should execute multiple teardown callbacks", async () => {
    const pipeline = new MiddlewarePipeline();
    const calls: number[] = [];
    pipeline.onTeardown(() => {
      calls.push(1);
    });
    pipeline.onTeardown(() => {
      calls.push(2);
    });
    pipeline.onTeardown(() => {
      calls.push(3);
    });

    await pipeline.teardown();

    assertEquals(calls, [1, 2, 3]);
  });

  it("should handle async teardown callbacks", async () => {
    const pipeline = new MiddlewarePipeline();
    let called = false;
    pipeline.onTeardown(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      called = true;
    });

    await pipeline.teardown();

    assertEquals(called, true);
  });

  it("should clear teardown callbacks after execution", async () => {
    const pipeline = new MiddlewarePipeline();
    let callCount = 0;
    pipeline.onTeardown(() => {
      callCount++;
    });

    await pipeline.teardown();
    await pipeline.teardown();

    assertEquals(callCount, 1);
  });

  it("should handle teardown callback errors gracefully", async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.onTeardown(() => {
      throw new Error("Teardown error");
    });

    // Should not throw
    await pipeline.teardown();
  });

  it("should get middleware list", () => {
    const pipeline = new MiddlewarePipeline();
    const mw1: MiddlewareHandler = function middleware1(_ctx, next) {
      return next();
    };
    const mw2: MiddlewareHandler = function middleware2(_ctx, next) {
      return next();
    };

    pipeline.use(mw1).use(mw2);

    const middlewares = pipeline.getMiddleware();

    assertEquals(middlewares.length, 2);
    assertExists(middlewares[0]);
    assertEquals(middlewares[0].name, "middleware1");
    assertEquals(middlewares[0].order, 0);
    assertExists(middlewares[1]);
    assertEquals(middlewares[1].name, "middleware2");
    assertEquals(middlewares[1].order, 1);
  });

  it("should handle anonymous middleware", () => {
    const pipeline = new MiddlewarePipeline();
    const middleware: MiddlewareHandler = (_ctx, next) => next();
    pipeline.use(middleware);

    const middlewares = pipeline.getMiddleware();

    assertEquals(middlewares.length, 1);
    assertExists(middlewares[0]);
    // Arrow functions get the variable name, so it could be "middleware" or "anonymous"
    assertExists(middlewares[0].name);
  });

  it("should execute middleware in correct order", async () => {
    const pipeline = new MiddlewarePipeline();
    const order: number[] = [];
    const mw1: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      const res = await next();
      order.push(4);
      return res;
    };
    const mw2: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      const res = await next();
      order.push(3);
      return res;
    };

    pipeline.use(mw1).use(mw2);
    const req = new Request("http://localhost/test");
    await pipeline.execute(req);

    assertEquals(order, [1, 2, 3, 4]);
  });

  it("should execute scoped middleware for matching paths", async () => {
    const pipeline = new MiddlewarePipeline();
    const order: number[] = [];
    const globalMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const scopedMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    pipeline.use(globalMw).useFor(/^\/api/, scopedMw);
    const req = new Request("http://localhost/api/test");
    await pipeline.execute(req);

    assertEquals(order, [1, 2]);
  });

  it("should not execute scoped middleware for non-matching paths", async () => {
    const pipeline = new MiddlewarePipeline();
    const order: number[] = [];
    const globalMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const scopedMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    pipeline.use(globalMw).useFor(/^\/api/, scopedMw);
    const req = new Request("http://localhost/other/test");
    await pipeline.execute(req);

    assertEquals(order, [1]);
  });

  it("should return 404 when no middleware provides response", async () => {
    const pipeline = new MiddlewarePipeline();
    const middleware: MiddlewareHandler = (_ctx, next) => next();
    pipeline.use(middleware);

    const req = new Request("http://localhost/test");
    const response = await pipeline.execute(req);

    assertEquals(response.status, HTTP_NOT_FOUND);
  });

  it("should add multiple scoped middleware for same pattern", async () => {
    const pipeline = new MiddlewarePipeline();
    const order: number[] = [];
    const mw1: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const mw2: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    pipeline.useFor(/^\/api/, mw1, mw2);
    const req = new Request("http://localhost/api/test");
    await pipeline.execute(req);

    assertEquals(order, [1, 2]);
  });

  it("should handle empty pipeline", async () => {
    const pipeline = new MiddlewarePipeline();
    const req = new Request("http://localhost/test");
    const response = await pipeline.execute(req);

    assertEquals(response.status, HTTP_NOT_FOUND);
  });

  it("should accept options in constructor", () => {
    const pipeline = new MiddlewarePipeline({});
    assertExists(pipeline);
  });
});
