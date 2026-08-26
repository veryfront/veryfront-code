import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for HTTP Error Boundary Middleware
 */

import { describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { httpErrorBoundary, wrapHandlerWithErrorBoundary } from "./http-error-boundary.ts";
import { VeryfrontError } from "../types.ts";
import { PROBLEM_JSON_CONTENT_TYPE } from "../http-error.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";
import type { Handler, HandlerContext } from "#veryfront/types";
import { HandlerPriority } from "#veryfront/types";
import { metricsManager } from "#veryfront/observability/metrics/index.ts";
import type { Span } from "#veryfront/observability/tracing/api-shim.ts";
import { SpanStatusCode, trace } from "#veryfront/observability/tracing/api-shim.ts";

/**
 * Create a mock HandlerContext for testing
 */
function createMockContext(isLocalProject = false): HandlerContext {
  return {
    projectDir: "/test/project",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
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

      const body = await result.response.json();
      assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#config-not-found");
      assertEquals(body.title, "Configuration file not found");
      assertEquals(body.status, 404);
      assertEquals(body.category, "CONFIG");
      assertEquals(body.detail, "Missing veryfront.config.ts");
      assertEquals(body.instance, "/test");
    });

    it("should treat proxied errors as opaque without invoking traps", async () => {
      let statusReads = 0;
      const source = CONFIG_NOT_FOUND.create({ detail: "Missing file" });
      const stateful = new Proxy(source, {
        get(target, property, receiver): unknown {
          if (property === "status") {
            statusReads++;
            return [404, 503, 418][statusReads - 1] ?? 418;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const handler = httpErrorBoundary(async () => {
        throw stateful;
      });

      const result = await handler(createMockRequest(), createMockContext());

      assertExists(result.response);
      assertEquals(result.response.status, 500);
      const body = await result.response.json();
      assertEquals(body.status, 500);
      assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#unknown-error");
      assertEquals(statusReads, 0);
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
      assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#unknown-error");
      assertEquals(body.status, 500);
      assertEquals(body.category, "GENERAL");
      assertEquals(body.detail, "Something went wrong");
    });

    it("should record an error metric for every boundary error", async () => {
      const recorder = metricsManager.getRecorder();
      assertExists(recorder);
      const originalRecordError = recorder.recordError;
      const recorded: Array<Record<string, string> | undefined> = [];
      recorder.recordError = (attributes?: Record<string, string>) => {
        recorded.push(attributes);
      };

      try {
        const unknownHandler = httpErrorBoundary(async () => {
          throw new Error("handler failed");
        });
        await unknownHandler(createMockRequest(), createMockContext());

        assertEquals(recorded.length, 1, "the HTTP boundary records exactly one error metric");
        assertEquals(
          recorded[0],
          { slug: "unknown-error", category: "GENERAL", status: "500" },
          "unknown errors are recorded with their boundary identity",
        );

        const registeredHandler = httpErrorBoundary(async () => {
          throw CONFIG_NOT_FOUND.create();
        });
        await registeredHandler(createMockRequest(), createMockContext());

        assertEquals(recorded.length, 2, "each boundary error records its own metric");
        assertEquals(
          recorded[1],
          { slug: "config-not-found", category: "CONFIG", status: "404" },
          "registered errors are recorded with their registry identity",
        );
      } finally {
        recorder.recordError = originalRecordError;
      }
    });

    it("should return the intended response when metrics recording throws", async () => {
      const recorder = metricsManager.getRecorder();
      assertExists(recorder);
      const originalRecordError = recorder.recordError;
      recorder.recordError = () => {
        throw new Error("metrics failed");
      };

      try {
        const handler = httpErrorBoundary(async () => {
          throw new Error("handler failed");
        });
        const result = await handler(createMockRequest(), createMockContext());

        assertExists(result.response);
        assertEquals(result.response.status, 500);
        const body = await result.response.json();
        assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#unknown-error");
      } finally {
        recorder.recordError = originalRecordError;
      }
    });

    it("should return the intended response when tracing throws", async () => {
      const originalGetActiveSpan = trace.getActiveSpan;
      let consulted = false;
      trace.getActiveSpan = () => {
        consulted = true;
        throw new Error("tracing failed");
      };

      try {
        const handler = httpErrorBoundary(async () => {
          throw new Error("handler failed");
        });
        const result = await handler(createMockRequest(), createMockContext());

        assertExists(result.response);
        assertEquals(result.response.status, 500);
        const body = await result.response.json();
        assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#unknown-error");
        assert(consulted, "boundary must consult the tracer even though it throws");
      } finally {
        trace.getActiveSpan = originalGetActiveSpan;
      }
    });

    it("should attach the error to the active span", async () => {
      const statusCalls: Array<{ code: number; message: string }> = [];
      const activeSpan = {
        setStatus: (status: { code: number; message?: string }) => {
          statusCalls.push({ code: status.code, message: status.message ?? "" });
        },
        setAttributes: () => {},
        addEvent: () => {},
      } as unknown as Span;
      const originalGetActiveSpan = trace.getActiveSpan;
      trace.getActiveSpan = () => activeSpan;

      try {
        const handler = httpErrorBoundary(async () => {
          throw new Error("handler failed");
        });
        const result = await handler(createMockRequest(), createMockContext());

        assertExists(result.response);
        assertEquals(
          statusCalls.length,
          1,
          "the boundary attaches the error to the active span exactly once",
        );
        assertEquals(
          statusCalls[0]?.code,
          SpanStatusCode.ERROR,
          "the active span is marked as errored",
        );
        assertEquals(
          statusCalls[0]?.message,
          "unknown-error",
          "the span status message carries the boundary error slug",
        );
      } finally {
        trace.getActiveSpan = originalGetActiveSpan;
      }
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

    it("should include detail for 4xx errors in production", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Bad request", {
          slug: "invalid-input",
          category: "GENERAL",
          status: 400,
          title: "Invalid Input",
          detail: "Field 'email' is required",
          cause: "private validation provenance",
        });
      });

      const result = await handler(
        createMockRequest(),
        createMockContext(false), // production
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.detail, "Field 'email' is required");
      assertEquals(body.cause, undefined);
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

    it("should preserve the error response when the request URL is unreadable", async () => {
      let urlReads = 0;
      const request = new Proxy(createMockRequest(), {
        get(target, property, receiver): unknown {
          if (property === "url") {
            urlReads++;
            throw new Error("unreadable URL");
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const handler = httpErrorBoundary(async () => {
        throw CONFIG_NOT_FOUND.create();
      });

      const result = await handler(request, createMockContext());

      assertExists(result.response);
      assertEquals(result.response.status, 404);
      const body = await result.response.json();
      assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#config-not-found");
      assertEquals(body.instance, undefined);
      assertEquals(urlReads, 0);
    });

    it("should extract relative URLs and omit malformed URLs", async () => {
      const handler = httpErrorBoundary(async () => {
        throw CONFIG_NOT_FOUND.create();
      });

      const relative = await handler(
        { url: "projects/example?mode=fast" } as Request,
        createMockContext(),
      );
      const malformed = await handler(
        { url: "http://[" } as Request,
        createMockContext(),
      );

      assertExists(relative.response);
      assertExists(malformed.response);
      assertEquals((await relative.response.json()).instance, "/projects/example");
      assertEquals((await malformed.response.json()).instance, undefined);
    });

    it("should default to production filtering when context inspection fails", async () => {
      let environmentReads = 0;
      const context = new Proxy(createMockContext(true), {
        get(target, property, receiver): unknown {
          if (property === "isLocalProject") {
            environmentReads++;
            throw new Error("unreadable environment");
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Internal error", {
          slug: "internal-error",
          category: "GENERAL",
          status: 500,
          title: "Internal Server Error",
          detail: "private detail",
        });
      });

      const result = await handler(createMockRequest(), context);

      assertExists(result.response);
      assertEquals(result.response.status, 500);
      const body = await result.response.json();
      assertEquals(body.detail, undefined);
      assertEquals(body.stack, undefined);
      assertEquals(environmentReads, 0);
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

    it("should add request instance without mutating the source error", async () => {
      const error = CONFIG_NOT_FOUND.create();
      const handler = httpErrorBoundary(async () => {
        throw error;
      });

      const result = await handler(
        createMockRequest("http://example.com/projects/example"),
        createMockContext(),
      );

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.instance, "/projects/example");
      assertEquals(error.instance, undefined);
    });

    it("should omit string causes from production 5xx responses", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Internal error", {
          slug: "internal-error",
          category: "GENERAL",
          status: 500,
          title: "Internal Server Error",
          cause: "private backend failure",
        });
      });

      const result = await handler(createMockRequest(), createMockContext(false));

      assertExists(result.response);
      const body = await result.response.json();
      assertEquals(body.cause, undefined);
    });

    it("should omit string causes from dev 5xx responses", async () => {
      const handler = httpErrorBoundary(async () => {
        throw new VeryfrontError("Internal error", {
          slug: "internal-error",
          category: "GENERAL",
          status: 500,
          title: "Internal Server Error",
          cause: "provider payload with customer record",
        });
      });

      const result = await handler(createMockRequest(), createMockContext(true));

      assertExists(result.response);
      const text = await result.response.text();
      const body = JSON.parse(text);
      assertEquals(body.cause, undefined, "dev responses must not echo the cause");
      assertEquals(
        text.includes("provider payload with customer record"),
        false,
        "the raw cause payload must not reach the response body",
      );
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

    it("should fail closed for proxies around real errors", async () => {
      const source = CONFIG_NOT_FOUND.create({ detail: "Bearer source-secret" });
      const hostile = new Proxy(source, {
        get(target, property, receiver) {
          if (property === "status") throw new Error("blocked");
          return Reflect.get(target, property, receiver);
        },
      });
      const handler = httpErrorBoundary(async () => {
        throw hostile;
      });

      const result = await handler(createMockRequest(), createMockContext(true));

      assertExists(result.response);
      assertEquals(result.response.status, 500);
      const body = await result.response.json();
      assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#unknown-error");
      assertEquals(JSON.stringify(body).includes("source-secret"), false);
    });

    it("should redact free-form diagnostics in development and production", async () => {
      for (const isDev of [true, false]) {
        const handler = httpErrorBoundary(async () => {
          throw new VeryfrontError("bad request", {
            slug: "invalid-input",
            category: "GENERAL",
            status: 400,
            title: "Invalid Authorization: Bearer title-secret",
            detail: "apiKey=detail-secret cookie=cookie-secret",
          });
        });

        const result = await handler(createMockRequest(), createMockContext(isDev));

        assertExists(result.response);
        const text = await result.response.text();
        assertEquals(text.includes("[REDACTED]"), true);
        for (const secret of ["title-secret", "detail-secret", "cookie-secret"]) {
          assertEquals(text.includes(secret), false);
        }
      }
    });
  });

  describe("wrapHandlerWithErrorBoundary", () => {
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
      assertEquals(body.type, "https://veryfront.com/docs/code/guides/errors#unknown-error");
    });

    it("should preserve the handler receiver when wrapping", async () => {
      const handler: Handler = {
        metadata: {
          name: "receiver-handler",
          priority: HandlerPriority.MEDIUM,
        },
        async handle() {
          return { response: new Response(this.metadata.name) };
        },
      };

      const wrapped = wrapHandlerWithErrorBoundary(handler);
      const result = await wrapped.handle(createMockRequest(), createMockContext());

      assertExists(result.response);
      assertEquals(
        result.response.status,
        200,
        "a this-using handler must not be converted into an error response",
      );
      assertEquals(
        await result.response.text(),
        "receiver-handler",
        "wrapping must preserve the handler receiver",
      );
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
