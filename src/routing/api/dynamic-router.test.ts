import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DynamicRouter } from "./api-route-matcher.ts";

const routers: DynamicRouter[] = [];

function createRouter(): DynamicRouter {
  const router = new DynamicRouter();
  routers.push(router);
  return router;
}

afterEach(() => {
  while (routers.length > 0) {
    const router = routers.pop();
    router?.destroy();
  }
});

describe("DynamicRouter - Basic Route Matching", () => {
  describe("addRoute() and match()", () => {
    it("should match exact static routes", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
      assertEquals(match.route.page, "/pages/api/users.ts");
      assertEquals(match.params, {});
    });

    it("should return null for non-matching routes", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      const match = router.match("/api/posts");
      assertEquals(match, null);
    });

    it("should handle root route /", () => {
      const router = createRouter();
      router.addRoute("/", "/pages/index.ts");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.route.pattern, "/");
    });

    it("should normalize trailing slashes in paths", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      const match = router.match("/api/users/");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
    });

    it("should normalize trailing slashes in patterns", () => {
      const router = createRouter();
      router.addRoute("/api/users/", "/pages/api/users.ts");

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
    });

    it("should not normalize trailing slash for root route", () => {
      const router = createRouter();
      router.addRoute("/", "/pages/index.ts");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.route.pattern, "/");
    });
  });
});

describe("DynamicRouter - Dynamic Parameters", () => {
  describe("Single parameter routes [param]", () => {
    it("should match and extract single parameter", () => {
      const router = createRouter();
      router.addRoute("/api/users/[id]", "/pages/api/users/[id].ts");

      const match = router.match("/api/users/123");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users/[id]");
      assertEquals(match.params, { id: "123" });
    });

    it("should extract parameters with special characters", () => {
      const router = createRouter();
      router.addRoute("/api/users/[id]", "/pages/api/users/[id].ts");

      const match = router.match("/api/users/user-123-test");
      assertExists(match);
      assertEquals(match.params, { id: "user-123-test" });
    });

    it("should URL-decode parameter values", () => {
      const router = createRouter();
      router.addRoute("/api/search/[query]", "/pages/api/search/[query].ts");

      const match = router.match("/api/search/hello%20world");
      assertExists(match);
      assertEquals(match.params, { query: "hello world" });
    });

    it("should match multiple parameters", () => {
      const router = createRouter();
      router.addRoute(
        "/api/users/[userId]/posts/[postId]",
        "/pages/api/users/[userId]/posts/[postId].ts",
      );

      const match = router.match("/api/users/42/posts/99");
      assertExists(match);
      assertEquals(match.params, { userId: "42", postId: "99" });
    });

    it("should not match if parameter is missing", () => {
      const router = createRouter();
      router.addRoute("/api/users/[id]", "/pages/api/users/[id].ts");

      const match = router.match("/api/users");
      assertEquals(match, null);
    });

    it("should not match parameter across path segments", () => {
      const router = createRouter();
      router.addRoute("/api/users/[id]", "/pages/api/users/[id].ts");

      const match = router.match("/api/users/123/extra");
      assertEquals(match, null);
    });
  });

  describe("Catch-all routes [...slug]", () => {
    it("should match and extract catch-all as array", () => {
      const router = createRouter();
      router.addRoute("/docs/[...slug]", "/pages/docs/[...slug].ts");

      const match = router.match("/docs/getting-started/introduction");
      assertExists(match);
      assertEquals(match.params, { slug: ["getting-started", "introduction"] });
    });

    it("should match single segment in catch-all", () => {
      const router = createRouter();
      router.addRoute("/docs/[...slug]", "/pages/docs/[...slug].ts");

      const match = router.match("/docs/intro");
      assertExists(match);
      assertEquals(match.params, { slug: ["intro"] });
    });

    it("should URL-decode catch-all segments", () => {
      const router = createRouter();
      router.addRoute("/docs/[...slug]", "/pages/docs/[...slug].ts");

      const match = router.match("/docs/hello%20world/test%2Fpath");
      assertExists(match);
      assertEquals(match.params, { slug: ["hello world", "test/path"] });
    });

    it("should not match catch-all without segments", () => {
      const router = createRouter();
      router.addRoute("/docs/[...slug]", "/pages/docs/[...slug].ts");

      const match = router.match("/docs");
      assertEquals(match, null);
    });
  });

  describe("Optional catch-all routes [[...slug]]", () => {
    it("should match optional catch-all with segments", () => {
      const router = createRouter();
      router.addRoute("/docs/[[...slug]]", "/pages/docs/[[...slug]].ts");

      const match = router.match("/docs/getting-started/intro");
      assertExists(match);
      assertEquals(match.params, { slug: ["getting-started", "intro"] });
    });

    it("should match optional catch-all without segments", () => {
      const router = createRouter();
      router.addRoute("/docs/[[...slug]]", "/pages/docs/[[...slug]].ts");

      const match = router.match("/docs");
      assertExists(match);
      assertEquals(match.params, { slug: [] });
    });

    it("should match optional catch-all with trailing slash", () => {
      const router = createRouter();
      router.addRoute("/docs/[[...slug]]", "/pages/docs/[[...slug]].ts");

      const match = router.match("/docs/");
      assertExists(match);
      assertEquals(match.params, { slug: [] });
    });

    it("should URL-decode optional catch-all segments", () => {
      const router = createRouter();
      router.addRoute("/api/[[...path]]", "/pages/api/[[...path]].ts");

      const match = router.match("/api/hello%20world");
      assertExists(match);
      assert(Array.isArray(match.params.path));
      assertEquals(match.params, { path: ["hello world"] });
    });
  });
});

