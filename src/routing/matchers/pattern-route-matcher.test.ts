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

    it("uses lexicographic specificity instead of route length", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/[section]/edit", "generic-edit.tsx");
      router.addRoute("/docs/[page]", "docs-page.tsx");

      assertEquals(router.match("/docs/edit")?.route.page, "docs-page.tsx");
    });

    it("prefers a static suffix after an empty optional catch-all", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/docs/[page]", "dynamic.tsx");
      router.addRoute("/docs/[[...parts]]/edit", "optional-suffix.tsx");

      assertEquals(router.match("/docs/edit")?.route.page, "optional-suffix.tsx");
    });

    it("returns null for equal-shape ambiguity regardless of registration order", () => {
      for (const patterns of [["/[id]", "/[slug]"], ["/[slug]", "/[id]"]]) {
        const router = new PageRouteMatcher();
        for (const pattern of patterns) router.addRoute(pattern, `${pattern}.tsx`);

        assertEquals(router.match("/value"), null);
      }
    });

    it("replaces an identical pattern registration without creating ambiguity", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/users/[id]", "first.tsx");

      assertEquals(router.match("/users/42")?.route.page, "first.tsx");

      router.addRoute("/users/[id]", "replacement.tsx");

      assertEquals(router.getRoutes().length, 1);
      assertEquals(router.match("/users/42")?.route.page, "replacement.tsx");
    });

    it("preserves ordering after eighteen route segments", () => {
      const prefix = Array.from({ length: 18 }, (_, index) => `[part${index}]`);
      const slug = `/${[...new Array(18).fill("value"), "fixed"].join("/")}`;
      const router = new PageRouteMatcher();
      router.addRoute(`/${[...prefix, "[tail]"].join("/")}`, "dynamic-tail.tsx");
      router.addRoute(`/${[...prefix, "fixed"].join("/")}`, "static-tail.tsx");

      assertEquals(router.match(slug)?.route.page, "static-tail.tsx");
    });

    it("should cache route matches", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/about", "about.tsx");

      const match1 = router.match("/about");
      const match2 = router.match("/about");

      assertEquals(match1, match2);
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
    });

    it("should normalize trailing slashes", () => {
      const router = new PageRouteMatcher();
      router.addRoute("/about", "about.tsx");

      const match = router.match("/about/");
      assertEquals(match !== null, true);
    });
  });
});
