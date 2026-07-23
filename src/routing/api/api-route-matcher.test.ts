import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ApiRouteMatcher } from "./api-route-matcher.ts";

const routers: ApiRouteMatcher[] = [];

function createRouter(): ApiRouteMatcher {
  const router = new ApiRouteMatcher();
  routers.push(router);
  return router;
}

afterEach((): void => {
  while (routers.length) routers.pop()?.destroy();
});

describe("ApiRouteMatcher", () => {
  describe("Malformed percent-encoding", () => {
    it("does not throw on malformed encoding in a dynamic segment", () => {
      const router = createRouter();
      router.addRoute("/api/users/[id]", "pages/api/users/[id].ts");

      const match = router.match("/api/users/%zz");
      assertExists(match);
      assertEquals(match.params.id, "%zz");
    });

    it("does not throw on malformed encoding in a catch-all segment", () => {
      const router = createRouter();
      router.addRoute("/api/files/[...path]", "pages/api/files/[...path].ts");

      const match = router.match("/api/files/ok/%zz");
      assertExists(match);
      assertEquals(match.params.path, ["ok", "%zz"]);
    });
  });

  describe("Static routes", () => {
    it("matches exact static routes", () => {
      const router = createRouter();
      router.addRoute("/about", "pages/about.tsx");
      router.addRoute("/contact", "pages/contact.tsx");

      const match = router.match("/about");
      assertExists(match);
      assertEquals(match.route.page, "pages/about.tsx");
      assertEquals(match.params, {});
    });

    it("returns null for non-matching routes", () => {
      const router = createRouter();
      router.addRoute("/about", "pages/about.tsx");

      assertEquals(router.match("/not-found"), null);
    });

    it("treats regular expression metacharacters as literal path characters", () => {
      const router = createRouter();
      router.addRoute("/api/v1.0/users+admins", "pages/api/versioned.ts");

      assertExists(router.match("/api/v1.0/users+admins"));
      assertEquals(router.match("/api/v1x0/usersadmins"), null);
      assertEquals(router.match("/api/v110/usersssssadmins"), null);
    });

    it("does not turn placeholder-looking static paths into dynamic routes", () => {
      for (
        const marker of [
          "___PARAM___",
          "___CATCHALL___",
          "___OPTIONAL_CATCHALL___",
        ]
      ) {
        const router = createRouter();
        router.addRoute(`/api/${marker}`, `pages/api/${marker}.ts`);

        assertEquals(router.match(`/api/${marker}`)?.route.page, `pages/api/${marker}.ts`);
        assertEquals(router.match("/api/unrelated"), null);
      }
    });

    it("prioritizes unsupported bracket syntax as a literal route", () => {
      const router = new ApiRouteMatcher();
      router.addRoute("/api/[id]", "dynamic.ts");
      router.addRoute("/api/[user.id]", "literal.ts");

      assertEquals(router.match("/api/[user.id]")?.route.page, "literal.ts");
    });

    it("handles root route", () => {
      const router = createRouter();
      router.addRoute("/", "pages/index.tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.route.page, "pages/index.tsx");
    });
  });

  describe("Dynamic segments", () => {
    it("matches single dynamic segment", () => {
      const router = createRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");

      const match = router.match("/blog/hello-world");
      assertExists(match);
      assertEquals(match.params, { slug: "hello-world" });
    });

    it("matches multiple dynamic segments", () => {
      const router = createRouter();
      router.addRoute("/shop/[category]/[product]", "pages/shop/[category]/[product].tsx");

      const match = router.match("/shop/electronics/laptop");
      assertExists(match);
      assertEquals(match.params, { category: "electronics", product: "laptop" });
    });

    it("handles URL encoded parameters", () => {
      const router = createRouter();
      router.addRoute("/user/[name]", "pages/user/[name].tsx");

      const match = router.match("/user/John%20Doe");
      assertExists(match);
      assertEquals(match.params, { name: "John Doe" });
    });

    it("matches nested dynamic routes", () => {
      const router = createRouter();
      router.addRoute("/users/[id]/posts/[postId]", "pages/users/[id]/posts/[postId].tsx");

      const match = router.match("/users/123/posts/456");
      assertExists(match);
      assertEquals(match.params, { id: "123", postId: "456" });
    });
  });

  describe("Catch-all routes", () => {
    it("matches catch-all routes", () => {
      const router = createRouter();
      router.addRoute("/docs/[...path]", "pages/docs/[...path].tsx");

      const match = router.match("/docs/api/auth/login");
      assertExists(match);
      assertEquals(match.params, { path: ["api", "auth", "login"] });
    });

    it("matches single segment in catch-all", () => {
      const router = createRouter();
      router.addRoute("/files/[...path]", "pages/files/[...path].tsx");

      const match = router.match("/files/readme.txt");
      assertExists(match);
      assertEquals(match.params, { path: ["readme.txt"] });
    });

    it("does not match empty catch-all", () => {
      const router = createRouter();
      router.addRoute("/docs/[...path]", "pages/docs/[...path].tsx");

      assertEquals(router.match("/docs/"), null);
    });
  });

  describe("Optional catch-all routes", () => {
    it("matches optional catch-all with segments", () => {
      const router = createRouter();
      router.addRoute("/app/[[...segments]]", "pages/app/[[...segments]].tsx");

      const match = router.match("/app/dashboard/settings");
      assertExists(match);
      assertEquals(match.params, { segments: ["dashboard", "settings"] });
    });

    it("matches optional catch-all without segments", () => {
      const router = createRouter();
      router.addRoute("/app/[[...segments]]", "pages/app/[[...segments]].tsx");

      const match = router.match("/app");
      assertExists(match);
      assertEquals(match.params, { segments: [] });
    });
  });

  describe("Route priority", () => {
    it("prefers static routes over dynamic", () => {
      const router = createRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");
      router.addRoute("/blog/about", "pages/blog/about.tsx");

      const match = router.match("/blog/about");
      assertExists(match);
      assertEquals(match.route.page, "pages/blog/about.tsx");
    });

    it("prefers dynamic routes over catch-all", () => {
      const router = createRouter();
      router.addRoute("/files/[...path]", "pages/files/[...path].tsx");
      router.addRoute("/files/[type]/[name]", "pages/files/[type]/[name].tsx");

      const match = router.match("/files/images/logo.png");
      assertExists(match);
      assertEquals(match.route.page, "pages/files/[type]/[name].tsx");
      assertEquals(match.params, { type: "images", name: "logo.png" });
    });

    it("prefers longer static paths", () => {
      const router = createRouter();
      router.addRoute("/api", "pages/api/index.tsx");
      router.addRoute("/api/users", "pages/api/users/index.tsx");

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.page, "pages/api/users/index.tsx");
    });
  });

  describe("Edge cases", () => {
    it("handles trailing slashes", () => {
      const router = createRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match1 = router.match("/about");
      const match2 = router.match("/about/");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.route, match2.route);
    });

    it("handles special characters in segments", () => {
      const router = createRouter();
      router.addRoute("/tag/[name]", "pages/tag/[name].tsx");

      const match = router.match("/tag/c++");
      assertExists(match);
      assertEquals(match.params, { name: "c++" });
    });

    it("handles dots in dynamic segments", () => {
      const router = createRouter();
      router.addRoute("/files/[filename]", "pages/files/[filename].tsx");

      const match = router.match("/files/document.pdf");
      assertExists(match);
      assertEquals(match.params, { filename: "document.pdf" });
    });

    it("does not expose mutable cached matches", () => {
      const router = createRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");

      const match1 = router.match("/blog/test");
      assertExists(match1);
      match1.params.slug = "poisoned";
      match1.route.page = "poisoned.tsx";
      const match2 = router.match("/blog/test");

      assertExists(match2);
      assertEquals(match2.params.slug, "test");
      assertEquals(match2.route.page, "pages/blog/[slug].tsx");
    });
  });

  describe("Complex scenarios", () => {
    it("handles multiple routes with shared prefixes", () => {
      const router = createRouter();
      router.addRoute("/products", "pages/products/index.tsx");
      router.addRoute("/products/new", "pages/products/new.tsx");
      router.addRoute("/products/[id]", "pages/products/[id].tsx");
      router.addRoute("/products/[id]/edit", "pages/products/[id]/edit.tsx");

      assertEquals(router.match("/products")?.route.page, "pages/products/index.tsx");
      assertEquals(router.match("/products/new")?.route.page, "pages/products/new.tsx");
      assertEquals(router.match("/products/123")?.params, { id: "123" });
      assertEquals(router.match("/products/123/edit")?.params, { id: "123" });
    });

    it("handles mixed static and dynamic segments", () => {
      const router = createRouter();
      router.addRoute("/api/v1/users/[id]/posts", "pages/api/v1/users/[id]/posts.tsx");

      const match = router.match("/api/v1/users/42/posts");
      assertExists(match);
      assertEquals(match.params, { id: "42" });
    });
  });

  describe("Cache behavior", () => {
    it("caches repeated matches across many routes", () => {
      const router = createRouter();

      for (let i = 0; i < 100; i++) {
        router.addRoute(`/page${i}`, `pages/page${i}.tsx`);
        router.addRoute(`/dynamic${i}/[id]`, `pages/dynamic${i}/[id].tsx`);
      }

      const firstMatch = router.match("/dynamic50/test");
      assertExists(firstMatch);
      assertEquals(firstMatch.route.page, "pages/dynamic50/[id].tsx");
      assertEquals(firstMatch.params, { id: "test" });

      const exposedRoutes = router.routes;
      exposedRoutes.clear();

      const cachedMatch = router.match("/dynamic50/test");
      assertExists(cachedMatch);
      assertEquals(cachedMatch.route.page, "pages/dynamic50/[id].tsx");
      assertEquals(cachedMatch.params, { id: "test" });

      router.clearCache();
      assertExists(router.match("/dynamic50/test"));
    });

    it("returns defensive route snapshots", () => {
      const router = createRouter();
      router.addRoute("/api/[id]", "pages/api/[id].tsx");

      const entries = router.routes;
      const entry = entries.get("/api/[id]");
      assertExists(entry);
      entry.route.page = "poisoned.tsx";
      entry.paramNames[0] = "poisoned";

      const listed = router.listRoutes();
      listed[0]!.page = "also-poisoned.tsx";

      const match = router.match("/api/123");
      assertExists(match);
      assertEquals(match.route.page, "pages/api/[id].tsx");
      assertEquals(match.params, { id: "123" });
    });
  });

  describe("Cache management", () => {
    it("clears all routes and cache with clear()", () => {
      const router = createRouter();
      router.addRoute("/api/users", "pages/api/users.tsx");
      router.addRoute("/api/[id]", "pages/api/[id].tsx");

      router.match("/api/users");
      router.match("/api/123");

      router.clear();

      assertEquals(router.match("/api/users"), null);
      assertEquals(router.match("/api/123"), null);

      router.addRoute("/api/new", "pages/api/new.tsx");
      assertEquals(router.match("/api/new")?.route.page, "pages/api/new.tsx");
    });

    it("clears only cache with clearCache()", () => {
      const router = createRouter();
      router.addRoute("/api/users", "pages/api/users.tsx");

      const match1 = router.match("/api/users");
      assertExists(match1);

      router.clearCache();

      const match2 = router.match("/api/users");
      assertExists(match2);
      assertEquals(match2.route.page, "pages/api/users.tsx");
    });

    it("caches negative results but invalidates them when a route is added", () => {
      const router = createRouter();
      router.addRoute("/api/users", "pages/api/users.tsx");

      // Negative result is cached...
      assertEquals(router.match("/api/posts"), null);

      // ...but adding the matching route must invalidate that cached miss,
      // otherwise late/hot-reloaded routes keep 404ing (the fixed bug).
      router.addRoute("/api/posts", "pages/api/posts.tsx");

      const match2 = router.match("/api/posts");
      assertExists(match2);
      assertEquals(match2.route.page, "pages/api/posts.tsx");
    });
  });

  describe("Additional edge cases", () => {
    it("handles empty parameter values", () => {
      const router = createRouter();
      router.addRoute("/search/[query]/[filter]", "pages/search.tsx");

      assertEquals(router.match("/search//filter"), null);
    });

    it("normalizes trailing slashes in route patterns during registration", () => {
      const router = createRouter();

      router.addRoute("/contact/", "pages/contact.tsx");

      const match1 = router.match("/contact");
      const match2 = router.match("/contact/");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.route.page, "pages/contact.tsx");
      assertEquals(match2.route.page, "pages/contact.tsx");
      assertEquals(match1.route.pattern, "/contact");

      router.addRoute("/", "pages/index.tsx");
      const match3 = router.match("/");
      assertExists(match3);
      assertEquals(match3.route.pattern, "/");
    });

    it("handles optional catch-all with trailing slash", () => {
      const router = createRouter();
      router.addRoute("/docs/[[...path]]", "pages/docs/[[...path]].tsx");

      const match = router.match("/docs/");
      assertExists(match);
      assertEquals(match.params, { path: [] });
    });

    it("correctly decodes complex URL encoded parameters", () => {
      const router = createRouter();
      router.addRoute("/search/[query]", "pages/search/[query].tsx");

      const match1 = router.match("/search/hello%20world%21");
      assertExists(match1);
      assertEquals(match1.params, { query: "hello world!" });

      const match2 = router.match("/search/%3Cscript%3E");
      assertExists(match2);
      assertEquals(match2.params, { query: "<script>" });

      const match3 = router.match("/search/%E2%9C%93");
      assertExists(match3);
      assertEquals(match3.params, { query: "✓" });
    });

    it("splits catch-all segments by slash and decodes each segment", () => {
      const router = createRouter();
      router.addRoute("/files/[...path]", "pages/files/[...path].tsx");

      const match1 = router.match("/files/folder/file.txt");
      assertExists(match1);
      assertEquals(match1.params, { path: ["folder", "file.txt"] });

      const match2 = router.match("/files/my%20folder/file%20name.txt");
      assertExists(match2);
      assertEquals(match2.params, { path: ["my folder", "file name.txt"] });

      const match3 = router.match("/files/folder%2Fwith%2Fslashes/normal");
      assertExists(match3);
      assertEquals(match3.params, { path: ["folder/with/slashes", "normal"] });
    });
  });
});
