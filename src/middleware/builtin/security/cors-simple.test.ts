import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { corsSimple } from "./cors-simple.ts";
import { MiddlewareContext } from "../../core/context.ts";

describe("corsSimple", () => {
  function createContext(method = "GET", origin?: string): MiddlewareContext {
    const headers: Record<string, string> = origin ? { origin } : {};
    return new MiddlewareContext(
      new Request("https://example.com/api/test", { method, headers }),
    );
  }

  describe("preflight requests", () => {
    it("should respond to OPTIONS with 204", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("OPTIONS", "https://other.com");

      const response = await middleware(
        ctx,
        () => Promise.resolve(new Response("Should not reach")),
      );

      assertEquals(response?.status, 204);
    });

    it("should include CORS headers in preflight response", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("OPTIONS", "https://other.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));
      const allowMethods = response?.headers.get("Access-Control-Allow-Methods") ?? "";
      const allowHeaders = response?.headers.get("Access-Control-Allow-Headers") ?? "";

      assertStringIncludes(allowMethods, "GET");
      assertStringIncludes(allowMethods, "POST");
      assertStringIncludes(allowHeaders, "Content-Type");
    });

    it("should set wildcard origin for *", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("OPTIONS", "https://other.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), "*");
    });
  });

  describe("actual requests", () => {
    it("should add CORS header to response", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("GET", "https://other.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), "*");
    });

    it("should preserve original response body", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("GET", "https://other.com");

      const response = await middleware(
        ctx,
        () => Promise.resolve(new Response("Original Content")),
      );

      assertEquals(await response?.text(), "Original Content");
    });

    it("should preserve original response status", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("GET", "https://other.com");

      const response = await middleware(
        ctx,
        () => Promise.resolve(new Response("Created", { status: 201 })),
      );

      assertEquals(response?.status, 201);
    });

    it("should handle undefined response from next", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("GET", "https://other.com");

      const response = await middleware(ctx, () => Promise.resolve(undefined as never));

      assertEquals(response, undefined);
    });
  });

  describe("origin configuration", () => {
    it("should accept string origin", async () => {
      const middleware = corsSimple("https://allowed.com");
      const ctx = createContext("OPTIONS", "https://allowed.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

      assertEquals(
        response?.headers.get("Access-Control-Allow-Origin"),
        "https://allowed.com",
      );
    });

    it("should accept options object", async () => {
      const middleware = corsSimple({ origin: "https://allowed.com" });
      const ctx = createContext("OPTIONS", "https://allowed.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

      assertEquals(
        response?.headers.get("Access-Control-Allow-Origin"),
        "https://allowed.com",
      );
    });

    it("should default to * when no options provided", async () => {
      const middleware = corsSimple();
      const ctx = createContext("OPTIONS", "https://any.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), "*");
    });
  });
});
