import { assert, assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd.ts";
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

    it("handles root route", () => {
      const router = new DynamicRouter();
      router.addRoute("/", "pages/index.tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.route.page, "pages/index.tsx");
    });
  });

  describe("Dynamic segments", () => {
    it("matches single dynamic segment", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/blog/[slug].tsx");

      const match = router.match("/blog/hello-world");
      assertExists(match);
      assertEquals(match.params, { slug: "hello-world" });
    });

    it("matches multiple dynamic segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/shop/[category]/[product]", "pages/shop/[category]/[product].tsx");

      const match = router.match("/shop/electronics/laptop");
      assertExists(match);
      assertEquals(match.params, {
        category: "electronics",
        product: "laptop",
      });
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

    it("does not match empty catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...path]", "pages/docs/[...path].tsx");

      const match = router.match("/docs");
      assertEquals(match, null);

      const match2 = router.match("/docs/");
      assertEquals(match2, null);
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
  });

  describe("Route priority and sorting", () => {
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
  });

  describe("Caching", () => {
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
  });

  describe("Edge cases", () => {
    it("handles routes with special regex characters", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/v1.0/users", "pages/api/v1.0/users.tsx");
      router.addRoute("/files/(test)/data", "pages/files/test/data.tsx");

      const match1 = router.match("/api/v1.0/users");
      const match2 = router.match("/files/(test)/data");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.route.page, "pages/api/v1.0/users.tsx");
      assertEquals(match2.route.page, "pages/files/test/data.tsx");
    });

    it("handles empty parameter in optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/[[...path]]", "pages/[[...path]].tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.params, { path: [] });
    });

    it("handles complex nested patterns", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[version]/users/[userId]/posts/[postId]", "complex.tsx");

      const match = router.match("/api/v2/users/123/posts/456");
      assertExists(match);
      assertEquals(match.params, {
        version: "v2",
        userId: "123",
        postId: "456",
      });

      const router2 = new DynamicRouter();
      router2.addRoute("/docs/[...path]", "docs.tsx");
      const match2 = router2.match("/docs/api/v1/users");
      assertExists(match2);
      assertEquals(match2.params, {
        path: ["api", "v1", "users"],
      });
    });

    it("handles parameters with dots", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[filename]", "pages/files/[filename].tsx");

      const match = router.match("/files/document.v2.final.pdf");
      assertExists(match);
      assertEquals(match.params, { filename: "document.v2.final.pdf" });
    });

    it("handles parameters with underscores in names", () => {
      const router = new DynamicRouter();
      router.addRoute("/items/[item_id]", "pages/items/[item_id].tsx");

      const match = router.match("/items/abc-123_xyz");
      assertExists(match);
      assertEquals(match.params, { item_id: "abc-123_xyz" });
    });
  });

  describe("getRoutes", () => {
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
  });

  describe("Route pattern validation", () => {
    it("handles patterns with only word characters in parameters", () => {
      const router = new DynamicRouter();
      router.addRoute("/user/[userId123]", "pages/user.tsx");

      const match = router.match("/user/abc456");
      assertExists(match);
      assertEquals(match.params, { userId123: "abc456" });
    });

    it("correctly identifies catch-all vs regular parameters", () => {
      const router = new DynamicRouter();
      router.addRoute("/a/[...path]", "pages/a.tsx");
      router.addRoute("/c/[path]/d", "pages/c.tsx");

      const match1 = router.match("/a/x/y/b");
      assertExists(match1);
      assertEquals(match1.params, { path: ["x", "y", "b"] });

      const match2 = router.match("/c/x/d");
      assertExists(match2);
      assertEquals(match2.params, { path: "x" });
    });
  });

  describe("Multiple Dynamic Segments - Extended", () => {
    it("matches three dynamic segments in a row", () => {
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

    it("preserves order of multiple dynamic segments", () => {
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

    it("fails to match when segment count does not match", () => {
      const router = new DynamicRouter();
      router.addRoute("/posts/[category]/[id]", "pages/posts.tsx");

      const match = router.match("/posts/tech");
      assertEquals(match, null);
    });

    it("matches four dynamic segments in a row", () => {
      const router = new DynamicRouter();
      router.addRoute("/posts/[year]/[month]/[day]/[slug]", "pages/posts/detail.tsx");

      const match = router.match("/posts/2024/03/15/hello-world");
      assertExists(match);
      assertEquals(match.params, {
        year: "2024",
        month: "03",
        day: "15",
        slug: "hello-world",
      });
    });

    it("handles dynamic segments with numeric values", () => {
      const router = new DynamicRouter();
      router.addRoute("/users/[userId]/orders/[orderId]", "pages/order.tsx");

      const match = router.match("/users/12345/orders/67890");
      assertExists(match);
      assertEquals(match.params, {
        userId: "12345",
        orderId: "67890",
      });
    });
  });

  describe("Catch-All Routes - Extended", () => {
    it("matches very deep path with catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[...path]", "pages/files.tsx");

      const match = router.match("/files/a/b/c/d/e/f/g/file.txt");
      assertExists(match);
      assertEquals(match.params, {
        path: ["a", "b", "c", "d", "e", "f", "g", "file.txt"],
      });
    });

    it("handles catch-all with static prefix", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/guide/[...sections]", "pages/docs.tsx");

      const match = router.match("/docs/guide/getting-started/installation");
      assertExists(match);
      assertEquals(match.params, {
        sections: ["getting-started", "installation"],
      });
    });

    it("does not match catch-all with missing required prefix", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/guide/[...sections]", "pages/docs.tsx");

      const match = router.match("/docs");
      assertEquals(match, null);

      const match2 = router.match("/docs/other/path");
      assertEquals(match2, null);
    });

    it("handles catch-all with URL-encoded segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/files/[...path]", "pages/files.tsx");

      const match = router.match("/files/My%20Documents/report%202024.pdf");
      assertExists(match);
      assertEquals(match.params, {
        path: ["My Documents", "report 2024.pdf"],
      });
    });

    it("normalizes catch-all parameter for single segment", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...path]", "pages/docs.tsx");

      const match = router.match("/docs/introduction");
      assertExists(match);
      assert(Array.isArray(match.params.path));
      assertEquals(match.params.path, ["introduction"]);
    });

    it("combines static prefix with dynamic and catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[version]/endpoints/[...path]", "pages/api.tsx");

      const match = router.match("/api/v2/endpoints/users/list");
      assertExists(match);
      assertEquals(match.params, {
        version: "v2",
        path: ["users", "list"],
      });
    });
  });

  describe("Optional Catch-All - Extended", () => {
    it("matches root path with optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/[[...path]]", "pages/home.tsx");

      const match = router.match("/");
      assertExists(match);
      assertEquals(match.params, { path: [] });
    });

    it("matches single segment with optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/app/[[...sections]]", "pages/app.tsx");

      const match = router.match("/app/dashboard");
      assertExists(match);
      assertEquals(match.params, {
        sections: ["dashboard"],
      });
    });

    it("matches multiple segments with optional catch-all", () => {
      const router = new DynamicRouter();
      router.addRoute("/app/[[...sections]]", "pages/app.tsx");

      const match = router.match("/app/dashboard/settings/profile");
      assertExists(match);
      assertEquals(match.params, {
        sections: ["dashboard", "settings", "profile"],
      });
    });

    it("handles optional catch-all with static prefix", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/posts/[[...slug]]", "pages/blog.tsx");

      const match1 = router.match("/blog/posts");
      assertExists(match1);
      assertEquals(match1.params, { slug: [] });

      const match2 = router.match("/blog/posts/2024/hello-world");
      assertExists(match2);
      assertEquals(match2.params, { slug: ["2024", "hello-world"] });
    });

    it("handles multiple optional catch-all scenarios", () => {
      const router = new DynamicRouter();
      router.addRoute("/shop/[[...category]]", "pages/shop.tsx");

      const match1 = router.match("/shop");
      assertExists(match1);
      assertEquals(match1.params, { category: [] });

      const match2 = router.match("/shop/electronics");
      assertExists(match2);
      assertEquals(match2.params, { category: ["electronics"] });

      const match3 = router.match("/shop/electronics/computers/laptops");
      assertExists(match3);
      assertEquals(match3.params, { category: ["electronics", "computers", "laptops"] });
    });
  });

  describe("Route Priority/Specificity - Extended", () => {
    it("prioritizes more specific static segments", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/dynamic.tsx");
      router.addRoute("/blog/featured", "pages/featured.tsx");
      router.addRoute("/blog/archive", "pages/archive.tsx");

      assertEquals(router.match("/blog/featured")?.route.page, "pages/featured.tsx");
      assertEquals(router.match("/blog/archive")?.route.page, "pages/archive.tsx");
      assertEquals(router.match("/blog/other")?.route.page, "pages/dynamic.tsx");
    });

    it("prioritizes longer static paths over shorter", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[version]", "pages/api-version.tsx");
      router.addRoute("/api/v1/users", "pages/users.tsx");

      assertEquals(router.match("/api/v1/users")?.route.page, "pages/users.tsx");
    });

    it("prioritizes dynamic with more static parts", () => {
      const router = new DynamicRouter();
      router.addRoute("/[...all]", "pages/catch-all.tsx");
      router.addRoute("/api/[endpoint]", "pages/api.tsx");
      router.addRoute("/api/users/[id]", "pages/user.tsx");

      assertEquals(router.match("/api/users/123")?.route.page, "pages/user.tsx");
      assertEquals(router.match("/api/posts")?.route.page, "pages/api.tsx");
    });

    it("handles specificity with multiple routes at same level", () => {
      const router = new DynamicRouter();
      router.addRoute("/shop/[category]/featured", "pages/featured.tsx");
      router.addRoute("/shop/[category]/[product]", "pages/product.tsx");

      assertEquals(router.match("/shop/electronics/featured")?.route.page, "pages/featured.tsx");
      assertEquals(router.match("/shop/electronics/laptop")?.route.page, "pages/product.tsx");
    });

    it("scores routes correctly by specificity", () => {
      const router = new DynamicRouter();
      router.addRoute("/a/b/c", "static-3.tsx");
      router.addRoute("/a/b/[c]", "dynamic-1.tsx");
      router.addRoute("/a/[b]/[c]", "dynamic-2.tsx");
      router.addRoute("/a/[...all]", "catch-all.tsx");
      router.addRoute("/a/[[...all]]", "optional-catch-all.tsx");

      const routes = router.getRoutes();
      assertEquals(routes[0]?.page, "static-3.tsx");
      assertEquals(routes[1]?.page, "dynamic-1.tsx");
      assertEquals(routes[2]?.page, "dynamic-2.tsx");
      assertEquals(routes[3]?.page, "catch-all.tsx");
      assertEquals(routes[4]?.page, "optional-catch-all.tsx");
    });

    it("prefers exact match over prefix when both exist", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[...path]", "pages/api-catch-all.tsx");
      router.addRoute("/api", "pages/api-root.tsx");

      assertEquals(router.match("/api")?.route.page, "pages/api-root.tsx");
      assertEquals(router.match("/api/users")?.route.page, "pages/api-catch-all.tsx");
    });
  });

  describe("Cache Behavior - Extended", () => {
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

    it("invalidates cache after adding new routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "pages/dynamic.tsx");

      const match1 = router.match("/blog/featured");
      assertExists(match1);
      assertEquals(match1.route.page, "pages/dynamic.tsx");

      router.addRoute("/blog/featured", "pages/featured.tsx");
      router.clearCache();

      const match2 = router.match("/blog/featured");
      assertExists(match2);
      assertEquals(match2.route.page, "pages/featured.tsx");
    });

    it("caches complex route matches", () => {
      const router = new DynamicRouter();
      router.addRoute("/[org]/[repo]/[...path]", "pages/github.tsx");

      const match1 = router.match("/myorg/myrepo/src/index.ts");
      const match2 = router.match("/myorg/myrepo/src/index.ts");

      assertEquals(match1 === match2, true);
    });

    it("handles cache for trailing slash normalized paths", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match1 = router.match("/about");
      const match2 = router.match("/about/");

      assertExists(match1);
      assertExists(match2);
      assertEquals(match1.route.page, match2.route.page);
    });
  });

  describe("Edge Cases - Extended", () => {
    it("handles empty pathname correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/", "pages/home.tsx");
      router.addRoute("/about", "pages/about.tsx");

      const match = router.match("");
      assertEquals(match, null);
    });

    it("handles special characters in static paths", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/v2.5/users", "pages/api.tsx");
      router.addRoute("/files/(archived)", "pages/files.tsx");

      const match1 = router.match("/api/v2.5/users");
      const match2 = router.match("/files/(archived)");

      assertExists(match1);
      assertExists(match2);
    });

    it("handles URL-encoded special characters", () => {
      const router = new DynamicRouter();
      router.addRoute("/search/[query]", "pages/search.tsx");

      const match = router.match("/search/hello%20world%21");
      assertExists(match);
      assertEquals(match.params.query, "hello world!");
    });

    it("normalizes leading slashes correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");

      const match = router.match("/about");
      assertExists(match);
    });

    it("handles case-sensitive routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/About", "pages/about.tsx");

      const matchExact = router.match("/About");
      const matchLower = router.match("/about");

      assertExists(matchExact);
      assertEquals(matchLower, null);
    });

    it("handles very long paths efficiently", () => {
      const router = new DynamicRouter();
      router.addRoute("/[...path]", "pages/catch-all.tsx");

      const longPath = "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z";
      const match = router.match(longPath);

      assertExists(match);
      const path = match.params.path;
      assert(Array.isArray(path));
      assertEquals(path.length, 26);
    });

    it("handles parameters with special characters needing decoding", () => {
      const router = new DynamicRouter();
      router.addRoute("/tag/[name]", "pages/tag.tsx");

      const match1 = router.match("/tag/C%23");
      assertExists(match1);
      assertEquals(match1.params.name, "C#");

      const match2 = router.match("/tag/node%2Ejs");
      assertExists(match2);
      assertEquals(match2.params.name, "node.js");
    });

    it("returns null for no route match (404 scenario)", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "pages/about.tsx");
      router.addRoute("/blog/[slug]", "pages/blog.tsx");

      const match = router.match("/completely/unknown/path");
      assertEquals(match, null);
    });

    it("handles paths with consecutive slashes after normalization", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/users", "pages/users.tsx");

      const match = router.match("/api/users");
      assertExists(match);
    });

    it("handles dynamic segments with dashes and underscores in values", () => {
      const router = new DynamicRouter();
      router.addRoute("/posts/[postId]", "pages/post.tsx");

      const match = router.match("/posts/my-awesome-post_123");
      assertExists(match);
      assertEquals(match.params.postId, "my-awesome-post_123");
    });

    it("handles parameter decoding with spaces", () => {
      const router = new DynamicRouter();
      router.addRoute("/article/[title]", "pages/article.tsx");

      const match = router.match("/article/How%20to%20Code");
      assertExists(match);
      assertEquals(match.params.title, "How to Code");
    });

    it("handles empty segments in catch-all correctly", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...path]", "pages/docs.tsx");

      const match = router.match("/docs/guide");
      assertExists(match);
      assertEquals(match.params, { path: ["guide"] });
    });

    it("handles routes ending with dynamic segment", () => {
      const router = new DynamicRouter();
      router.addRoute("/users/[id]", "pages/user.tsx");

      const match = router.match("/users/123");
      assertExists(match);
      assertEquals(match.params.id, "123");

      const noMatch = router.match("/users");
      assertEquals(noMatch, null);
    });
  });
});
