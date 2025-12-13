import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { composeMiddleware } from "./composer.ts";
import { MiddlewareContext } from "../context.ts";
import type { MiddlewareHandler } from "../types.ts";

describe("composeMiddleware", () => {
  it("should execute global middlewares in order", async () => {
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

    const composed = composeMiddleware([mw1, mw2], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    await composed(ctx, finalNext);

    assertEquals(order, [1, 2, 3, 4]);
  });

  it("should execute scoped middlewares matching pattern", async () => {
    const order: number[] = [];
    const globalMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const scopedMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    const registry = [
      { pattern: /^\/api/, use: [scopedMw] },
    ];
    const composed = composeMiddleware([globalMw], registry);
    const req = new Request("http://localhost/api/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => {
      order.push(3);
      return Promise.resolve(new Response("OK"));
    };

    await composed(ctx, finalNext);

    assertEquals(order, [1, 2, 3]);
  });

  it("should not execute scoped middlewares when pattern does not match", async () => {
    const order: number[] = [];
    const globalMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const scopedMw: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    const registry = [
      { pattern: /^\/api/, use: [scopedMw] },
    ];
    const composed = composeMiddleware([globalMw], registry);
    const req = new Request("http://localhost/other/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => {
      order.push(3);
      return Promise.resolve(new Response("OK"));
    };

    await composed(ctx, finalNext);

    assertEquals(order, [1, 3]);
  });

  it("should execute multiple scoped middlewares for matching patterns", async () => {
    const order: number[] = [];
    const scopedMw1: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const scopedMw2: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    const registry = [
      { pattern: /^\/api/, use: [scopedMw1] },
      { pattern: /\/test$/, use: [scopedMw2] },
    ];
    const composed = composeMiddleware([], registry);
    const req = new Request("http://localhost/api/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => {
      order.push(3);
      return Promise.resolve(new Response("OK"));
    };

    await composed(ctx, finalNext);

    assertEquals(order, [1, 2, 3]);
  });

  it("should throw error when next is called multiple times", async () => {
    const badMiddleware: MiddlewareHandler = async (_ctx, next) => {
      await next();
      await next(); // This should throw
      return new Response("OK");
    };

    const composed = composeMiddleware([badMiddleware], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    await assertRejects(
      async () => {
        await composed(ctx, finalNext);
      },
      Error,
      "next() called multiple times",
    );
  });

  it("should allow middleware to short-circuit by returning early", async () => {
    const order: number[] = [];
    const mw1: MiddlewareHandler = () => {
      order.push(1);
      return new Response("Short circuit");
    };
    const mw2: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };

    const composed = composeMiddleware([mw1, mw2], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => {
      order.push(3);
      return Promise.resolve(new Response("OK"));
    };

    const response = await composed(ctx, finalNext);

    assertEquals(order, [1]);
    assertExists(response);
    const text = await response.text();
    assertEquals(text, "Short circuit");
  });

  it("should handle async middleware", async () => {
    let executed = false;
    const asyncMw: MiddlewareHandler = async (_ctx, next) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      executed = true;
      return next();
    };

    const composed = composeMiddleware([asyncMw], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    await composed(ctx, finalNext);

    assertEquals(executed, true);
  });

  it("should handle empty middleware chain", async () => {
    const composed = composeMiddleware([], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    let finalNextCalled = false;
    const finalNext = () => {
      finalNextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    await composed(ctx, finalNext);

    assertEquals(finalNextCalled, true);
  });

  it("should allow middleware to modify context", async () => {
    const mw: MiddlewareHandler = async (ctx, next) => {
      ctx.set("modified", true);
      return next();
    };

    const composed = composeMiddleware([mw], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    await composed(ctx, finalNext);

    assertEquals(ctx.get("modified"), true);
  });

  it("should allow middleware to modify response", async () => {
    const mw: MiddlewareHandler = async (_ctx, next) => {
      const res = await next();
      if (!res) return res;
      const headers = new Headers(res.headers);
      headers.set("X-Modified", "true");
      return new Response(res.body, { status: res.status, headers });
    };

    const composed = composeMiddleware([mw], []);
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    const response = await composed(ctx, finalNext);

    assertExists(response);
    assertEquals(response.headers.get("X-Modified"), "true");
  });

  it("should handle multiple scoped middleware groups", async () => {
    const order: number[] = [];
    const mw1: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      return next();
    };
    const mw2: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      return next();
    };
    const mw3: MiddlewareHandler = async (_ctx, next) => {
      order.push(3);
      return next();
    };

    const registry = [
      { pattern: /^\/api/, use: [mw1, mw2] },
      { pattern: /\/test$/, use: [mw3] },
    ];
    const composed = composeMiddleware([], registry);
    const req = new Request("http://localhost/api/test");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    await composed(ctx, finalNext);

    assertEquals(order, [1, 2, 3]);
  });

  it("should parse pathname correctly from URL", async () => {
    let capturedPathname = "";
    const mw: MiddlewareHandler = (ctx, next) => {
      const url = new URL(ctx.req.url);
      capturedPathname = url.pathname;
      return next();
    };

    const composed = composeMiddleware([mw], []);
    const req = new Request("http://localhost:3000/api/users?id=123");
    const ctx = new MiddlewareContext(req);
    const finalNext = () => Promise.resolve(new Response("OK"));

    await composed(ctx, finalNext);

    assertEquals(capturedPathname, "/api/users");
  });
});
