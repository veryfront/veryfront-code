import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PageRouteMatcher } from "./pattern-route-matcher.ts";

describe("pattern-route-matcher", () => {
  describe("PageRouteMatcher", () => {
    it("should add and match static routes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/about");
      assertEquals(match?.route.pattern, "/about");
    });

    it("should match dynamic routes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/users/[id]", "user.tsx");

      const match = router.match("/users/123");
      assertEquals(match?.params.id, "123");
    });

    it("should prioritize static over dynamic routes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/users/[id]", "user-dynamic.tsx");
      router.addRoute("/users/profile", "profile.tsx");

      const match = router.match("/users/profile");
      assertEquals(match?.route.page, "profile.tsx");
    });

    it("should prioritize dynamic over catch-all routes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/docs/[...slug]", "docs-catch.tsx");
      router.addRoute("/docs/[id]", "docs-single.tsx");

      const match = router.match("/docs/intro");
      assertEquals(match?.route.page, "docs-single.tsx");
    });

    it("should not expose mutable cached matches", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/users/[id]", "user.tsx");

      const match1 = router.match("/users/123");
      if (!match1) throw new Error("expected route match");
      match1.params.id = "poisoned";
      match1.route.page = "poisoned.tsx";
      const match2 = router.match("/users/123");

      assertEquals(match2?.params.id, "123");
      assertEquals(match2?.route.page, "user.tsx");
    });

    it("should clear cache", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/test", "test.tsx");

      router.match("/test");
      router.clearCache();

      const match = router.match("/test");
      assertEquals(match !== null, true);
    });

    it("should return null for unmatched routes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/unknown");
      assertEquals(match, null);
    });

    it("should handle multiple dynamic params", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/blog/[year]/[month]", "archive.tsx");

      const match = router.match("/blog/2024/03");
      assertEquals(match?.params.year, "2024");
      assertEquals(match?.params.month, "03");
    });

    it("should get all routes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/a", "a.tsx");
      router.addRoute("/b", "b.tsx");

      const routes = router.getRoutes();
      assertEquals(routes.length, 2);
      routes[0]!.page = "poisoned.tsx";
      assertEquals(router.getRoutes().some((route) => route.page === "poisoned.tsx"), false);
    });

    it("should normalize trailing slashes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/about/");
      assertEquals(match !== null, true);
    });
  });
});
