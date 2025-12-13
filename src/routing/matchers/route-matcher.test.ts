import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { matchRoute } from "./route-matcher.ts";
import { parseRoute } from "./route-parser.ts";

describe("matchRoute", () => {
  describe("static routes", () => {
    it("should match exact static path", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      const match = matchRoute("/about", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, {});
    });

    it("should not match different static path", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      const match = matchRoute("/contact", route);

      assertEquals(match, null);
    });

    it("should not match partial paths", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      const match = matchRoute("/about/team", route);

      assertEquals(match, null);
    });
  });

  describe("dynamic segments", () => {
    it("should extract single dynamic parameter", () => {
      const route = parseRoute("/users/[id]", "/pages/users/[id].tsx");
      const match = matchRoute("/users/123", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { id: "123" });
    });

    it("should extract multiple dynamic parameters", () => {
      const route = parseRoute("/users/[id]/posts/[postId]", "/pages/users/[id]/posts/[postId].tsx");
      const match = matchRoute("/users/123/posts/456", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { id: "123", postId: "456" });
    });

    it("should decode URI components in params", () => {
      const route = parseRoute("/users/[name]", "/pages/users/[name].tsx");
      const match = matchRoute("/users/john%20doe", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { name: "john doe" });
    });

    it("should handle special characters in dynamic segments", () => {
      const route = parseRoute("/items/[id]", "/pages/items/[id].tsx");
      const match = matchRoute("/items/abc-123_xyz", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { id: "abc-123_xyz" });
    });
  });

  describe("catch-all segments", () => {
    it("should extract required catch-all as array", () => {
      const route = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
      const match = matchRoute("/docs/getting-started/installation", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { slug: ["getting-started", "installation"] });
    });

    it("should handle single segment in required catch-all", () => {
      const route = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
      const match = matchRoute("/docs/intro", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { slug: ["intro"] });
    });

    it("should extract optional catch-all as array", () => {
      const route = parseRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx");
      const match = matchRoute("/blog/2024/01/post", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { slug: ["2024", "01", "post"] });
    });

    it("should match optional catch-all with no segments", () => {
      const route = parseRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx");
      const match = matchRoute("/blog", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params.slug, []);
    });

    it("should decode URI components in catch-all segments", () => {
      const route = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
      const match = matchRoute("/docs/hello%20world/test%20page", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { slug: ["hello world", "test page"] });
    });
  });

  describe("mixed patterns", () => {
    it("should match route with static and dynamic segments", () => {
      const route = parseRoute("/users/[id]/profile", "/pages/users/[id]/profile.tsx");
      const match = matchRoute("/users/123/profile", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { id: "123" });
    });

    it("should match complex nested route", () => {
      const route = parseRoute("/api/[version]/users/[id]", "/pages/api/[version]/users/[id].tsx");
      const match = matchRoute("/api/v1/users/42", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, { version: "v1", id: "42" });
    });
  });

  describe("edge cases", () => {
    it("should handle root route", () => {
      const route = parseRoute("/", "/pages/index.tsx");
      const match = matchRoute("/", route);

      assertEquals(match !== null, true);
      assertEquals(match?.params, {});
    });

    it("should handle empty string in dynamic segment", () => {
      const route = parseRoute("/users/[id]", "/pages/users/[id].tsx");
      const match = matchRoute("/users/", route);

      // This should not match because [id] requires a value
      assertEquals(match, null);
    });

    it("should handle trailing slashes consistently", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      const match = matchRoute("/about/", route);

      // Depends on implementation - typically won't match with trailing slash
      assertEquals(match, null);
    });

    it("should return route reference in match", () => {
      const route = parseRoute("/about", "/pages/about.tsx");
      const match = matchRoute("/about", route);

      assertEquals(match !== null, true);
      assertEquals(match?.route, route);
    });

    it("should handle empty catch-all array", () => {
      const route = parseRoute("/blog/[[...slug]]", "/pages/blog/[[...slug]].tsx");
      const match = matchRoute("/blog", route);

      assertEquals(match !== null, true);
      assertEquals(Array.isArray(match?.params.slug), true);
      assertEquals((match?.params.slug as string[]).length, 0);
    });

    it("should filter empty segments in catch-all", () => {
      const route = parseRoute("/docs/[...slug]", "/pages/docs/[...slug].tsx");
      // Double slashes would create empty segments
      const match = matchRoute("/docs/a//b", route);

      if (match) {
        // Empty segments should be filtered
        assertEquals(match.params.slug, ["a", "b"]);
      }
    });
  });

  describe("no match scenarios", () => {
    it("should return null for completely different path", () => {
      const route = parseRoute("/users/[id]", "/pages/users/[id].tsx");
      const match = matchRoute("/products/123", route);

      assertEquals(match, null);
    });

    it("should return null for path with extra segments", () => {
      const route = parseRoute("/users/[id]", "/pages/users/[id].tsx");
      const match = matchRoute("/users/123/extra", route);

      assertEquals(match, null);
    });

    it("should return null for path with missing segments", () => {
      const route = parseRoute("/users/[id]/posts", "/pages/users/[id]/posts.tsx");
      const match = matchRoute("/users/123", route);

      assertEquals(match, null);
    });
  });
});
