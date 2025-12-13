import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { corsSimple } from "./cors-simple.ts";
import { MiddlewareContext } from "../../core/context.ts";
import { HTTP_NO_CONTENT } from "@veryfront/utils/constants/http.ts";

describe("corsSimple", () => {
  it("should handle OPTIONS preflight request with default wildcard origin", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "OPTIONS",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_NO_CONTENT);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
    assertEquals(
      response.headers.get("Access-Control-Allow-Methods"),
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    assertEquals(
      response.headers.get("Access-Control-Allow-Headers"),
      "Content-Type,Authorization",
    );
  });

  it("should handle OPTIONS preflight request with specific origin", async () => {
    const middleware = corsSimple("http://example.com");
    const req = new Request("http://localhost/test", {
      method: "OPTIONS",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_NO_CONTENT);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "http://example.com");
  });

  it("should handle OPTIONS preflight request with options object", async () => {
    const middleware = corsSimple({ origin: "http://example.com" });
    const req = new Request("http://localhost/test", {
      method: "OPTIONS",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_NO_CONTENT);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "http://example.com");
  });

  it("should add CORS headers to actual request", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "GET",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  });

  it("should preserve existing response headers", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "GET",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () =>
      Promise.resolve(
        new Response("OK", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "custom-value",
          },
        }),
      );

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(response.headers.get("X-Custom-Header"), "custom-value");
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  });

  it("should handle POST request with CORS headers", async () => {
    const middleware = corsSimple("http://example.com");
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("Created", { status: 201 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, 201);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "http://example.com");
  });

  it("should handle case-insensitive OPTIONS method", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "options",
      headers: {
        origin: "http://example.com",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_NO_CONTENT);
  });

  it("should return undefined response if next returns undefined", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "GET",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(undefined);

    const response = await middleware(ctx, next);

    assertEquals(response, undefined);
  });

  it("should handle request without origin header", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "GET",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  });

  it("should handle OPTIONS request without origin header", async () => {
    const middleware = corsSimple();
    const req = new Request("http://localhost/test", {
      method: "OPTIONS",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_NO_CONTENT);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  });
});
