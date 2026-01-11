import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { composeMiddleware } from "./composer.ts";
import { MiddlewareContext } from "../context.ts";
import type { MiddlewareHandler } from "../types.ts";

describe("composeMiddleware", () => {
  function createContext(path: string = "/"): MiddlewareContext {
    return new MiddlewareContext(new Request(`https://example.com${path}`));
  }

  it("should execute middlewares in order", async () => {
    const order: number[] = [];

    const middleware1: MiddlewareHandler = async (_ctx, next) => {
      order.push(1);
      const res = await next();
      order.push(4);
      return res;
    };

    const middleware2: MiddlewareHandler = async (_ctx, next) => {
      order.push(2);
      const res = await next();
      order.push(3);
      return res;
    };

    const composed = composeMiddleware([middleware1, middleware2], []);
    const ctx = createContext();
    await composed(ctx, () => Promise.resolve(new Response("OK")));

    assertEquals(order, [1, 2, 3, 4]);
  });

  it("should return final response", async () => {
    const middleware: MiddlewareHandler = async (_ctx, next) => {
      return await next();
    };

    const composed = composeMiddleware([middleware], []);
    const ctx = createContext();
    const response = await composed(ctx, () => Promise.resolve(new Response("Final")));

    assertEquals(await response?.text(), "Final");
  });

  it("should allow middleware to short-circuit", async () => {
    let reachedSecond = false;

    const middleware1: MiddlewareHandler = () => {
      return new Response("Short circuit");
    };

    const middleware2: MiddlewareHandler = async (_ctx, next) => {
      reachedSecond = true;
      return await next();
    };

    const composed = composeMiddleware([middleware1, middleware2], []);
    const ctx = createContext();
    const response = await composed(ctx, () => Promise.resolve(new Response("Final")));

    assertEquals(await response?.text(), "Short circuit");
    assertEquals(reachedSecond, false);
  });

  it("should throw if next() called multiple times", async () => {
    const middleware: MiddlewareHandler = async (_ctx, next) => {
      await next();
      await next(); // Second call should throw
      return new Response("OK");
    };

    const composed = composeMiddleware([middleware], []);
    const ctx = createContext();

    await assertRejects(
      async () => {
        await composed(ctx, () => Promise.resolve(new Response("OK")));
      },
      Error,
      "next() called multiple times",
    );
  });

  it("should apply scoped middlewares based on pattern", async () => {
    const order: string[] = [];

    const globalMiddleware: MiddlewareHandler = async (_ctx, next) => {
      order.push("global");
      return await next();
    };

    const apiMiddleware: MiddlewareHandler = async (_ctx, next) => {
      order.push("api");
      return await next();
    };

    const composed = composeMiddleware(
      [globalMiddleware],
      [{ pattern: /^\/api/, use: [apiMiddleware] }],
    );

    // Request to /api path
    const ctx1 = createContext("/api/users");
    await composed(ctx1, () => Promise.resolve(new Response("OK")));
    assertEquals(order, ["global", "api"]);

    // Request to non-/api path
    order.length = 0;
    const ctx2 = createContext("/home");
    await composed(ctx2, () => Promise.resolve(new Response("OK")));
    assertEquals(order, ["global"]);
  });

  it("should apply multiple scoped middlewares", async () => {
    const order: string[] = [];

    const authMiddleware: MiddlewareHandler = async (_ctx, next) => {
      order.push("auth");
      return await next();
    };

    const loggingMiddleware: MiddlewareHandler = async (_ctx, next) => {
      order.push("logging");
      return await next();
    };

    const composed = composeMiddleware(
      [],
      [
        { pattern: /^\/api/, use: [authMiddleware] },
        { pattern: /.*/, use: [loggingMiddleware] },
      ],
    );

    const ctx = createContext("/api/test");
    await composed(ctx, () => Promise.resolve(new Response("OK")));

    assertEquals(order, ["auth", "logging"]);
  });

  it("should handle empty middleware array", async () => {
    const composed = composeMiddleware([], []);
    const ctx = createContext();
    const response = await composed(ctx, () => Promise.resolve(new Response("Final")));

    assertEquals(await response?.text(), "Final");
  });
});
