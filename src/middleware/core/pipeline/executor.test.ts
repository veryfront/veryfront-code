import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

    it("returns 500 when runtime JavaScript middleware returns an invalid value", async () => {
      const handler = (() => ({ status: 200 })) as unknown as MiddlewareHandler;
      const response = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
      );

      assertEquals(response.status, 500);
      assertEquals((await response.json()).error, "Internal Server Error");
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
      assertEquals(body.url, "[REDACTED]");
    });

    it("does not expose raw error details in development mode", async () => {
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
      assertEquals(body.message, undefined);
      assertEquals(body.stack, undefined);
      assertEquals(JSON.stringify(body).includes("dev error details"), false);
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

    it("omits request targets and raw error details from responses and logs", async () => {
      const originalError = console.error;
      const logLines: string[] = [];
      console.error = (...args: unknown[]) => logLines.push(args.map(String).join(" "));
      const privateHost = "private-host.example";
      const privatePath = "PRIVATE_CUSTOMER_PATH";
      const privateError = "PRIVATE_ARBITRARY_ERROR_DETAIL";
      const handler: MiddlewareHandler = () => {
        const error = new Error(privateError);
        error.name = "PRIVATE_ERROR_NAME";
        throw error;
      };
      const adapter = {
        env: {
          get: (key: string) => (key === "NODE_ENV" ? "development" : undefined),
        },
      };

      try {
        const res = await executeMiddlewarePipeline(
          new Request(`http://${privateHost}/${privatePath}?customer_note=private-value`),
          handler,
          undefined,
          undefined,
          // deno-lint-ignore no-explicit-any
          adapter as any,
        );
        const body = await res.json();
        const serialized = JSON.stringify(body);

        assertEquals(body.url, "[REDACTED]");
        assertEquals(serialized.includes("private-value"), false);
        assertEquals(serialized.includes(privateHost), false);
        assertEquals(serialized.includes(privatePath), false);
        assertEquals(serialized.includes(privateError), false);
        assertEquals(logLines.join("\n").includes("private-value"), false);
        assertEquals(logLines.join("\n").includes(privateHost), false);
        assertEquals(logLines.join("\n").includes(privatePath), false);
        assertEquals(logLines.join("\n").includes(privateError), false);
        assertEquals(logLines.join("\n").includes("PRIVATE_ERROR_NAME"), false);
      } finally {
        console.error = originalError;
      }
    });

    it("does not depend on environment lookup for safe error responses", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("middleware failure");
      };
      const adapter = {
        env: {
          get: () => {
            throw new Error("environment unavailable");
          },
        },
      };

      const response = await executeMiddlewarePipeline(
        new Request("http://localhost/"),
        handler,
        undefined,
        undefined,
        // deno-lint-ignore no-explicit-any
        adapter as any,
      );

      assertEquals(response.status, 500);
      assertEquals((await response.json()).message, undefined);
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
      assertEquals(res.headers.get("cache-control"), "no-store");
      assertEquals(res.headers.get("x-content-type-options"), "nosniff");
    });

    it("returns a bodyless error response for HEAD requests", async () => {
      const handler: MiddlewareHandler = () => {
        throw new Error("private failure");
      };
      const response = await executeMiddlewarePipeline(
        new Request("http://localhost/private", { method: "HEAD" }),
        handler,
      );

      assertEquals(response.status, 500);
      assertEquals(await response.text(), "");
      assertEquals(response.headers.get("cache-control"), "no-store");
    });

    it("bounds untrusted HTTP methods in error contracts", async () => {
      const method = "X".repeat(1_000);
      const handler: MiddlewareHandler = () => {
        throw new Error("failure");
      };
      const response = await executeMiddlewarePipeline(
        new Request("http://localhost/", { method }),
        handler,
      );
      const body = await response.json();

      assertEquals(body.method, "UNKNOWN");
      assertEquals(JSON.stringify(body).includes(method), false);
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
