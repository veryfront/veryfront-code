import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type APIContext,
  createBodyReader,
  createContext,
  normalizeParams,
  parseCookies,
} from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

const mockFs: FileSystemAdapter = {
  readFile: () => Promise.resolve(""),
  writeFile: () => Promise.resolve(),
  readDir: async function* () {},
  exists: () => Promise.resolve(false),
  stat: () =>
    Promise.resolve({ isFile: false, isDirectory: false, isSymlink: false, size: 0, mtime: null }),
  mkdir: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  makeTempDir: () => Promise.resolve("/tmp/mock"),
  watch: () => ({ close: () => {}, [Symbol.asyncIterator]: async function* () {} }),
};

function createMatch(pattern: string, page: string, params: RouteMatch["params"] = {}): RouteMatch {
  return { route: { pattern, page }, params };
}

describe("API Context Builder", () => {
  describe("parseCookies()", () => {
    it("should parse single cookie", () => {
      const cookies = parseCookies("session=abc123");
      assertEquals(cookies.session, "abc123");
    });

    it("should parse multiple cookies", () => {
      const cookies = parseCookies("session=abc123; theme=dark; lang=en");

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
      assertEquals(cookies.lang, "en");
    });

    it("should handle URL-encoded cookie values", () => {
      const cookies = parseCookies("name=John%20Doe; email=test%40example.com");

      assertEquals(cookies.name, "John Doe");
      assertEquals(cookies.email, "test@example.com");
    });

    it("should return empty object for empty cookie header", () => {
      assertEquals(parseCookies(""), {});
    });

    it("should ignore cookies without values", () => {
      const cookies = parseCookies("session=abc123; invalidCookie; theme=dark");

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
      assertEquals(cookies.invalidCookie, undefined);
    });

    it("should handle cookies with spaces around name and value", () => {
      const cookies = parseCookies(" session = abc123 ; theme = dark ");

      assertEquals(cookies.session, " abc123");
      assertEquals(cookies.theme, " dark");
    });

    it("should handle cookies with equals signs in value", () => {
      const cookies = parseCookies("data=key=value; token=abc=123=");

      assertEquals(cookies.data, "key=value");
      assertEquals(cookies.token, "abc=123=");
    });

    it("should handle empty cookie values", () => {
      const cookies = parseCookies("session=; theme=dark");

      assertEquals(cookies.session, "");
      assertEquals(cookies.theme, "dark");
    });

    it("should handle special characters in cookie names", () => {
      const cookies = parseCookies("user-id=123; app_session=abc");

      assertEquals(cookies["user-id"], "123");
      assertEquals(cookies["app_session"], "abc");
    });

    it("should handle complex URL-encoded values", () => {
      const cookies = parseCookies("data=%7B%22user%22%3A%22test%22%7D");
      assertEquals(cookies.data, '{"user":"test"}');
    });

    it("should handle cookies with semicolons in encoded values", () => {
      const cookies = parseCookies("message=Hello%3B%20World; session=abc");

      assertEquals(cookies.message, "Hello; World");
      assertEquals(cookies.session, "abc");
    });

    it("should handle trailing semicolon", () => {
      const cookies = parseCookies("session=abc123; theme=dark;");

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
    });

    it("should handle leading semicolon", () => {
      const cookies = parseCookies("; session=abc123; theme=dark");

      assertEquals(cookies.session, "abc123");
      assertEquals(cookies.theme, "dark");
    });
  });

  describe("createContext()", () => {
    it("should create context with basic request properties", () => {
      const request = new Request("http://localhost/api/users");
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.request, request);
      assertEquals(context.params, {});
      assertExists(context.query);
      assertExists(context.cookies);
      assertExists(context.headers);
      assertExists(context.url);
    });

    it("should extract route parameters from match", () => {
      const request = new Request("http://localhost/api/users/123");
      const context = createContext(
        request,
        createMatch("/api/users/[id]", "/api/users/[id].ts", { id: "123" }),
        mockFs,
      );

      assertEquals(context.params.id, "123");
    });

    it("should parse query parameters from URL", () => {
      const request = new Request("http://localhost/api/users?page=2&limit=10");
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.query.get("page"), "2");
      assertEquals(context.query.get("limit"), "10");
    });

    it("should parse cookies from request headers", () => {
      const request = new Request("http://localhost/api/users", {
        headers: { cookie: "session=abc123; theme=dark" },
      });
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.cookies.session, "abc123");
      assertEquals(context.cookies.theme, "dark");
    });

    it("should handle missing cookie header", () => {
      const request = new Request("http://localhost/api/users");
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.cookies, {});
    });

    it("should preserve request headers", () => {
      const request = new Request("http://localhost/api/users", {
        headers: {
          authorization: "Bearer token123",
          "content-type": "application/json",
        },
      });
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.headers.get("authorization"), "Bearer token123");
      assertEquals(context.headers.get("content-type"), "application/json");
    });

    it("should create URL object from request", () => {
      const request = new Request("http://localhost:3000/api/users?page=1");
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.url.hostname, "localhost");
      assertEquals(context.url.port, "3000");
      assertEquals(context.url.pathname, "/api/users");
      assertEquals(context.url.search, "?page=1");
    });

    it("should handle multiple dynamic route parameters", () => {
      const request = new Request("http://localhost/api/users/123/posts/456");
      const context = createContext(
        request,
        createMatch("/api/users/[userId]/posts/[postId]", "/api/users/[userId]/posts/[postId].ts", {
          userId: "123",
          postId: "456",
        }),
        mockFs,
      );

      assertEquals(context.params.userId, "123");
      assertEquals(context.params.postId, "456");
    });

    it("should handle catch-all route parameters", () => {
      const request = new Request("http://localhost/api/docs/guide/intro");
      const context = createContext(
        request,
        createMatch("/api/docs/[...slug]", "/api/docs/[...slug].ts", {
          slug: ["guide", "intro"],
        }),
        mockFs,
      );

      assertEquals(context.params.slug, ["guide", "intro"]);
    });

    it("should handle empty query string", () => {
      const request = new Request("http://localhost/api/users");
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.query.toString(), "");
    });

    it("should handle complex query parameters", () => {
      const request = new Request(
        "http://localhost/api/users?filter[status]=active&sort=-created&page=1",
      );
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.query.get("filter[status]"), "active");
      assertEquals(context.query.get("sort"), "-created");
      assertEquals(context.query.get("page"), "1");
    });

    it("should handle URL-encoded query parameters", () => {
      const request = new Request(
        "http://localhost/api/search?q=hello%20world&type=user%20profile",
      );
      const context = createContext(request, createMatch("/api/search", "/api/search.ts"), mockFs);

      assertEquals(context.query.get("q"), "hello world");
      assertEquals(context.query.get("type"), "user profile");
    });

    it("should handle array query parameters", () => {
      const request = new Request("http://localhost/api/users?tags=js&tags=ts&tags=deno");
      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.query.getAll("tags"), ["js", "ts", "deno"]);
    });
  });

  describe("normalizeParams()", () => {
    it("should preserve string parameters", () => {
      const normalized = normalizeParams({ id: "123", name: "test" });

      assertEquals(normalized.id, "123");
      assertEquals(normalized.name, "test");
    });

    it("should convert array parameters to slash-separated strings", () => {
      const normalized = normalizeParams({ slug: ["docs", "api", "intro"] });
      assertEquals(normalized.slug, "docs/api/intro");
    });

    it("should handle mixed string and array parameters", () => {
      const normalized = normalizeParams({
        id: "123",
        slug: ["docs", "guide"],
        category: "tutorial",
      });

      assertEquals(normalized.id, "123");
      assertEquals(normalized.slug, "docs/guide");
      assertEquals(normalized.category, "tutorial");
    });

    it("should handle empty array parameters", () => {
      const normalized = normalizeParams({ slug: [] });
      assertEquals(normalized.slug, "");
    });

    it("should handle single-element array parameters", () => {
      const normalized = normalizeParams({ slug: ["single"] });
      assertEquals(normalized.slug, "single");
    });

    it("should handle empty object", () => {
      assertEquals(normalizeParams({}), {});
    });

    it("should handle parameters with special characters", () => {
      const normalized = normalizeParams({
        id: "user-123",
        path: ["docs", "api-reference", "v1.0"],
      });

      assertEquals(normalized.id, "user-123");
      assertEquals(normalized.path, "docs/api-reference/v1.0");
    });

    it("should not modify original params object", () => {
      const params = { id: "123", slug: ["docs", "guide"] };
      const normalized = normalizeParams(params);

      normalized.id = "456";

      assertEquals(params.id, "123");
      assertEquals(params.slug, ["docs", "guide"]);
    });

    it("should handle nested path arrays", () => {
      const normalized = normalizeParams({
        path: ["api", "v2", "users", "profile", "settings"],
      });

      assertEquals(normalized.path, "api/v2/users/profile/settings");
    });

    it("should handle URL-encoded segments in arrays", () => {
      const normalized = normalizeParams({
        slug: ["hello world", "test@example.com", "user/profile"],
      });

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

      const context = createContext(
        request,
        createMatch("/api/users/[id]", "/api/users/[id].ts", { id: "123" }),
        mockFs,
      );

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
      const context = createContext(
        request,
        createMatch("/api/docs/[...slug]", "/api/docs/[...slug].ts", {
          slug: ["guide", "intro", "basics"],
        }),
        mockFs,
      );

      const normalized = normalizeParams(context.params);
      assertEquals(normalized.slug, "guide/intro/basics");
    });

    it("should handle POST request with body", async () => {
      const request = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test User", email: "test@example.com" }),
      });

      const context = createContext(request, createMatch("/api/users", "/api/users.ts"), mockFs);

      assertEquals(context.request.method, "POST");
      assertEquals(context.headers.get("content-type"), "application/json");

      const body = await context.request.json();
      assertEquals(body.name, "Test User");
      assertEquals(body.email, "test@example.com");
    });
  });
});

