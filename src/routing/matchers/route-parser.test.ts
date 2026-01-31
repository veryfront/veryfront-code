import { assertEquals, assertGreater } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSpecificityScore, parseRoute } from "./route-parser.ts";

describe("route-parser", () => {
  describe("parseRoute", () => {
    it("should parse static route", () => {
      const route = parseRoute("/about", "about.tsx");
      assertEquals(route.pattern, "/about");
      assertEquals(route.page, "about.tsx");
      assertEquals(route.paramNames, []);
      assertEquals(route.isCatchAll, false);
      assertEquals(route.isOptionalCatchAll, false);
    });

    it("should parse dynamic route with single param", () => {
      const route = parseRoute("/users/[id]", "user.tsx");
      assertEquals(route.pattern, "/users/[id]");
      assertEquals(route.paramNames, ["id"]);
      assertEquals(route.isCatchAll, false);
    });

    it("should parse route with multiple params", () => {
      const route = parseRoute("/blog/[year]/[month]", "archive.tsx");
      assertEquals(route.paramNames, ["year", "month"]);
      assertEquals(route.isCatchAll, false);
    });

    it("should parse catch-all route", () => {
      const route = parseRoute("/docs/[...slug]", "docs.tsx");
      assertEquals(route.paramNames, ["slug"]);
      assertEquals(route.isCatchAll, true);
      assertEquals(route.isOptionalCatchAll, false);
    });

    it("should parse optional catch-all route", () => {
      const route = parseRoute("/docs/[[...slug]]", "docs.tsx");
      assertEquals(route.paramNames, ["slug"]);
      assertEquals(route.isCatchAll, true);
      assertEquals(route.isOptionalCatchAll, true);
    });

    it("should create regex that matches static paths", () => {
      const route = parseRoute("/about", "about.tsx");
      const { regex } = route;

      assertEquals(regex?.test("/about"), true);
      assertEquals(regex?.test("/about/more"), false);
    });

    it("should create regex that matches dynamic params", () => {
      const route = parseRoute("/users/[id]", "user.tsx");
      const { regex } = route;

      assertEquals(regex?.test("/users/123"), true);
      assertEquals(regex?.test("/users/abc"), true);
      assertEquals(regex?.test("/users/"), false);
    });

    it("should create regex that matches catch-all", () => {
      const route = parseRoute("/docs/[...slug]", "docs.tsx");
      const { regex } = route;

      assertEquals(regex?.test("/docs/a/b/c"), true);
      assertEquals(regex?.test("/docs/intro"), true);
      assertEquals(regex?.test("/docs/"), false);
    });

    it("should create regex that matches optional catch-all", () => {
      const route = parseRoute("/shop/[[...category]]", "shop.tsx");
      const { regex } = route;

      assertEquals(regex?.test("/shop"), true);
      assertEquals(regex?.test("/shop/"), true);
      assertEquals(regex?.test("/shop/electronics"), true);
      assertEquals(regex?.test("/shop/electronics/phones"), true);
    });
  });

  describe("getSpecificityScore", () => {
    it("should rank static routes highest", () => {
      const staticRoute = parseRoute("/about/team", "team.tsx");
      const dynamicRoute = parseRoute("/[id]", "dynamic.tsx");

      assertGreater(
        getSpecificityScore(staticRoute),
        getSpecificityScore(dynamicRoute),
      );
    });

    it("should rank dynamic routes higher than catch-all", () => {
      const dynamicRoute = parseRoute("/users/[id]", "user.tsx");
      const catchAllRoute = parseRoute("/users/[...path]", "catch.tsx");

      assertGreater(
        getSpecificityScore(dynamicRoute),
        getSpecificityScore(catchAllRoute),
      );
    });

    it("should rank catch-all higher than optional catch-all", () => {
      const catchAllRoute = parseRoute("/[...slug]", "catch.tsx");
      const optionalCatchAll = parseRoute("/[[...slug]]", "optional.tsx");

      assertGreater(
        getSpecificityScore(catchAllRoute),
        getSpecificityScore(optionalCatchAll),
      );
    });

    it("should give higher scores to longer routes", () => {
      const shortRoute = parseRoute("/a", "a.tsx");
      const longRoute = parseRoute("/a/b/c", "abc.tsx");

      assertGreater(
        getSpecificityScore(longRoute),
        getSpecificityScore(shortRoute),
      );
    });
  });
});
