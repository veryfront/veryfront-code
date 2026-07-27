import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { corsSimple } from "./cors-simple.ts";
import { MiddlewareContext } from "../../core/context.ts";

describe("corsSimple", () => {
  function createContext(
    method = "GET",
    origin?: string,
    preflight = method === "OPTIONS",
  ): MiddlewareContext {
    const headers: Record<string, string> = origin ? { origin } : {};
    if (preflight) headers["access-control-request-method"] = "GET";
    return new MiddlewareContext(
      new Request("https://example.com/api/test", { method, headers }),
    );
  }

  describe("preflight requests", () => {
    it("should respond to OPTIONS with 204", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("OPTIONS", "https://other.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

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

    it("should reject preflight requests from disallowed origins", async () => {
      const middleware = corsSimple("https://allowed.com");
      const ctx = createContext("OPTIONS", "https://evil.com");
      let calledNext = false;

      const response = await middleware(ctx, () => {
        calledNext = true;
        return Promise.resolve(new Response("OK"));
      });

      assertEquals(response?.status, 403);
      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(response?.headers.get("Cache-Control"), "no-store");
      assertEquals(calledNext, false);
    });

    it("should pass non-CORS OPTIONS requests to downstream middleware", async () => {
      const middleware = corsSimple("https://allowed.com");
      const ctx = createContext("OPTIONS", undefined, false);
      let calledNext = false;

      const response = await middleware(ctx, () => {
        calledNext = true;
        return Promise.resolve(
          new Response("handled options", {
            status: 200,
            statusText: "Handled downstream",
          }),
        );
      });

      assertEquals(calledNext, true);
      assertEquals(response?.status, 200);
      assertEquals(response?.statusText, "Handled downstream");
      assertEquals(await response?.text(), "handled options");
    });
  });

  describe("actual requests", () => {
    it("should add CORS header to response", async () => {
      const middleware = corsSimple("*");
      const ctx = createContext("GET", "https://other.com");

      const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), "*");
    });

    it("should vary cache entries when reflecting a specific origin", async () => {
      const middleware = corsSimple("https://allowed.example");
      const response = await middleware(
        createContext("GET", "https://allowed.example"),
        () => Promise.resolve(new Response("OK", { headers: { Vary: "Accept-Encoding" } })),
      );

      assertEquals(
        response?.headers.get("Vary"),
        "Accept-Encoding, Origin",
      );
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
        () =>
          Promise.resolve(
            new Response("Created", {
              status: 201,
              statusText: "Created by middleware",
            }),
          ),
      );

      assertEquals(response?.status, 201);
      assertEquals(response?.statusText, "Created by middleware");
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

    it("should reject invalid configured origins at registration", () => {
      assertThrows(
        () => corsSimple({ origin: 42 as never }),
        TypeError,
        "origin",
      );
      assertThrows(
        () => corsSimple("https://allowed.example\r\nx-injected: yes"),
        TypeError,
        "origin",
      );
    });
  });
});
