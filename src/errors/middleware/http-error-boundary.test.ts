import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for HTTP Error Boundary Middleware
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert";
import { httpErrorBoundary, wrapHandlerWithErrorBoundary } from "./http-error-boundary.ts";
import { VeryfrontError } from "../types.ts";
import { PROBLEM_JSON_CONTENT_TYPE } from "../http-error.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";
import type { Handler, HandlerContext } from "#veryfront/types";
import { HandlerPriority } from "#veryfront/types";

/**
 * Create a mock HandlerContext for testing
 */
function createMockContext(isLocalProject = false): HandlerContext {
  return {
    projectDir: "/test/project",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject,
  };
}

/**
 * Create a mock Request for testing
 */
function createMockRequest(url = "http://example.com/test"): Request {
  return new Request(url);
}

describe("http-error-boundary", () => {
  describe("httpErrorBoundary", () => {
    it("rejects an invalid handler before request processing", () => {
      assertThrows(
        () => httpErrorBoundary(null as never),
        TypeError,
        "handlerFn must be a function",
      );
    });

    it("should pass through successful handler results", async () => {
      const handler = httpErrorBoundary(async () => {
        return { response: new Response("OK"), continue: false };
      });

      const result = await handler(createMockRequest(), createMockContext());

      assertExists(result.response);
      assertEquals(await result.response.text(), "OK");
    });

    it("should catch VeryfrontError and return RFC 9457 response", async () => {
      const handler = httpErrorBoundary(async () => {
        throw CONFIG_NOT_FOUND.create({ detail: "Missing veryfront.config.ts" });
      });

      const result = await handler(createMockRequest(), createMockContext());

      assertExists(result.response);
      assertEquals(result.response.status, 404);
      assertEquals(result.response.headers.get("Content-Type"), PROBLEM_JSON_CONTENT_TYPE);
      assertEquals(result.response.headers.get("Cache-Control"), "no-store");
      assertEquals(result.response.headers.get("X-Content-Type-Options"), "nosniff");

      const body = await result.response.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/config-not-found");
      assertEquals(body.title, "Configuration file not found");
      assertEquals(body.status, 404);
      assertEquals(body.category, "CONFIG");
      assertEquals(body.detail, "Missing veryfront.config.ts");
      assertEquals(body.instance, "/test");
    });

    it("should wrap plain Error as unknown-error", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("Something went wrong");
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(true), // Use dev mode to include detail for 5xx
      );

      assertExists(result.response);
      assertEquals(result.response.status, 500);
      assertEquals(result.response.headers.get("Content-Type"), PROBLEM_JSON_CONTENT_TYPE);

      const body = await result.response.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
      assertEquals(body.status, 500);
      assertEquals(body.category, "GENERAL");
      assertEquals(body.detail, "Something went wrong");
    });

    it("should include stack trace in dev mode", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("Dev error");
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(true), // isLocalProject = true
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertExists(body.stack);
      assertEquals(typeof body.stack, "string");
    });

    it("should omit stack trace in production mode", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("Production error");
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(false), // isLocalProject = false
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.stack, undefined);
    });

    it("should omit detail for 5xx errors in production", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Internal error", {
          slug: "internal-error",
          category: "GENERAL",
          status: 500,
          title: "Internal Server Error",
          detail: "Sensitive database connection string: postgres://...",
        });
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(false), // production
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.detail, undefined);
    });

    it("does not expose causes in production responses", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Bad request", {
          slug: "invalid-input",
          category: "GENERAL",
          status: 400,
          title: "Invalid input",
          cause: "password=<TOKEN> at /private/project/server.ts",
        });
      });

      const result = await handler(createMockRequest(), createMockContext(false));
      const body = await result.response?.json();
      assertEquals(body.cause, undefined);
    });

    it("should include detail for 5xx errors in dev mode", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Internal error", {
          slug: "internal-error",
          category: "GENERAL",
          status: 500,
          title: "Internal Server Error",
          detail: "Sensitive database connection string: postgres://...",
        });
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(true), // dev
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.detail, "Sensitive database connection string: postgres://...");
    });

    it("sanitizes developer diagnostics before returning them", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("password=<TOKEN> at /private/project/server.ts");
      });

      const result = await handler(createMockRequest(), createMockContext(true));
      const body = await result.response?.json();
      const serialized = JSON.stringify(body);
      assertEquals(serialized.includes("<TOKEN>"), false);
      assertEquals(serialized.includes("/private/project"), false);
      assertEquals(typeof body.stack, "string");
    });

    it("fails closed for hostile mutable error properties", async () => {
      const error = CONFIG_NOT_FOUND.create();
      Object.defineProperty(error, "status", {
        get() {
          throw new Error("getter leaked password=<TOKEN>");
        },
      });
      const handler = httpErrorBoundary(async () => {
        throw error;
      });

      const result = await handler(createMockRequest(), createMockContext(true));
      const body = await result.response?.json();

      assertEquals(result.response?.status, 500);
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
      assertEquals(JSON.stringify(body).includes("<TOKEN>"), false);
    });

    it("fails closed when development-mode metadata is hostile", async () => {
      const context = Object.defineProperty({}, "isLocalProject", {
        get() {
          throw new Error("password=<TOKEN>");
        },
      }) as HandlerContext;
      const handler = httpErrorBoundary(async () => {
        throw new Error("password=<TOKEN>");
      });

      const result = await handler(createMockRequest(), context);
      const body = await result.response?.json();

      assertEquals(result.response?.status, 500);
      assertEquals(body.detail, undefined);
      assertEquals(body.stack, undefined);
      assertEquals(JSON.stringify(body).includes("<TOKEN>"), false);
    });

    it("should include detail for 4xx errors in production", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Bad request", {
          slug: "invalid-input",
          category: "GENERAL",
          status: 400,
          title: "Invalid Input",
          detail: "Field 'email' is required",
        });
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(false), // production
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.detail, "Field 'email' is required");
    });

    it("should set instance from request URL", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("Test error");
      });

      const result = await handler(
        createMockRequest("http://example.com/api/users/123"),
        createMockContext(),
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.instance, "/api/users/123");
    });

    it("should project the request instance without mutating the error", async () => {
      const error = new VeryfrontError("Error", {
        slug: "test-error",
        category: "GENERAL",
        status: 500,
        title: "Test",
      });
      const handler = httpErrorBoundary(async () => {
        throw error;
      });

      const result = await handler(
        createMockRequest("http://example.com/api/users/123"),
        createMockContext(),
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.instance, "/api/users/123");
      assertEquals(error.instance, undefined);
    });

    it("should preserve existing instance if set", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Error", {
          slug: "test-error",
          category: "GENERAL",
          status: 500,
          title: "Test",
          instance: "/custom/instance",
        });
      });

      const result = await handler(
        createMockRequest("http://example.com/different/path"),
        createMockContext(),
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.instance, "/custom/instance");
    });

    it("should pretty-print JSON in dev mode", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("Dev error");
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(true),
      );

      assertExists(result.response);
      const text = await result.response.text();
      // Pretty-printed JSON has newlines
      assertEquals(text.includes("\n"), true);
    });

    it("should minify JSON in production mode", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new Error("Production error");
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(false),
      );

      assertExists(result.response);
      const text = await result.response.text();
      // Minified JSON has no newlines (except in strings)
      const parsedAndStringified = JSON.stringify(JSON.parse(text));
      assertEquals(text, parsedAndStringified);
    });
  });

  describe("wrapHandlerWithErrorBoundary", () => {
    it("rejects malformed handler objects", () => {
      assertThrows(
        () => wrapHandlerWithErrorBoundary(null as never),
        TypeError,
        "handler must provide a handle method",
      );
      assertThrows(
        () => wrapHandlerWithErrorBoundary({ metadata: {}, handle: null } as never),
        TypeError,
        "handler must provide a handle method",
      );
    });

    it("should wrap a Handler object with error boundary", async () => {
      const handler: Handler = {
        metadata: {
          name: "test-handler",
          priority: HandlerPriority.MEDIUM,
        },
        async handle() {
          throw new Error("Handler error");
        },
      };

      const wrapped = wrapHandlerWithErrorBoundary(handler);

      assertEquals(wrapped.metadata.name, "test-handler");
      assertEquals(wrapped.metadata.priority, HandlerPriority.MEDIUM);

      const result = await wrapped.handle(createMockRequest(), createMockContext());

      assertExists(result.response);
      assertEquals(result.response.status, 500);
      const body = await result.response.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    });

    it("should preserve handler metadata", async () => {
      const handler: Handler = {
        metadata: {
          name: "custom-handler",
          priority: HandlerPriority.HIGH,
          patterns: [{ pattern: "/test", exact: true }],
        },
        async handle() {
          return { response: new Response("OK") };
        },
      };

      const wrapped = wrapHandlerWithErrorBoundary(handler);

      assertEquals(wrapped.metadata.name, "custom-handler");
      assertEquals(wrapped.metadata.priority, HandlerPriority.HIGH);
      assertExists(wrapped.metadata.patterns);
      assertEquals(wrapped.metadata.patterns.length, 1);
    });
  });
});
