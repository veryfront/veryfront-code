import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __registerLogRecordEmitter, type LogEntry } from "#veryfront/utils";
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
      assertEquals(res.headers.get("Cache-Control"), "no-store");
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
      assertEquals(res.headers.get("Cache-Control"), "no-store");
    });

    it("should strip query strings and fragments from error logs and production bodies", async () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));

      try {
        const handler: MiddlewareHandler = () => {
          throw new Error("middleware error");
        };
        const res = await executeMiddlewarePipeline(
          new Request(
            "http://localhost/private?opaque_private_value=secret#fragment",
          ),
          handler,
        );
        const body = await res.json();
        const logEntry = entries.find((entry) =>
          entry.message.includes("Middleware pipeline error")
        );

        assertEquals(body.url, "http://localhost/private");
        assertEquals(logEntry?.context?.url, "http://localhost/private");
        assertEquals(JSON.stringify(logEntry).includes("secret"), false);
        assertEquals(JSON.stringify(logEntry).includes("fragment"), false);
      } finally {
        __registerLogRecordEmitter(null);
      }
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
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const handler: MiddlewareHandler = () => {
        throw new Error("opaque_private_value=secret");
      };
      const adapter = {
        env: {
          get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
        },
      };
      try {
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

        const logEntry = entries.find((entry) =>
          entry.message.includes("Middleware pipeline error")
        );
        assertEquals(JSON.stringify(logEntry).includes("secret"), false);
        assertEquals(logEntry?.context?.errorName, "Error");
      } finally {
        __registerLogRecordEmitter(null);
      }
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

    it("should pass the canonical context request to the final handler", async () => {
      const replacement = new Request("http://localhost/replaced");
      let handledRequest: Request | undefined;
      const middleware: MiddlewareHandler = (context, next) => {
        context.request = replacement;
        return next();
      };

      const response = await executeMiddlewarePipeline(
        new Request("http://localhost/original"),
        middleware,
        undefined,
        undefined,
        undefined,
        (request) => {
          handledRequest = request;
          return new Response(request.url);
        },
      );

      assertEquals(handledRequest, replacement);
      assertEquals(await response.text(), replacement.url);
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