describe("createContext: ctx.json writes, ctx.body reads", () => {
  function ctxFor(request: Request): APIContext {
    return createContext(request, { params: {} } as RouteMatch, mockFs);
  }

  it("builds a JSON response from ctx.json(data)", async () => {
    const ctx = ctxFor(new Request("http://localhost/api/echo"));
    const response = ctx.json({ received: true });

    assertEquals(response instanceof Response, true);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), { received: true });
  });

  it("honours a ResponseInit when building a response", async () => {
    const ctx = ctxFor(new Request("http://localhost/api/echo"));
    const response = ctx.json({ error: "nope" }, { status: 422 });

    assertEquals(response.status, 422);
    assertEquals(await response.json(), { error: "nope" });
  });

  it("reads the request body with ctx.body()", async () => {
    const ctx = ctxFor(
      new Request("http://localhost/api/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: 1, nested: { y: "z" } }),
      }),
    );

    assertEquals(await ctx.body(), { x: 1, nested: { y: "z" } });
  });

  it("caches the parse so ctx.body() can be read more than once", async () => {
    // A validation helper and the handler both receive only `ctx`, so both
    // reach for the body. A single-use stream would make the second call throw.
    const ctx = ctxFor(
      new Request("http://localhost/api/echo", {
        method: "POST",
        body: JSON.stringify({ count: 7 }),
      }),
    );

    assertEquals(await ctx.body(), { count: 7 });
    assertEquals(await ctx.body(), { count: 7 });
  });

  it("does not consume the body away from a manual ctx.request.json()", async () => {
    const ctx = ctxFor(
      new Request("http://localhost/api/echo", {
        method: "POST",
        body: JSON.stringify({ shared: true }),
      }),
    );

    await ctx.body();
    // The raw request stream is untouched by ctx.body(), so this still works.
    assertEquals(await ctx.request.json(), { shared: true });
  });

  it("reads via ctx.body() even after ctx.request was consumed raw first", async () => {
    // The reverse order: a handler reads the raw stream, *then* reaches for
    // ctx.body(). The clone is taken at construction time, so it does not throw
    // `Body already consumed` no matter which one runs first.
    const ctx = ctxFor(
      new Request("http://localhost/api/echo", {
        method: "POST",
        body: JSON.stringify({ shared: true }),
      }),
    );

    assertEquals(await ctx.request.json(), { shared: true });
    assertEquals(await ctx.body(), { shared: true });
  });

  it("throws a 400 when the body is not valid JSON", async () => {
    const ctx = ctxFor(
      new Request("http://localhost/api/echo", { method: "POST", body: "not json" }),
    );

    const error = await assertRejects(() => ctx.body());
    assertEquals((error as { status?: number }).status, 400);
  });

  it("createBodyReader reads the body under worker isolation too", async () => {
    // Worker isolation builds its own context, so it uses this same reader.
    const read = createBodyReader(
      new Request("http://localhost/api/echo", {
        method: "POST",
        body: JSON.stringify({ isolated: true }),
      }),
    );

    assertEquals(await read(), { isolated: true });
  });
});

