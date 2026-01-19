import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { matchRoute } from "./route-matcher.ts";
import { parseRoute } from "./route-parser.ts";

describe("route-matcher", () => {
  describe("matchRoute", () => {
    it("should match static route", () => {
      const route = parseRoute("/about", "about.tsx");
      const match = matchRoute("/about", route);

      assertEquals(match !== null, true);
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

      assertEquals(match !== null, true);
      assertEquals(match?.params["id"], "123");
    });

    it("should extract multiple dynamic params", () => {
      const route = parseRoute("/blog/[year]/[month]", "archive.tsx");
      const match = matchRoute("/blog/2024/01", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params["year"], "2024");
      assertEquals(match?.params["month"], "01");
    });

    it("should decode URL-encoded params", () => {
      const route = parseRoute("/search/[query]", "search.tsx");
      const match = matchRoute("/search/hello%20world", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params["query"], "hello world");
    });

    it("should extract catch-all params as array", () => {
      const route = parseRoute("/docs/[...slug]", "docs.tsx");
      const match = matchRoute("/docs/getting-started/intro", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params["slug"], ["getting-started", "intro"]);
    });

    it("should handle empty catch-all for optional routes", () => {
      const route = parseRoute("/shop/[[...category]]", "shop.tsx");
      const match = matchRoute("/shop", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params["category"], []);
    });

    it("should decode catch-all segments", () => {
      const route = parseRoute("/files/[...path]", "files.tsx");
      const match = matchRoute("/files/my%20folder/sub%20dir", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params["path"], ["my folder", "sub dir"]);
    });

    it("should match nested static + dynamic routes", () => {
      const route = parseRoute("/api/users/[id]/posts", "posts.tsx");
      const match = matchRoute("/api/users/42/posts", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params["id"], "42");
    });
  });
});
