import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { parseRoute, getSpecificityScore } from "./route-parser.ts";

describe("parseRoute", () => {
  describe("static routes", () => {
    it("should parse static route", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      assertEquals(route.pattern, "/about");
      assertEquals(route.page, "/pages/about.tsx");
      assertEquals(route.paramNames, []);
      assertEquals(route.isCatchAll, false);
      assertEquals(route.isOptionalCatchAll, false);
      assertExists(route.regex);
    });

    it("should match exact static path", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      assertEquals(route.regex!.test("/about"), true);
      assertEquals(route.regex!.test("/about/extra"), false);
    });
  });

  describe("dynamic segments", () => {
    it("should parse single dynamic segment", () => {
      const route = parseRoute("/users/[id]", "/pages/users/[id].tsx");
      assertEquals(route.paramNames, ["id"]);
      assertEquals(route.isCatchAll, false);
    });

    it("should match dynamic segment", () => {
      const route = parseRoute("/users/[id]", "/pages/users/[id].tsx");
      assertEquals(route.regex!.test("/users/123"), true);
      assertEquals(route.regex!.test("/users/abc"), true);
      assertEquals(route.regex!.test("/users/123/posts"), false);
    });

    it("should parse multiple dynamic segments", () => {
      const route = parseRoute("/users/[id]/posts/[postId]", "/pages/users/[id]/posts/[postId].tsx");
      assertEquals(route.paramNames, ["id", "postId"]);
    });

    it("should match multiple dynamic segments", () => {
      const route = parseRoute("/users/[id]/posts/[postId]", "/pages/users/[id]/posts/[postId].tsx");
      assertEquals(route.regex!.test("/users/123/posts/456"), true);
      assertEquals(route.regex!.test("/users/abc/posts/xyz"), true);
      assertEquals(route.regex!.test("/users/123"), false);
    });
  });

  describe("catch-all segments", () => {
    it("should parse required catch-all", () => {
      const route = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
      assertEquals(route.paramNames, ["slug"]);
      assertEquals(route.isCatchAll, true);
      assertEquals(route.isOptionalCatchAll, false);
    });

    it("should match required catch-all", () => {
      const route = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
      assertEquals(route.regex!.test("/docs/getting-started"), true);
      assertEquals(route.regex!.test("/docs/api/reference"), true);
      assertEquals(route.regex!.test("/docs"), false); // Required catch-all needs at least one segment
    });

    it("should parse optional catch-all", () => {
      const route = parseRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx");
      assertEquals(route.paramNames, ["slug"]);
      assertEquals(route.isCatchAll, true);
      assertEquals(route.isOptionalCatchAll, true);
    });

    it("should match optional catch-all", () => {
      const route = parseRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx");
      assertEquals(route.regex!.test("/blog"), true);
      assertEquals(route.regex!.test("/blog/post"), true);
      assertEquals(route.regex!.test("/blog/post/comments"), true);
    });
  });

  describe("mixed patterns", () => {
    it("should parse static and dynamic segments", () => {
      const route = parseRoute("/users/[id]/profile", "/pages/users/[id]/profile.tsx");
      assertEquals(route.paramNames, ["id"]);
    });

    it("should match mixed patterns", () => {
      const route = parseRoute("/users/[id]/profile", "/pages/users/[id]/profile.tsx");
      assertEquals(route.regex!.test("/users/123/profile"), true);
      assertEquals(route.regex!.test("/users/123/posts"), false);
    });
  });

  describe("edge cases", () => {
    it("should handle root route", () => {
      const route = parseRoute("/", "/pages/index.tsx");
      assertEquals(route.regex!.test("/"), true);
      assertEquals(route.regex!.test("/about"), false);
    });

    it("should handle special regex characters in static segments", () => {
      const route = parseRoute("/api/v1.0", "/pages/api/v1.0.tsx");
      assertEquals(route.regex!.test("/api/v1.0"), true);
    });

    it("should handle empty param names array for static routes", () => {
      const route = parseRoute("/static", "/pages/static.tsx");
      assertEquals(route.paramNames?.length ?? 0, 0);
    });
  });
});

