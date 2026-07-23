import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { matchRoute } from "./route-matcher.ts";
import { parseRoute } from "./route-parser.ts";
import type { Route } from "./types.ts";

describe("route-matcher", () => {
  describe("matchRoute", () => {
    it("should match static route", () => {
      const route = parseRoute("/about", "about.tsx");
      const match = matchRoute("/about", route);

      assertEquals(match?.params, {});
      assertEquals(match?.route.pattern, "/about");
    });

    it("should return null for non-matching static route", () => {
      const route = parseRoute("/about", "about.tsx");
      const match = matchRoute("/contact", route);

      assertEquals(match, null);
    });

    it("should extract single dynamic param", () => {
      const route = parseRoute("/users/[id]", "user.tsx");
      const match = matchRoute("/users/123", route);

      assertEquals(match?.params.id, "123");
    });

    it("should extract multiple dynamic params", () => {
      const route = parseRoute("/blog/[year]/[month]", "archive.tsx");
      const match = matchRoute("/blog/2024/01", route);

      assertEquals(match?.params.year, "2024");
      assertEquals(match?.params.month, "01");
    });

    it("extracts custom-regex captures with the route's public paramNames contract", () => {
      const route: Route = {
        pattern: "/legacy/:id",
        page: "legacy.tsx",
        regex: /^\/legacy\/([^/]+)$/,
        paramNames: ["id"],
      };

      assertEquals(matchRoute("/legacy/hello%20world", route)?.params, {
        id: "hello world",
      });
    });

    it("should decode URL-encoded params", () => {
      const route = parseRoute("/search/[query]", "search.tsx");
      const match = matchRoute("/search/hello%20world", route);

      assertEquals(match?.params.query, "hello world");
    });

    it("should extract catch-all params as array", () => {
      const route = parseRoute("/docs/[...slug]", "docs.tsx");
      const match = matchRoute("/docs/getting-started/intro", route);

      assertEquals(match?.params.slug, ["getting-started", "intro"]);
    });

    it("preserves non-word parameter names and catch-all array types", () => {
      const route = parseRoute(
        "/users/[user-id]/files/[...file.parts]",
        "files.tsx",
      );
      const match = matchRoute("/users/42/files/a/b", route);

      assertEquals(match?.params["user-id"], "42");
      assertEquals(match?.params["file.parts"], ["a", "b"]);
    });

    it("returns __proto__ as an own parameter without changing the result prototype", () => {
      const route = parseRoute("/users/[__proto__]", "user.tsx");
      const params = matchRoute("/users/42", route)?.params;

      assertEquals(Object.hasOwn(params ?? {}, "__proto__"), true);
      assertEquals(params?.["__proto__"], "42");
      assertEquals(Object.getPrototypeOf(params), Object.prototype);
    });

    it("should handle empty catch-all for optional routes", () => {
      const route = parseRoute("/shop/[[...category]]", "shop.tsx");
      const match = matchRoute("/shop", route);

      assertEquals(match?.params.category, []);
    });

    it("matches an empty optional catch-all before a suffix", () => {
      const route = parseRoute("/docs/[[...slug]]/edit", "edit.tsx");

      assertEquals(matchRoute("/docs/edit", route)?.params.slug, []);
      assertEquals(
        matchRoute("/docs/api/reference/edit", route)?.params.slug,
        ["api", "reference"],
      );
    });

    it("should decode catch-all segments", () => {
      const route = parseRoute("/files/[...path]", "files.tsx");
      const match = matchRoute("/files/my%20folder/sub%20dir", route);

      assertEquals(match?.params.path, ["my folder", "sub dir"]);
    });

    it("should match nested static + dynamic routes", () => {
      const route = parseRoute("/api/users/[id]/posts", "posts.tsx");
      const match = matchRoute("/api/users/42/posts", route);

      assertEquals(match?.params.id, "42");
    });

    it("should not throw on malformed percent-encoding in dynamic param", () => {
      const route = parseRoute("/users/[id]", "user.tsx");
      const match = matchRoute("/users/%zz", route);

      assertEquals(match?.params.id, "%zz");
    });

    it("should not throw on malformed percent-encoding in catch-all segment", () => {
      const route = parseRoute("/files/[...path]", "files.tsx");
      const match = matchRoute("/files/ok/%zz", route);

      assertEquals(match?.params.path, ["ok", "%zz"]);
    });
  });
});
