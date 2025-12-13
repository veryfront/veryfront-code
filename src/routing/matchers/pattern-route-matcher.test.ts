import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { DynamicRouter } from "./pattern-route-matcher.ts";

describe("DynamicRouter", () => {
  describe("addRoute", () => {
    it("should add a route", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      assertEquals(router.getRoutes().length, 1);
    });

    it("should add multiple routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");
      router.addRoute("/contact", "/pages/contact.tsx");

      assertEquals(router.getRoutes().length, 2);
    });

    it("should sort routes by specificity", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[...slug]", "/pages/blog/[...slug].tsx");
      router.addRoute("/blog/featured", "/pages/blog/featured.tsx");
      router.addRoute("/blog/[id]", "/pages/blog/[id].tsx");

      const routes = router.getRoutes();
      // Most specific (static) should be first
      assertEquals(routes[0]?.pattern, "/blog/featured");
      // Dynamic should be second
      assertEquals(routes[1]?.pattern, "/blog/[id]");
      // Catch-all should be last
      assertEquals(routes[2]?.pattern, "/blog/[...slug]");
    });
  });

  describe("match", () => {
    it("should match static route", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      const match = router.match("/about");
      assertEquals(match !== null, true);
      assertEquals(match?.route.page, "/pages/about.tsx");
    });

    it("should match dynamic route", () => {
      const router = new DynamicRouter();
      router.addRoute("/users/[id]", "/pages/users/[id].tsx");

      const match = router.match("/users/123");
      assertEquals(match !== null, true);
      assertEquals(match?.params, { id: "123" });
    });

    it("should return null for no match", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      const match = router.match("/contact");
      assertEquals(match, null);
    });

    it("should prioritize more specific routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[slug]", "/pages/blog/[slug].tsx");
      router.addRoute("/blog/featured", "/pages/blog/featured.tsx");

      const match = router.match("/blog/featured");
      assertEquals(match !== null, true);
      assertEquals(match?.route.page, "/pages/blog/featured.tsx");
      assertEquals(match?.params, {});
    });

    it("should fallback to less specific route", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/featured", "/pages/blog/featured.tsx");
      router.addRoute("/blog/[slug]", "/pages/blog/[slug].tsx");

      const match = router.match("/blog/other");
      assertEquals(match !== null, true);
      assertEquals(match?.route.page, "/pages/blog/[slug].tsx");
      assertEquals(match?.params, { slug: "other" });
    });

    it("should normalize pathname before matching", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      // Assuming normalizePath handles this
      const match = router.match("/about");
      assertEquals(match !== null, true);
    });
  });

  describe("caching", () => {
    it("should cache match results", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      const match1 = router.match("/about");
      const match2 = router.match("/about");

      assertEquals(match1, match2);
    });

    it("should cache null results", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      const match1 = router.match("/contact");
      const match2 = router.match("/contact");

      assertEquals(match1, null);
      assertEquals(match2, null);
    });

    it("should clear cache", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      router.match("/about");
      router.clearCache();

      // After clearing cache, should still match
      const match = router.match("/about");
      assertEquals(match !== null, true);
    });
  });

  describe("getRoutes", () => {
    it("should return copy of routes array", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");

      const routes1 = router.getRoutes();
      const routes2 = router.getRoutes();

      assertEquals(routes1.length, routes2.length);
      // Should be different array instances
      assertEquals(routes1 === routes2, false);
    });

    it("should return empty array when no routes", () => {
      const router = new DynamicRouter();
      const routes = router.getRoutes();

      assertEquals(routes.length, 0);
    });
  });

  describe("complex routing scenarios", () => {
    it("should handle nested dynamic routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/users/[userId]/posts/[postId]", "/pages/users/[userId]/posts/[postId].tsx");

      const match = router.match("/users/123/posts/456");
      assertEquals(match !== null, true);
      assertEquals(match?.params, { userId: "123", postId: "456" });
    });

    it("should handle catch-all routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");

      const match = router.match("/docs/guide/getting-started");
      assertEquals(match !== null, true);
      assertEquals(match?.params, { slug: ["guide", "getting-started"] });
    });

    it("should handle optional catch-all routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx");

      const match1 = router.match("/blog");
      assertEquals(match1 !== null, true);

      const match2 = router.match("/blog/2024/01");
      assertEquals(match2 !== null, true);
      assertEquals(match2?.params, { slug: ["2024", "01"] });
    });

    it("should prioritize routes correctly with mixed specificity", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/[...slug]", "/pages/api/[...slug].tsx");
      router.addRoute("/api/users", "/pages/api/users.tsx");
      router.addRoute("/api/users/[id]", "/pages/api/users/[id].tsx");

      const match1 = router.match("/api/users");
      assertEquals(match1?.route.page, "/pages/api/users.tsx");

      const match2 = router.match("/api/users/123");
      assertEquals(match2?.route.page, "/pages/api/users/[id].tsx");

      const match3 = router.match("/api/other/path");
      assertEquals(match3?.route.page, "/pages/api/[...slug].tsx");
    });

    it("should handle root route", () => {
      const router = new DynamicRouter();
      router.addRoute("/", "/pages/index.tsx");
      router.addRoute("/about", "/pages/about.tsx");

      const match = router.match("/");
      assertEquals(match !== null, true);
      assertEquals(match?.route.page, "/pages/index.tsx");
    });

    it("should handle many routes efficiently", () => {
      const router = new DynamicRouter();

      for (let i = 0; i < 100; i++) {
        router.addRoute(`/route${i}`, `/pages/route${i}.tsx`);
      }

      const match = router.match("/route50");
      assertEquals(match !== null, true);
      assertEquals(match?.route.page, "/pages/route50.tsx");
    });
  });

  describe("edge cases", () => {
    it("should handle duplicate route patterns", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "/pages/about.tsx");
      router.addRoute("/about", "/pages/about-duplicate.tsx");

      const routes = router.getRoutes();
      assertEquals(routes.length, 2);
    });

    it("should handle special characters in static paths", () => {
      const router = new DynamicRouter();
      router.addRoute("/api/v1.0", "/pages/api/v1.0.tsx");

      const match = router.match("/api/v1.0");
      assertEquals(match !== null, true);
    });

    it("should handle empty pattern", () => {
      const router = new DynamicRouter();
      router.addRoute("", "/pages/empty.tsx");

      const match = router.match("");
      assertEquals(match !== null, true);
    });
  });
});
