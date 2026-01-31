import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executeMiddlewarePipeline } from "./executor.ts";
import type { MiddlewareHandler } from "../types.ts";

describe("middleware/core/pipeline/executor", () => {
  describe("executeMiddlewarePipeline", () => {
    it("should execute middleware and return response", async () => {
      const handler: MiddlewareHandler = () => new Response("hello");
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.status, 200);
      assertEquals(await res.text(), "hello");
    });

    it("should return 404 when middleware calls next and no handler matches", async () => {
      const handler: MiddlewareHandler = (_c, next) => next();
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.status, 404);
      assertEquals(await res.text(), "Not Found");
    });

    it("should return 404 when middleware returns undefined", async () => {
      const handler: MiddlewareHandler = () => undefined;
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.status, 404);
    });

    it("should return 500 when middleware throws", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("middleware error");
      };
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.status, 500);
      const body = await res.json();
      assertEquals(body.error, "Internal Server Error");
      assertEquals(body.method, "GET");
      assertEquals(body.url, "http://localhost/");
    });

    it("should include error details in development mode", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("dev error details");
      };
      const adapter = {
        env: {
          get: (key: string) => (key === "NODE_ENV" ? "development" : undefined),
        },
      };
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
        undefined,
        undefined,
        // deno-lint-ignore no-explicit-any
        adapter as any,
      );
      assertEquals(res.status, 500);
      const body = await res.json();
      assertEquals(body.message, "dev error details");
      assert(Array.isArray(body.stack));
    });

    it("should not include error details in production mode", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("secret error");
      };
      const adapter = {
        env: {
          get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
        },
      };
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
        undefined,
        undefined,
        // deno-lint-ignore no-explicit-any
        adapter as any,
      );
      assertEquals(res.status, 500);
      const body = await res.json();
      assertEquals(body.error, "Internal Server Error");
      assertEquals(body.message, undefined);
      assertEquals(body.stack, undefined);
    });

    it("should pass env to the context", async () => {
      let capturedEnv: Record<string, unknown> | undefined;
      const handler: MiddlewareHandler = (c) => {
        capturedEnv = c.env;
        return new Response("ok");
      };
      await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
        { KEY: "value" },
      );
      assertEquals(capturedEnv?.KEY, "value");
    });

    it("should pass executionCtx to the context", async () => {
      let capturedCtx: unknown;
      const handler: MiddlewareHandler = (c) => {
        capturedCtx = c.executionCtx;
        return new Response("ok");
      };
      const execCtx = {
        waitUntil: () => {},
        passThroughOnException: () => {},
      };
      await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
        undefined,
        execCtx,
      );
      assertEquals(capturedCtx, execCtx);
    });

    it("should set content-type to application/json on error response", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("err");
      };
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.headers.get("content-type"), "application/json");
    });

    it("should handle non-Error thrown values", async () => {
      const handler: MiddlewareHandler = () => {
        throw "string error";
      };
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.status, 500);
      const body = await res.json();
      assertEquals(body.error, "Internal Server Error");
    });

    it("should handle async middleware that rejects", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("async fail");
      };
      const res = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );
      assertEquals(res.status, 500);
    });
  });
});