describe("DynamicRouter - Route Priority", () => {
  describe("Static routes have priority over dynamic", () => {
    it("should match static route before dynamic", () => {
      const router = createRouter();
      router.addRoute("/api/[id]", "/pages/api/[id].ts");
      router.addRoute("/api/users", "/pages/api/users.ts");

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
      assertEquals(match.params, {});
    });

    it("should match dynamic route when static does not match", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");
      router.addRoute("/api/[id]", "/pages/api/[id].ts");

      const match = router.match("/api/123");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/[id]");
      assertEquals(match.params, { id: "123" });
    });
  });

  describe("More specific dynamic routes have priority", () => {
    it("should prefer longer paths", () => {
      const router = createRouter();
      router.addRoute("/api/[...slug]", "/pages/api/[...slug].ts");
      router.addRoute("/api/users/[id]", "/pages/api/users/[id].ts");

      const match = router.match("/api/users/123");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users/[id]");
      assertEquals(match.params, { id: "123" });
    });

    it("should prefer [param] over [...slug]", () => {
      const router = createRouter();
      router.addRoute("/docs/[...slug]", "/pages/docs/[...slug].ts");
      router.addRoute("/docs/[category]", "/pages/docs/[category].ts");

      const match = router.match("/docs/intro");
      assertExists(match);
      assertEquals(match.route.pattern, "/docs/[category]");
      assertEquals(match.params, { category: "intro" });
    });

    it("should prefer [param] over [[...slug]]", () => {
      const router = createRouter();
      router.addRoute("/api/[[...slug]]", "/pages/api/[[...slug]].ts");
      router.addRoute("/api/[id]", "/pages/api/[id].ts");

      const match = router.match("/api/123");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/[id]");
    });
  });
});

describe("DynamicRouter - Cache Management", () => {
  describe("Route caching", () => {
    it("should cache successful matches", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      const match1 = router.match("/api/users");
      const match2 = router.match("/api/users");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1, match2);
    });

    it("should cache null results", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      const match1 = router.match("/api/posts");
      const match2 = router.match("/api/posts");

      assertEquals(match1, null);
      assertEquals(match2, null);
    });

    it("should clear cache on clearCache()", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      router.match("/api/users");
      router.clearCache();

      const match = router.match("/api/users");
      assertExists(match);
    });

    it("should clear cache on clear()", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");

      router.match("/api/users");
      router.clear();

      const match = router.match("/api/users");
      assertEquals(match, null);
    });
  });
});

describe("DynamicRouter - Utility Methods", () => {
  describe("listRoutes()", () => {
    it("should list all registered routes", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");
      router.addRoute("/api/posts", "/pages/api/posts.ts");

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);
      assertEquals(routes[0]!.pattern, "/api/users");
      assertEquals(routes[1]!.pattern, "/api/posts");
    });

    it("should return empty array when no routes", () => {
      const router = createRouter();
      const routes = router.listRoutes();
      assertEquals(routes.length, 0);
    });
  });

  describe("clear()", () => {
    it("should remove all routes", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");
      router.addRoute("/api/posts", "/pages/api/posts.ts");

      router.clear();

      const routes = router.listRoutes();
      assertEquals(routes.length, 0);
    });

    it("should clear route cache", () => {
      const router = createRouter();
      router.addRoute("/api/users", "/pages/api/users.ts");
      router.match("/api/users");

      router.clear();

      const match = router.match("/api/users");
      assertEquals(match, null);
    });
  });
});
