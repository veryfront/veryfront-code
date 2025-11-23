import { assertEquals, assertExists } from "std/testing/asserts.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";

describe("API Context Builder", () => {
  describe("parseCookies()", () => {
    it("should parse single cookie", () => {
      const cookieHeader = "session=abc123";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, "abc123");
    });

    it("should parse multiple cookies", () => {
      const cookieHeader = "session=abc123; theme=dark; lang=en";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
      assertEquals(cookies.lang, "en");
    });

    it("should handle URL-encoded cookie values", () => {
      const cookieHeader = "name=John%20Doe; email=test%40example.com";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.name, "John Doe");
      assertEquals(cookies.email, "test@example.com");
    });

    it("should return empty object for empty cookie header", () => {
      const cookies = parseCookies("");
      assertEquals(cookies, {});
    });

    it("should ignore cookies without values", () => {
      const cookieHeader = "session=abc123; invalidCookie; theme=dark";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
      assertEquals(cookies.invalidCookie, undefined);
    });

    it("should handle cookies with spaces around name and value", () => {
      const cookieHeader = " session = abc123 ; theme = dark ";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, " abc123");
      assertEquals(cookies.theme, " dark");
    });

    it("should handle cookies with equals signs in value", () => {
      const cookieHeader = "data=key=value; token=abc=123=";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.data, "key=value");
      assertEquals(cookies.token, "abc=123=");
    });

    it("should handle empty cookie values", () => {
      const cookieHeader = "session=; theme=dark";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, "");
      assertEquals(cookies.theme, "dark");
    });

    it("should handle special characters in cookie names", () => {
      const cookieHeader = "user-id=123; app_session=abc";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies["user-id"], "123");
      assertEquals(cookies["app_session"], "abc");
    });

    it("should handle complex URL-encoded values", () => {
      const cookieHeader = "data=%7B%22user%22%3A%22test%22%7D";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.data, '{"user":"test"}');
    });

    it("should handle cookies with semicolons in encoded values", () => {
      const cookieHeader = "message=Hello%3B%20World; session=abc";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.message, "Hello; World");
      assertEquals(cookies.session, "abc");
    });

    it("should handle trailing semicolon", () => {
      const cookieHeader = "session=abc123; theme=dark;";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
    });

    it("should handle leading semicolon", () => {
      const cookieHeader = "; session=abc123; theme=dark";
      const cookies = parseCookies(cookieHeader);

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
    });
  });

  describe("createContext()", () => {
    it("should create context with basic request properties", () => {
      const request = new Request("http://localhost/api/users");
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.request, request);
      assertEquals(context.params, {});
      assertExists(context.query);
      assertExists(context.cookies);
      assertExists(context.headers);
      assertExists(context.url);
    });

    it("should extract route parameters from match", () => {
      const request = new Request("http://localhost/api/users/123");
      const match: RouteMatch = {
        route: { pattern: "/api/users/[id]", page: "/api/users/[id].ts" },
        params: { id: "123" },
      };

      const context = createContext(request, match);

      assertEquals(context.params.id, "123");
    });

    it("should parse query parameters from URL", () => {
      const request = new Request("http://localhost/api/users?page=2&limit=10");
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.query.get("page"), "2");
      assertEquals(context.query.get("limit"), "10");
    });

    it("should parse cookies from request headers", () => {
      const request = new Request("http://localhost/api/users", {
        headers: {
          cookie: "session=abc123; theme=dark",
        },
      });
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.cookies.session, "abc123");
      assertEquals(context.cookies.theme, "dark");
    });

    it("should handle missing cookie header", () => {
      const request = new Request("http://localhost/api/users");
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.cookies, {});
    });

    it("should preserve request headers", () => {
      const request = new Request("http://localhost/api/users", {
        headers: {
          authorization: "Bearer token123",
          "content-type": "application/json",
        },
      });
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.headers.get("authorization"), "Bearer token123");
      assertEquals(context.headers.get("content-type"), "application/json");
    });

    it("should create URL object from request", () => {
      const request = new Request("http://localhost:3000/api/users?page=1");
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.url.hostname, "localhost");
      assertEquals(context.url.port, "3000");
      assertEquals(context.url.pathname, "/api/users");
      assertEquals(context.url.search, "?page=1");
    });

    it("should handle multiple dynamic route parameters", () => {
      const request = new Request("http://localhost/api/users/123/posts/456");
      const match: RouteMatch = {
        route: {
          pattern: "/api/users/[userId]/posts/[postId]",
          page: "/api/users/[userId]/posts/[postId].ts",
        },
        params: { userId: "123", postId: "456" },
      };

      const context = createContext(request, match);

      assertEquals(context.params.userId, "123");
      assertEquals(context.params.postId, "456");
    });

    it("should handle catch-all route parameters", () => {
      const request = new Request("http://localhost/api/docs/guide/intro");
      const match: RouteMatch = {
        route: { pattern: "/api/docs/[...slug]", page: "/api/docs/[...slug].ts" },
        params: { slug: ["guide", "intro"] },
      };

      const context = createContext(request, match);

      assertEquals(context.params.slug, ["guide", "intro"]);
    });

    it("should handle empty query string", () => {
      const request = new Request("http://localhost/api/users");
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.query.toString(), "");
    });

    it("should handle complex query parameters", () => {
      const request = new Request(
        "http://localhost/api/users?filter[status]=active&sort=-created&page=1",
      );
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.query.get("filter[status]"), "active");
      assertEquals(context.query.get("sort"), "-created");
      assertEquals(context.query.get("page"), "1");
    });

    it("should handle URL-encoded query parameters", () => {
      const request = new Request(
        "http://localhost/api/search?q=hello%20world&type=user%20profile",
      );
      const match: RouteMatch = {
        route: { pattern: "/api/search", page: "/api/search.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.query.get("q"), "hello world");
      assertEquals(context.query.get("type"), "user profile");
    });

    it("should handle array query parameters", () => {
      const request = new Request("http://localhost/api/users?tags=js&tags=ts&tags=deno");
      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.query.getAll("tags"), ["js", "ts", "deno"]);
    });
  });

  describe("normalizeParams()", () => {
    it("should preserve string parameters", () => {
      const params = { id: "123", name: "test" };
      const normalized = normalizeParams(params);

      assertEquals(normalized.id, "123");
      assertEquals(normalized.name, "test");
    });

    it("should convert array parameters to slash-separated strings", () => {
      const params = { slug: ["docs", "api", "intro"] };
      const normalized = normalizeParams(params);

      assertEquals(normalized.slug, "docs/api/intro");
    });

    it("should handle mixed string and array parameters", () => {
      const params = {
        id: "123",
        slug: ["docs", "guide"],
        category: "tutorial",
      };
      const normalized = normalizeParams(params);

      assertEquals(normalized.id, "123");
      assertEquals(normalized.slug, "docs/guide");
      assertEquals(normalized.category, "tutorial");
    });

    it("should handle empty array parameters", () => {
      const params = { slug: [] };
      const normalized = normalizeParams(params);

      assertEquals(normalized.slug, "");
    });

    it("should handle single-element array parameters", () => {
      const params = { slug: ["single"] };
      const normalized = normalizeParams(params);

      assertEquals(normalized.slug, "single");
    });

    it("should handle empty object", () => {
      const params = {};
      const normalized = normalizeParams(params);

      assertEquals(normalized, {});
    });

    it("should handle parameters with special characters", () => {
      const params = {
        id: "user-123",
        path: ["docs", "api-reference", "v1.0"],
      };
      const normalized = normalizeParams(params);

      assertEquals(normalized.id, "user-123");
      assertEquals(normalized.path, "docs/api-reference/v1.0");
    });

    it("should not modify original params object", () => {
      const params = {
        id: "123",
        slug: ["docs", "guide"],
      };
      const normalized = normalizeParams(params);

      normalized.id = "456";

      assertEquals(params.id, "123");
      assertEquals(params.slug, ["docs", "guide"]);
    });

    it("should handle nested path arrays", () => {
      const params = {
        path: ["api", "v2", "users", "profile", "settings"],
      };
      const normalized = normalizeParams(params);

      assertEquals(normalized.path, "api/v2/users/profile/settings");
    });

    it("should handle URL-encoded segments in arrays", () => {
      const params = {
        slug: ["hello world", "test@example.com", "user/profile"],
      };
      const normalized = normalizeParams(params);

      assertEquals(normalized.slug, "hello world/test@example.com/user/profile");
    });
  });

  describe("Integration scenarios", () => {
    it("should create complete context from real-world request", () => {
      const request = new Request("http://localhost:3000/api/users/123?include=posts&limit=10", {
        method: "GET",
        headers: {
          authorization: "Bearer token123",
          cookie: "session=abc; theme=dark",
          "content-type": "application/json",
        },
      });

      const match: RouteMatch = {
        route: { pattern: "/api/users/[id]", page: "/api/users/[id].ts" },
        params: { id: "123" },
      };

      const context = createContext(request, match);

      assertEquals(context.request.method, "GET");
      assertEquals(context.params.id, "123");
      assertEquals(context.query.get("include"), "posts");
      assertEquals(context.query.get("limit"), "10");
      assertEquals(context.cookies.session, "abc");
      assertEquals(context.cookies.theme, "dark");
      assertEquals(context.headers.get("authorization"), "Bearer token123");
      assertEquals(context.url.pathname, "/api/users/123");
    });

    it("should work with normalizeParams for catch-all routes", () => {
      const request = new Request("http://localhost/api/docs/guide/intro/basics");
      const match: RouteMatch = {
        route: { pattern: "/api/docs/[...slug]", page: "/api/docs/[...slug].ts" },
        params: { slug: ["guide", "intro", "basics"] },
      };

      const context = createContext(request, match);
      const normalized = normalizeParams(context.params);

      assertEquals(normalized.slug, "guide/intro/basics");
    });

    it("should handle POST request with body", async () => {
      const bodyData = JSON.stringify({ name: "Test User", email: "test@example.com" });
      const request = new Request("http://localhost/api/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: bodyData,
      });

      const match: RouteMatch = {
        route: { pattern: "/api/users", page: "/api/users.ts" },
        params: {},
      };

      const context = createContext(request, match);

      assertEquals(context.request.method, "POST");
      assertEquals(context.headers.get("content-type"), "application/json");

      const body = await context.request.json();
      assertEquals(body.name, "Test User");
      assertEquals(body.email, "test@example.com");
    });
  });
});