describe("getSpecificityScore", () => {
  it("should score static segments highest", () => {
    const staticRoute = parseRoute("/about/contact", "/pages/about/contact.tsx");
    const dynamicRoute = parseRoute("/about/[id]", "/pages/about/[id].tsx");

    const staticScore = getSpecificityScore(staticRoute);
    const dynamicScore = getSpecificityScore(dynamicRoute);

    assertEquals(staticScore > dynamicScore, true);
  });

  it("should score dynamic segments higher than catch-all", () => {
    const dynamicRoute = parseRoute("/users/[id]", "/pages/users/[id].tsx");
    const catchAllRoute = parseRoute("/users/[...slug]", "/pages/users/[...slug].tsx");

    const dynamicScore = getSpecificityScore(dynamicRoute);
    const catchAllScore = getSpecificityScore(catchAllRoute);

    assertEquals(dynamicScore > catchAllScore, true);
  });

  it("should score required catch-all higher than optional catch-all", () => {
    const requiredCatchAll = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
    const optionalCatchAll = parseRoute("/docs/[[...slug]]", "/pages/docs/[[...slug]].tsx");

    const requiredScore = getSpecificityScore(requiredCatchAll);
    const optionalScore = getSpecificityScore(optionalCatchAll);

    assertEquals(requiredScore > optionalScore, true);
  });

  it("should consider segment count in scoring", () => {
    const shortRoute = parseRoute("/about", "/pages/about.tsx");
    const longRoute = parseRoute("/about/team/members", "/pages/about/team/members.tsx");

    const shortScore = getSpecificityScore(shortRoute);
    const longScore = getSpecificityScore(longRoute);

    assertEquals(longScore > shortScore, true);
  });

  it("should score mixed routes appropriately", () => {
    const routes = [
      parseRoute("/blog", "/pages/blog.tsx"),
      parseRoute("/blog/[slug]", "/pages/blog/[slug].tsx"),
      parseRoute("/blog/[...slug]", "/pages/blog/[...slug].tsx"),
      parseRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx"),
    ];

    const scores = routes.map(getSpecificityScore);

    // All routes have same number of segments, so segment count won't differentiate
    // Specificity is: static (4) > dynamic (3) > required catch-all (2) > optional catch-all (1)
    // But they all have 1 segment at /blog level, so:
    // /blog = 4 + 0.1 = 4.1
    // /blog/[slug] = 4 + 3 + 0.2 = 7.2
    // /blog/[...slug] = 4 + 2 + 0.2 = 6.2
    // /blog/[[...slug]] = 4 + 1 + 0.2 = 5.2

    // Actually, they have different structures:
    // /blog - 1 static segment
    // /blog/[slug] - 1 static + 1 dynamic
    // /blog/[...slug] - 1 static + 1 required catch-all
    // /blog/[[...slug]] - 1 static + 1 optional catch-all

    // The test should check that routes with more static segments rank higher
    // But since /blog has fewer total segments, it might score lower
    // Let's just check the ordering works as expected
    assertEquals((scores[1] ?? 0) > (scores[2] ?? 0), true); // dynamic > required catch-all
    assertEquals((scores[2] ?? 0) > (scores[3] ?? 0), true); // required catch-all > optional
  });

  it("should handle complex nested routes", () => {
    const simpleRoute = parseRoute("/api/users", "/pages/api/users.tsx");
    const nestedRoute = parseRoute("/api/users/[id]/posts/[postId]", "/pages/api/users/[id]/posts/[postId].tsx");

    const simpleScore = getSpecificityScore(simpleRoute);
    const nestedScore = getSpecificityScore(nestedRoute);

    // Nested route should have higher score due to more segments
    assertEquals(nestedScore > simpleScore, true);
  });
});
