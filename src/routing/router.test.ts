import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DynamicRouter } from "./matchers/index.ts";

describe("DynamicRouter", () => {
  describe("Static routes", () => {
    it("matches exact static routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");
      router.addRoute("/contact", "pages/contact.tsx");

      const match = router.match("/about");
      assertExists(match);
      assertEquals(match.route.page, "pages/about.tsx");
      assertEquals(match.params, {});
    });

    it("returns null for non-matching routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match = router.match("/not-found");
      assertEquals(match, null);
    });

    it("normalizes trailing slashes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match1 = router.match("/about");
      const match2 = router.match("/about/");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.route.page, match2.route.page);
    });

    it("handles root route correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/", "pages/index.tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.route.page, "pages/index.tsx");
    });
  });

  describe("Dynamic segments - single parameter", () => {
    it("matches single dynamic segment", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");

      const match = router.match("/blog/hello-world");
      assertExists(match);
      assertEquals(match.params, { slug: "hello-world" });
      assertEquals(match.route.page, "pages/blog/[slug].tsx");
    });

    it("extracts parameter as string not array", () => {
      const router = new DynamicRouter();
      router.addRoute("/user/[id]", "pages/user/[id].tsx");

      const match = router.match("/user/12345");
      assertExists(match);
      assertEquals(typeof match.params.id, "string");
      assertEquals(match.params.id, "12345");
    });

    it("decodes URL encoded parameters", () => {
      const router = new DynamicRouter();
      router.addRoute("/user/[name]", "pages/user/[name].tsx");

      const match = router.match("/user/John%20Doe");
      assertExists(match);
      assertEquals(match.params, { name: "John Doe" });
    });

    it("handles special characters in dynamic segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/tag/[name]", "pages/tag/[name].tsx");

      const match = router.match("/tag/c%2B%2B");
      assertExists(match);
      assertEquals(match.params, { name: "c++" });
    });
  });

  describe("Dynamic segments - multiple parameters", () => {
    it("matches two dynamic segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/shop/[category]/[product]", "pages/shop/[category]/[product].tsx");

      const match = router.match("/shop/electronics/laptop");
      assertExists(match);
      assertEquals(match.params, {
        category: "electronics",
        product: "laptop",
      });
    });

    it("matches three dynamic segments in sequence", () => {
      const router = new DynamicRouter();
      router.addRoute("/posts/[year]/[month]/[day]", "pages/posts/archive.tsx");

      const match = router.match("/posts/2024/03/15");
      assertExists(match);
      assertEquals(match.params, {
        year: "2024",
        month: "03",
        day: "15",
      });
    });

    it("handles mix of static and dynamic segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/v1/users/[userId]/posts/[postId]", "api/user-posts.tsx");

      const match = router.match("/api/v1/users/123/posts/456");
      assertExists(match);
      assertEquals(match.params, {
        userId: "123",
        postId: "456",
      });
    });

    it("preserves parameter order correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/[a]/[b]/[c]", "pages/abc.tsx");

      const match = router.match("/first/second/third");
      assertExists(match);
      assertEquals(match.params, {
        a: "first",
        b: "second",
        c: "third",
      });
    });

    it("fails when segment count does not match", () => {
      const router = new DynamicRouter();
      router.addRoute("/posts/[category]/[id]", "pages/posts.tsx");

      const match = router.match("/posts/tech");
      assertEquals(match, null);
    });
  });

  describe("Catch-all routes", () => {
    it("matches catch-all routes with multiple segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...path]", "pages/docs/[...path].tsx");

      const match = router.match("/docs/api/auth/login");
      assertExists(match);
      assertEquals(match.params, {
        path: ["api", "auth", "login"],
      });
    });

    it("matches catch-all with single segment", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[...path]", "pages/files/[...path].tsx");

      const match = router.match("/files/readme.txt");
      assertExists(match);
      assertEquals(match.params, {
        path: ["readme.txt"],
      });
    });

    it("does not match empty catch-all path", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...path]", "pages/docs/[...path].tsx");

      const match = router.match("/docs");
      assertEquals(match, null);

      const match2 = router.match("/docs/");
      assertEquals(match2, null);
    });

    it("extracts catch-all parameter as array", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...path]", "pages/docs.tsx");

      const match = router.match("/docs/introduction");
      assertExists(match);
      assertEquals(Array.isArray(match.params.path), true);
      assertEquals(match.params.path, ["introduction"]);
    });

    it("handles very deep paths with catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[...path]", "pages/files.tsx");

      const match = router.match("/files/a/b/c/d/e/f/file.txt");
      assertExists(match);
      assertEquals(match.params, {
        path: ["a", "b", "c", "d", "e", "f", "file.txt"],
      });
    });
  });

  describe("Optional catch-all routes", () => {
    it("matches optional catch-all with segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/app/[[...segments]]", "pages/app/[[...segments]].tsx");

      const match = router.match("/app/dashboard/settings");
      assertExists(match);
      assertEquals(match.params, {
        segments: ["dashboard", "settings"],
      });
    });

    it("matches optional catch-all without segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/app/[[...segments]]", "pages/app/[[...segments]].tsx");

      const match = router.match("/app");
      assertExists(match);
      assertEquals(match.params, {
        segments: [],
      });
    });

    it("matches optional catch-all with trailing slash", () => {
      const router = new DynamicRouter();
      router.addRoute("/app/[[...segments]]", "pages/app/[[...segments]].tsx");

      const match = router.match("/app/");
      assertExists(match);
      assertEquals(match.params, {
        segments: [],
      });
    });

    it("matches root path with optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/[[...path]]", "pages/home.tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.params, { path: [] });
    });
  });

  describe("Route specificity and priority", () => {
    it("prefers static routes over dynamic", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");
      router.addRoute("/blog/about", "pages/blog/about.tsx");

      const match = router.match("/blog/about");
      assertExists(match);
      assertEquals(match.route.page, "pages/blog/about.tsx");
    });

    it("prefers dynamic routes over catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[...path]", "pages/files/[...path].tsx");
      router.addRoute("/files/[type]/[name]", "pages/files/[type]/[name].tsx");

      const match = router.match("/files/images/logo.png");
      assertExists(match);
      assertEquals(match.route.page, "pages/files/[type]/[name].tsx");
      assertEquals(match.params, {
        type: "images",
        name: "logo.png",
      });
    });

    it("prefers catch-all over optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[[...path]]", "pages/api/optional.tsx");
      router.addRoute("/api/[...path]", "pages/api/required.tsx");

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.page, "pages/api/required.tsx");
    });

    it("handles complex route priority correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/products/[[...path]]", "optional-catch-all.tsx");
      router.addRoute("/products/new", "static.tsx");
      router.addRoute("/products/[id]", "dynamic.tsx");
      router.addRoute("/products/[...path]", "catch-all.tsx");
      router.addRoute("/products/[id]/edit", "dynamic-edit.tsx");

      assertEquals(router.match("/products/new")?.route.page, "static.tsx");
      assertEquals(router.match("/products/123/edit")?.route.page, "dynamic-edit.tsx");
      assertEquals(router.match("/products/123")?.route.page, "dynamic.tsx");
      assertEquals(router.match("/products/category/subcategory")?.route.page, "catch-all.tsx");
      assertEquals(router.match("/products")?.route.page, "optional-catch-all.tsx");
    });

    it("prioritizes longer static paths", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[version]", "pages/api-version.tsx");
      router.addRoute("/api/v1/users", "pages/users.tsx");

      assertEquals(router.match("/api/v1/users")?.route.page, "pages/users.tsx");
    });
  });

  describe("Cache behavior", () => {
    it("caches successful matches", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");

      const match1 = router.match("/blog/test");
      const match2 = router.match("/blog/test");

      assertEquals(match1 === match2, true);
    });

    it("caches null results", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match1 = router.match("/not-found");
      const match2 = router.match("/not-found");

      assertEquals(match1, null);
      assertEquals(match2, null);
    });

    it("clears cache correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");

      const match1 = router.match("/blog/test");
      router.clearCache();
      const match2 = router.match("/blog/test");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1 !== match2, true);
      assertEquals(match1.params, match2.params);
    });

    it("maintains separate cache entries for different paths", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog.tsx");

      const match1 = router.match("/blog/post1");
      const match2 = router.match("/blog/post2");
      const match3 = router.match("/blog/post1");

      assertExists(match1);
      assertExists(match2);
      assertExists(match3);

      assertEquals(match1 === match3, true);
      assertEquals(match1 === match2, false);
    });
  });

  describe("Edge cases - trailing slashes", () => {
    it("normalizes trailing slashes for non-root paths", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match1 = router.match("/about");
      const match2 = router.match("/about/");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.route.page, match2.route.page);
    });

    it("preserves root path without removing slash", () => {
      const router = new DynamicRouter();
      router.addRoute("/", "pages/index.tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.route.page, "pages/index.tsx");
    });

    it("normalizes trailing slash in dynamic routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog.tsx");

      const match1 = router.match("/blog/hello");
      const match2 = router.match("/blog/hello/");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.params, match2.params);
    });
  });

  describe("Edge cases - URL decoding", () => {
    it("decodes spaces in parameters", () => {
      const router = new DynamicRouter();
      router.addRoute("/article/[title]", "pages/article.tsx");

      const match = router.match("/article/How%20to%20Code");
      assertExists(match);
      assertEquals(match.params.title, "How to Code");
    });

    it("decodes special characters", () => {
      const router = new DynamicRouter();
      router.addRoute("/tag/[name]", "pages/tag.tsx");

      const match1 = router.match("/tag/C%23");
      assertExists(match1);
      assertEquals(match1.params.name, "C#");

      const match2 = router.match("/tag/node%2Ejs");
      assertExists(match2);
      assertEquals(match2.params.name, "node.js");
    });

    it("handles parameters with dots", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[filename]", "pages/files/[filename].tsx");

      const match = router.match("/files/document.v2.final.pdf");
      assertExists(match);
      assertEquals(match.params, { filename: "document.v2.final.pdf" });
    });
  });

  describe("Edge cases - empty parameters", () => {
    it("handles empty parameter in optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/[[...path]]", "pages/[[...path]].tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.params, { path: [] });
    });

    it("returns null for empty path on non-optional routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match = router.match("");
      assertEquals(match, null);
    });

    it("handles empty segments correctly in optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/app/[[...segments]]", "pages/app.tsx");

      const match = router.match("/app");
      assertExists(match);
      assertEquals(match.params.segments, []);
    });
  });

  describe("getRoutes() method", () => {
    it("returns all routes in sorted order", () => {
      const router = new DynamicRouter();
      router.addRoute("/products/[...path]", "catch-all.tsx");
      router.addRoute("/products/new", "static.tsx");
      router.addRoute("/products/[id]", "dynamic.tsx");

      const routes = router.getRoutes();
      assertEquals(routes.length, 3);
      assertEquals(routes[0]?.page, "static.tsx");
      assertEquals(routes[1]?.page, "dynamic.tsx");
      assertEquals(routes[2]?.page, "catch-all.tsx");
    });

    it("returns a copy of routes array", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "about.tsx");

      const routes1 = router.getRoutes();
      const routes2 = router.getRoutes();

      assertEquals(routes1 !== routes2, true);
      assertEquals(routes1.length, routes2.length);
      assertEquals(routes1[0]?.pattern, routes2[0]?.pattern);
    });

    it("returns empty array for router with no routes", () => {
      const router = new DynamicRouter();
      const routes = router.getRoutes();
      assertEquals(routes.length, 0);
    });
  });
});
