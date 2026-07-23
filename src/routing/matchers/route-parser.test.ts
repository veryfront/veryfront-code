import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertGreater } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compareRouteSpecificity, getSpecificityScore, parseRoute } from "./route-parser.ts";

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

    it("preserves hyphenated, dotted, and Unicode parameter names", () => {
      const route = parseRoute(
        "/users/[user-id]/[version.number]/[användare]",
        "user.tsx",
      );

      assertEquals(route.paramNames, ["user-id", "version.number", "användare"]);
      assertEquals(route.regex?.test("/users/42/1.0/anna"), true);
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

    it("treats placeholder-looking static segments as literal text", () => {
      for (
        const marker of [
          "___PARAM___",
          "___CATCHALL___",
          "___OPTIONAL_CATCHALL___",
        ]
      ) {
        const route = parseRoute(`/api/${marker}`, `${marker}.ts`);

        assertEquals(route.regex?.test(`/api/${marker}`), true);
        assertEquals(route.regex?.test("/api/unrelated"), false);
        assertEquals(route.paramNames, []);
      }
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

    it("matches optional catch-alls before a static suffix", () => {
      const route = parseRoute("/docs/[[...slug]]/edit", "edit.tsx");

      assertEquals(route.regex?.test("/docs/edit"), true);
      assertEquals(route.regex?.test("/docs/api/reference/edit"), true);
      assertEquals(route.regex?.test("/docs/api/reference/view"), false);
    });

    it("rejects ambiguous patterns with multiple catch-alls", () => {
      const route = parseRoute(
        "/[...first]/middle/[[...second]]",
        "ambiguous.tsx",
      );

      assertEquals(route.paramNames, []);
      assertEquals(route.regex?.test("/a/b/middle/c/d"), false);
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

    it("ranks an exact route above an empty optional catch-all", () => {
      const exact = parseRoute("/docs", "docs.tsx");
      const optional = parseRoute("/docs/[[...slug]]", "optional.tsx");

      assertGreater(
        getSpecificityScore(exact),
        getSpecificityScore(optional),
      );
    });

    it("ranks the earliest static segment first", () => {
      const earlierStatic = parseRoute("/a/fixed/[id]", "earlier.tsx");
      const laterStatic = parseRoute("/a/[id]/fixed", "later.tsx");

      assertGreater(
        getSpecificityScore(earlierStatic),
        getSpecificityScore(laterStatic),
      );
    });

    it("ranks a static suffix after an optional catch-all over a dynamic segment", () => {
      const staticSuffix = parseRoute(
        "/foo/[[...slug]]/bar",
        "static-suffix.tsx",
      );
      const dynamic = parseRoute("/foo/[id]", "dynamic.tsx");

      assertGreater(
        getSpecificityScore(staticSuffix),
        getSpecificityScore(dynamic),
      );
    });

    it("compares long route shapes without floating-point precision loss", () => {
      const prefix = Array.from({ length: 18 }, (_, index) => `[part${index}]`);
      const staticTail = parseRoute(`/${[...prefix, "fixed"].join("/")}`, "static.tsx");
      const dynamicTail = parseRoute(`/${[...prefix, "[tail]"].join("/")}`, "dynamic.tsx");

      assertGreater(compareRouteSpecificity(staticTail, dynamicTail), 0);
    });
  });
});