describe("createContext: null-body statuses drop the body instead of throwing", () => {
  function ctxFor(request: Request): APIContext {
    return createContext(request, { params: {} } as RouteMatch, mockFs);
  }

  it("builds a 204 from ctx.text('', { status: 204 }) without throwing", async () => {
    // `new Response("", { status: 204 })` throws — 204 is a null-body status and
    // the empty string is still a (non-null) body. The helper must send `null`.
    const ctx = ctxFor(new Request("http://localhost/api/text-204"));
    const response = ctx.text("", { status: 204 });

    assertEquals(response.status, 204);
    assertEquals(response.body, null);
    assertEquals(await response.text(), "");
  });

  it("builds a 204 from ctx.json(data, { status: 204 }) without throwing", () => {
    const ctx = ctxFor(new Request("http://localhost/api/json-204"));
    const response = ctx.json({ ignored: true }, { status: 204 });

    assertEquals(response.status, 204);
    assertEquals(response.body, null);
  });

  it("drops the body on a 304 too", () => {
    const ctx = ctxFor(new Request("http://localhost/api/cached"));
    const response = ctx.text("stale", { status: 304 });

    assertEquals(response.status, 304);
    assertEquals(response.body, null);
  });

  it("still returns the body for a normal 200 from ctx.text", async () => {
    const ctx = ctxFor(new Request("http://localhost/api/hello"));
    const response = ctx.text("hello", { status: 200 });

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "hello");
  });
});
