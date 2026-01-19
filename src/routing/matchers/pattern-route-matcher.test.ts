import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { DynamicRouter } from "./pattern-route-matcher.ts";

describe("pattern-route-matcher", () => {
  describe("DynamicRouter", () => {
    it("should add and match static routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/about");
      assertEquals(match !== null, true);
      assertEquals(match?.route.pattern, "/about");
    });

    it("should match dynamic routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/users/[id]", "user.tsx");

      const match = router.match("/users/123");
      assertEquals(match !== null, true);
      assertEquals(match?.params["id"], "123");
    });

    it("should prioritize static over dynamic routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/users/[id]", "user-dynamic.tsx");
      router.addRoute("/users/profile", "profile.tsx");

      const match = router.match("/users/profile");
      assertEquals(match?.route.page, "profile.tsx");
    });

    it("should prioritize dynamic over catch-all routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/docs/[...slug]", "docs-catch.tsx");
      router.addRoute("/docs/[id]", "docs-single.tsx");

      const match = router.match("/docs/intro");
      assertEquals(match?.route.page, "docs-single.tsx");
    });

    it("should cache route matches", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "about.tsx");

      // First match
      const match1 = router.match("/about");
      // Second match should be cached
      const match2 = router.match("/about");

      assertEquals(match1, match2);
    });

    it("should clear cache", () => {
      const router = new DynamicRouter();
      router.addRoute("/test", "test.tsx");

      router.match("/test"); // Populate cache
      router.clearCache();

      // Should still work after cache clear
      const match = router.match("/test");
      assertEquals(match !== null, true);
    });

    it("should return null for unmatched routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/unknown");
      assertEquals(match, null);
    });

    it("should handle multiple dynamic params", () => {
      const router = new DynamicRouter();
      router.addRoute("/blog/[year]/[month]", "archive.tsx");

      const match = router.match("/blog/2024/03");
      assertEquals(match?.params["year"], "2024");
      assertEquals(match?.params["month"], "03");
    });

    it("should get all routes", () => {
      const router = new DynamicRouter();
      router.addRoute("/a", "a.tsx");
      router.addRoute("/b", "b.tsx");

      const routes = router.getRoutes();
      assertEquals(routes.length, 2);
    });

    it("should normalize trailing slashes", () => {
      const router = new DynamicRouter();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/about/");
      assertEquals(match !== null, true);
    });
  });
});
