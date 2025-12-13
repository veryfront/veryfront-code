import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { instrumentReactRender, instrumentErrorHandler } from "./react-instrumentation.ts";

describe("react-instrumentation", () => {
  describe("instrumentReactRender", () => {
    it("should instrument synchronous render function", async () => {
      const renderFn = () => "rendered content";
      const result = await instrumentReactRender(renderFn, "TestComponent");
      assertEquals(result, "rendered content");
    });

    it("should instrument asynchronous render function", async () => {
      const renderFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async rendered";
      };
      const result = await instrumentReactRender(renderFn, "AsyncComponent");
      assertEquals(result, "async rendered");
    });

    it("should handle render errors in sync functions", async () => {
      const renderFn = () => {
        throw new Error("Render error");
      };

      await assertRejects(
        () => instrumentReactRender(renderFn, "ErrorComponent"),
        Error,
        "Render error"
      );
    });

    it("should handle render errors in async functions", async () => {
      const renderFn = async () => {
        throw new Error("Async render error");
      };

      await assertRejects(
        () => instrumentReactRender(renderFn, "AsyncErrorComponent"),
        Error,
        "Async render error"
      );
    });

    it("should return objects from render function", async () => {
      const renderFn = () => ({ type: "div", children: "content" });
      const result = await instrumentReactRender(renderFn, "ObjectComponent");
      assertEquals(result.type, "div");
      assertEquals(result.children, "content");
    });

    it("should handle null returns", async () => {
      const renderFn = () => null;
      const result = await instrumentReactRender(renderFn, "NullComponent");
      assertEquals(result, null);
    });

    it("should handle undefined returns", async () => {
      const renderFn = () => undefined;
      const result = await instrumentReactRender(renderFn, "UndefinedComponent");
      assertEquals(result, undefined);
    });

    it("should handle complex component names", async () => {
      const renderFn = () => "content";
      const result = await instrumentReactRender(renderFn, "App.Header.Navigation");
      assertEquals(result, "content");
    });

    it("should measure render duration", async () => {
      const renderFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "slow render";
      };
      const startTime = performance.now();
      const result = await instrumentReactRender(renderFn, "SlowComponent");
      const duration = performance.now() - startTime;

      assertEquals(result, "slow render");
      // Ensure it took roughly the expected time (with some buffer)
      assertEquals(duration >= 45, true);
    });

    it("should handle different return types", async () => {
      const numberRender = () => 42;
      const boolRender = () => true;
      const arrayRender = () => [1, 2, 3];

      assertEquals(await instrumentReactRender(numberRender, "Number"), 42);
      assertEquals(await instrumentReactRender(boolRender, "Bool"), true);
      assertEquals(await instrumentReactRender(arrayRender, "Array"), [1, 2, 3]);
    });
  });

  describe("instrumentErrorHandler", () => {
    it("should wrap error handler function", () => {
      const handler = (_error: Error) => new Response("error");
      const instrumented = instrumentErrorHandler(handler);

      assertExists(instrumented);
      assertEquals(typeof instrumented, "function");
    });

    it("should call original handler with error", () => {
      let capturedError: Error | undefined;
      const handler = (error: Error) => {
        capturedError = error;
        return new Response("handled");
      };

      const instrumented = instrumentErrorHandler(handler);
      const testError = new Error("Test error");
      instrumented(testError);

      assertExists(capturedError);
      assertEquals(capturedError?.message, "Test error");
    });

    it("should handle async error handlers", async () => {
      const handler = async (error: Error) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(error.message);
      };

      const instrumented = instrumentErrorHandler(handler);
      const testError = new Error("Async error");
      const response = await instrumented(testError);

      assertEquals(await response.text(), "Async error");
    });

    it("should pass request to handler when provided", () => {
      let capturedRequest: Request | undefined;
      const handler = (_error: Error, request?: Request) => {
        capturedRequest = request;
        return new Response("handled");
      };

      const instrumented = instrumentErrorHandler(handler);
      const testError = new Error("Test error");
      const testRequest = new Request("http://localhost/test");
      instrumented(testError, testRequest);

      assertExists(capturedRequest);
      assertEquals(capturedRequest.url, "http://localhost/test");
    });

    it("should work without request parameter", () => {
      const handler = (error: Error) => new Response(error.message);
      const instrumented = instrumentErrorHandler(handler);
      const testError = new Error("No request");
      const response = instrumented(testError);

      assertEquals(typeof response, "object");
    });

    it("should respect captureToSpan parameter", () => {
      const handler = (error: Error) => new Response(error.message);

      // With captureToSpan = true (default)
      const instrumentedTrue = instrumentErrorHandler(handler, true);
      const response1 = instrumentedTrue(new Error("Captured"));
      assertExists(response1);

      // With captureToSpan = false
      const instrumentedFalse = instrumentErrorHandler(handler, false);
      const response2 = instrumentedFalse(new Error("Not captured"));
      assertExists(response2);
    });

    it("should handle different error types", () => {
      let capturedError: Error | undefined;
      const handler = (error: Error) => {
        capturedError = error;
        return new Response("handled");
      };

      const instrumented = instrumentErrorHandler(handler);

      // Standard Error
      const stdError = new Error("Standard error");
      instrumented(stdError);
      assertEquals(capturedError?.message, "Standard error");

      // TypeError
      const typeError = new TypeError("Type error");
      instrumented(typeError);
      assertEquals(capturedError?.message, "Type error");

      // Custom Error
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }
      const customError = new CustomError("Custom error");
      instrumented(customError);
      assertEquals(capturedError?.message, "Custom error");
    });

    it("should propagate handler return value", async () => {
      const handler = (error: Error) => new Response(error.message, { status: 500 });
      const instrumented = instrumentErrorHandler(handler);
      const response = instrumented(new Error("Server error"));

      // Response could be a promise if handler is async
      const finalResponse = response instanceof Promise ? await response : response;
      assertEquals(finalResponse.status, 500);
    });

    it("should handle handler that throws", () => {
      const handler = (_error: Error) => {
        throw new Error("Handler failed");
      };

      const instrumented = instrumentErrorHandler(handler);

      try {
        instrumented(new Error("Original error"));
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals((error as Error).message, "Handler failed");
      }
    });
  });
});
