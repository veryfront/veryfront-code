import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { executeMiddlewarePipeline } from "./executor.ts";
import type { MiddlewareHandler } from "../types.ts";
import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "@veryfront/utils";

describe("executeMiddlewarePipeline", () => {
  it("should execute middleware and return response", async () => {
    const middleware: MiddlewareHandler = async (_ctx, next) => {
      return next();
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, HTTP_NOT_FOUND);
  });

  it("should return custom response from middleware", async () => {
    const middleware: MiddlewareHandler = () => {
      return new Response("Custom Response", { status: 200 });
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text, "Custom Response");
  });

  it("should handle middleware errors and return 500", async () => {
    const middleware: MiddlewareHandler = () => {
      throw new Error("Middleware error");
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, HTTP_SERVER_ERROR);
    const json = await response.json();
    assertEquals(json.error, "Internal Server Error");
  });

  it("should include error details in development mode", async () => {
    const middleware: MiddlewareHandler = () => {
      throw new Error("Test error");
    };
    const req = new Request("http://localhost/test");
    const mockAdapter = {
      env: {
        get: (key: string) => (key === "NODE_ENV" ? "development" : undefined),
      },
    };

    const response = await executeMiddlewarePipeline(
      req,
      middleware,
      {},
      undefined,
      mockAdapter as never,
    );

    assertExists(response);
    assertEquals(response.status, HTTP_SERVER_ERROR);
    const json = await response.json();
    assertEquals(json.message, "Test error");
    assertExists(json.stack);
  });

  it("should not include error details in production mode", async () => {
    const middleware: MiddlewareHandler = () => {
      throw new Error("Test error");
    };
    const req = new Request("http://localhost/test");
    const mockAdapter = {
      env: {
        get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
      },
    };

    const response = await executeMiddlewarePipeline(
      req,
      middleware,
      {},
      undefined,
      mockAdapter as never,
    );

    assertExists(response);
    assertEquals(response.status, HTTP_SERVER_ERROR);
    const json = await response.json();
    assertEquals(json.error, "Internal Server Error");
    assertEquals(json.message, undefined);
  });

  it("should pass env to context", async () => {
    let capturedEnv: Record<string, unknown> = {};
    const middleware: MiddlewareHandler = (ctx, next) => {
      capturedEnv = ctx.env;
      return next();
    };
    const req = new Request("http://localhost/test");
    const env = { API_KEY: "secret", DATABASE_URL: "postgres://..." };

    await executeMiddlewarePipeline(req, middleware, env);

    assertEquals(capturedEnv.API_KEY, "secret");
    assertEquals(capturedEnv.DATABASE_URL, "postgres://...");
  });

  it("should pass execution context to middleware context", async () => {
    let capturedExecutionCtx;
    const middleware: MiddlewareHandler = (ctx, next) => {
      capturedExecutionCtx = ctx.executionCtx;
      return next();
    };
    const req = new Request("http://localhost/test");
    const executionCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };

    await executeMiddlewarePipeline(req, middleware, {}, executionCtx);

    assertEquals(capturedExecutionCtx, executionCtx);
  });

  it("should return default 404 when middleware returns undefined", async () => {
    const middleware: MiddlewareHandler = async (_ctx, next) => {
      return next();
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, HTTP_NOT_FOUND);
    const text = await response.text();
    assertEquals(text, "Not Found");
  });

  it("should handle async middleware", async () => {
    const middleware: MiddlewareHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response("Async response", { status: 200 });
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text, "Async response");
  });

  it("should handle middleware returning undefined response", async () => {
    const middleware: MiddlewareHandler = () => {
      return undefined;
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, HTTP_NOT_FOUND);
  });

  it("should include request info in error response", async () => {
    const middleware: MiddlewareHandler = () => {
      throw new Error("Test error");
    };
    const req = new Request("http://localhost/test", { method: "POST" });

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    const json = await response.json();
    assertEquals(json.method, "POST");
    assertEquals(json.url, "http://localhost/test");
  });

  it("should handle non-Error thrown values", async () => {
    const middleware: MiddlewareHandler = () => {
      throw "String error";
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.status, HTTP_SERVER_ERROR);
    const json = await response.json();
    assertEquals(json.error, "Internal Server Error");
  });

  it("should limit stack trace length in development mode", async () => {
    const middleware: MiddlewareHandler = () => {
      const error = new Error("Test error");
      error.stack = Array(20)
        .fill("at someFuncti on (file.ts:1:1)")
        .join("\n");
      throw error;
    };
    const req = new Request("http://localhost/test");
    const mockAdapter = {
      env: {
        get: (key: string) => (key === "NODE_ENV" ? "development" : undefined),
      },
    };

    const response = await executeMiddlewarePipeline(
      req,
      middleware,
      {},
      undefined,
      mockAdapter as never,
    );

    assertExists(response);
    const json = await response.json();
    assertExists(json.stack);
    assertEquals(json.stack.length <= 10, true);
  });

  it("should return JSON content-type for error responses", async () => {
    const middleware: MiddlewareHandler = () => {
      throw new Error("Test error");
    };
    const req = new Request("http://localhost/test");

    const response = await executeMiddlewarePipeline(req, middleware);

    assertExists(response);
    assertEquals(response.headers.get("content-type"), "application/json");
  });
});
