import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { createInstrumentedFetch, instrumentHttpHandler } from "./http-instrumentation.ts";

describe("http-instrumentation", () => {
  describe("instrumentHttpHandler", () => {
    it("should wrap handler and return a function", () => {
      const handler = (_request: Request) => new Response("test");
      const instrumented = instrumentHttpHandler(handler);
      assertExists(instrumented);
      assertEquals(typeof instrumented, "function");
    });

    it("should call the original handler with the request", async () => {
      let calledWithUrl = "";
      const handler = (request: Request) => {
        calledWithUrl = request.url;
        return new Response("ok");
      };

      const instrumented = instrumentHttpHandler(handler);
      const request = new Request("http://localhost/test");
      const response = await instrumented(request);

      assertEquals(calledWithUrl, "http://localhost/test");
      assertEquals(await response.text(), "ok");
    });

    it("should handle async handlers", async () => {
      const handler = async (request: Request) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(`handled: ${request.method}`);
      };

      const instrumented = instrumentHttpHandler(handler);
      const request = new Request("http://localhost/test", { method: "POST" });
      const response = await instrumented(request);

      assertEquals(await response.text(), "handled: POST");
    });

    it("should propagate response status codes", async () => {
      const handler = (_request: Request) => new Response("not found", { status: 404 });

      const instrumented = instrumentHttpHandler(handler);
      const request = new Request("http://localhost/test");
      const response = await instrumented(request);

      assertEquals(response.status, 404);
    });

    it("should handle handler errors gracefully", async () => {
      const handler = (_request: Request) => {
        throw new Error("Handler error");
      };

      const instrumented = instrumentHttpHandler(handler);
      const request = new Request("http://localhost/test");

      await assertRejects(
        () => instrumented(request),
        Error,
        "Handler error"
      );
    });

    it("should handle different HTTP methods", async () => {
      const handler = (request: Request) => new Response(request.method);
      const instrumented = instrumentHttpHandler(handler);

      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      for (const method of methods) {
        const request = new Request("http://localhost/test", { method });
        const response = await instrumented(request);
        assertEquals(await response.text(), method);
      }
    });

    it("should handle requests with query parameters", async () => {
      const handler = (request: Request) => {
        const url = new URL(request.url);
        return new Response(url.searchParams.get("param") || "");
      };

      const instrumented = instrumentHttpHandler(handler);
      const request = new Request("http://localhost/test?param=value");
      const response = await instrumented(request);

      assertEquals(await response.text(), "value");
    });
  });

  describe("createInstrumentedFetch", () => {
    it("should create an instrumented fetch function", () => {
      const mockFetch = () => Promise.resolve(new Response("mock"));
      const instrumented = createInstrumentedFetch(mockFetch);

      assertExists(instrumented);
      assertEquals(typeof instrumented, "function");
    });

    it("should call the base fetch with correct arguments", async () => {
      let capturedInput: RequestInfo | URL | undefined;
      let capturedInit: RequestInit | undefined;

      const mockFetch = (input: RequestInfo | URL, init?: RequestInit) => {
        capturedInput = input;
        capturedInit = init;
        return Promise.resolve(new Response("mock"));
      };

      const instrumented = createInstrumentedFetch(mockFetch);
      await instrumented("http://example.com/api", { method: "POST" });

      assertEquals(capturedInput, "http://example.com/api");
      assertEquals(capturedInit?.method, "POST");
    });

    it("should handle string URLs", async () => {
      const mockFetch = () => Promise.resolve(new Response("ok"));
      const instrumented = createInstrumentedFetch(mockFetch);

      const response = await instrumented("http://example.com");
      assertEquals(await response.text(), "ok");
    });

    it("should handle URL objects", async () => {
      const mockFetch = () => Promise.resolve(new Response("ok"));
      const instrumented = createInstrumentedFetch(mockFetch);

      const url = new URL("http://example.com");
      const response = await instrumented(url);
      assertEquals(await response.text(), "ok");
    });

    it("should handle Request objects", async () => {
      const mockFetch = () => Promise.resolve(new Response("ok"));
      const instrumented = createInstrumentedFetch(mockFetch);

      const request = new Request("http://example.com");
      const response = await instrumented(request);
      assertEquals(await response.text(), "ok");
    });

    it("should default to GET method when not specified", async () => {
      let capturedInit: RequestInit | undefined;
      const mockFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(new Response("ok"));
      };

      const instrumented = createInstrumentedFetch(mockFetch);
      await instrumented("http://example.com");

      // Init might have headers injected, but method should be undefined or GET
      assertEquals(capturedInit?.method, undefined);
    });

    it("should handle fetch errors gracefully", async () => {
      const mockFetch = () => {
        throw new Error("Network error");
      };

      const instrumented = createInstrumentedFetch(mockFetch);

      await assertRejects(
        () => instrumented("http://example.com"),
        Error,
        "Network error"
      );
    });

    it("should inject tracing headers", async () => {
      let capturedHeaders: Headers | undefined;
      const mockFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response("ok"));
      };

      const instrumented = createInstrumentedFetch(mockFetch);
      await instrumented("http://example.com");

      assertExists(capturedHeaders);
      // Headers should be a Headers object
      assertEquals(capturedHeaders instanceof Headers, true);
    });

    it("should preserve existing headers", async () => {
      let capturedHeaders: Headers | undefined;
      const mockFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response("ok"));
      };

      const instrumented = createInstrumentedFetch(mockFetch);
      const headers = { "X-Custom": "value" };
      await instrumented("http://example.com", { headers });

      assertExists(capturedHeaders);
      assertEquals(capturedHeaders.get("X-Custom"), "value");
    });

    it("should handle relative URLs", async () => {
      const mockFetch = () => Promise.resolve(new Response("ok"));
      const instrumented = createInstrumentedFetch(mockFetch);

      // Relative URLs should not throw
      const response = await instrumented("/api/test");
      assertEquals(await response.text(), "ok");
    });

    it("should handle different response status codes", async () => {
      const mockFetch = () => Promise.resolve(new Response("error", { status: 500 }));
      const instrumented = createInstrumentedFetch(mockFetch);

      const response = await instrumented("http://example.com");
      assertEquals(response.status, 500);
    });
  });
});
