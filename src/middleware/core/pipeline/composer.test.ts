import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { composeMiddleware } from "./composer.ts";
import { MiddlewareContext } from "../context.ts";
import type { MiddlewareHandler } from "../types.ts";

describe("composeMiddleware", () => {
  function createContext(path = "/"): MiddlewareContext {
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
    await composed(createContext(), () => Promise.resolve(new Response("OK")));

    assertEquals(order, [1, 2, 3, 4]);
  });

  it("should return final response", async () => {
    const middleware: MiddlewareHandler = (_ctx, next) => next();

    const composed = composeMiddleware([middleware], []);
    const response = await composed(createContext(), () => Promise.resolve(new Response("Final")));

    assertEquals(await response?.text(), "Final");
  });

  it("should allow middleware to short-circuit", async () => {
    let reachedSecond = false;

    const middleware1: MiddlewareHandler = () => new Response("Short circuit");

    const middleware2: MiddlewareHandler = async (_ctx, next) => {
      reachedSecond = true;
      return await next();
    };

    const composed = composeMiddleware([middleware1, middleware2], []);
    const response = await composed(createContext(), () => Promise.resolve(new Response("Final")));

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

    await assertRejects(
      async () => {
        await composed(createContext(), () => Promise.resolve(new Response("OK")));
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

    await composed(createContext("/api/users"), () => Promise.resolve(new Response("OK")));
    assertEquals(order, ["global", "api"]);

    order.length = 0;
    await composed(createContext("/home"), () => Promise.resolve(new Response("OK")));
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

    await composed(createContext("/api/test"), () => Promise.resolve(new Response("OK")));

    assertEquals(order, ["auth", "logging"]);
  });

  it("should handle empty middleware array", async () => {
    const composed = composeMiddleware([], []);
    const response = await composed(createContext(), () => Promise.resolve(new Response("Final")));

    assertEquals(await response?.text(), "Final");
  });
});
