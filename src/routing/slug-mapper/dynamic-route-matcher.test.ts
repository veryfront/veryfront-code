import { describe, it } from "@veryfront/testing/bdd";
import { expect } from "@std/expect";
import { extractParams, isDynamicRoute, matchesPattern } from "./dynamic-route-matcher.ts";

describe("dynamic-route-matcher", () => {
  describe("isDynamicRoute", () => {
    it("should return true for simple dynamic parameter", () => {
      expect(isDynamicRoute("blog/[slug]")).toBe(true);
    });

    it("should return true for dynamic parameter with id", () => {
      expect(isDynamicRoute("users/[id]")).toBe(true);
    });

    it("should return true for catch-all parameter", () => {
      expect(isDynamicRoute("blog/[...slug]")).toBe(true);
    });

    it("should return false for static route", () => {
      expect(isDynamicRoute("blog/post")).toBe(false);
    });

    it("should return true for multiple dynamic parameters", () => {
      expect(isDynamicRoute("users/[id]/posts/[postId]")).toBe(true);
    });

    it("should return true for dynamic parameter with dots", () => {
      expect(isDynamicRoute("api/[version.number]")).toBe(true);
    });

    it("should return false for empty string", () => {
      expect(isDynamicRoute("")).toBe(false);
    });

    it("should return false for root path", () => {
      expect(isDynamicRoute("/")).toBe(false);
    });

    it("should return true for dynamic at root level", () => {
      expect(isDynamicRoute("[slug]")).toBe(true);
    });

    it("should return true for catch-all at root level", () => {
      expect(isDynamicRoute("[...path]")).toBe(true);
    });
  });

  describe("extractParams", () => {
    describe("simple parameters", () => {
      it("should extract single parameter", () => {
        const params = extractParams("blog/[slug]", "blog/my-post");
        expect(params).toEqual({ slug: "my-post" });
      });

      it("should extract parameter with id", () => {
        const params = extractParams("users/[id]", "users/123");
        expect(params).toEqual({ id: "123" });
      });

      it("should extract multiple parameters", () => {
        const params = extractParams("users/[id]/posts/[postId]", "users/123/posts/456");
        expect(params).toEqual({ id: "123", postId: "456" });
      });

      it("should extract parameter from root level", () => {
        const params = extractParams("[slug]", "my-post");
        expect(params).toEqual({ slug: "my-post" });
      });

      it("should return null if pattern does not match", () => {
        const params = extractParams("blog/[slug]", "news/article");
        expect(params).toBeNull();
      });

      it("should return null if not enough segments", () => {
        const params = extractParams("blog/[slug]/detail", "blog/my-post");
        expect(params).toBeNull();
      });

      it("should return null if too many segments", () => {
        const params = extractParams("blog/[slug]", "blog/my-post/extra");
        expect(params).toBeNull();
      });

      it("should extract parameters with special characters", () => {
        const params = extractParams("blog/[slug]", "blog/my-post-123");
        expect(params).toEqual({ slug: "my-post-123" });
      });

      it("should handle parameter with underscores", () => {
        const params = extractParams("users/[user_id]", "users/john_doe");
        expect(params).toEqual({ user_id: "john_doe" });
      });

      it("should handle numeric slugs", () => {
        const params = extractParams("year/[year]", "year/2024");
        expect(params).toEqual({ year: "2024" });
      });
    });

    describe("catch-all parameters", () => {
      it("should extract catch-all parameter as array", () => {
        const params = extractParams("blog/[...slug]", "blog/a/b/c");
        expect(params).toEqual({ slug: ["a", "b", "c"] });
      });

      it("should extract single segment as array", () => {
        const params = extractParams("blog/[...slug]", "blog/post");
        expect(params).toEqual({ slug: ["post"] });
      });

      it("should extract empty catch-all as empty array", () => {
        const params = extractParams("blog/[...slug]", "blog");
        expect(params).toEqual({ slug: [] });
      });

      it("should handle catch-all at root level", () => {
        const params = extractParams("[...path]", "a/b/c");
        expect(params).toEqual({ path: ["a", "b", "c"] });
      });

      it("should handle catch-all with preceding static segment", () => {
        const params = extractParams("api/[...path]", "api/v1/users/123");
        expect(params).toEqual({ path: ["v1", "users", "123"] });
      });

      it("should handle catch-all with different names", () => {
        const params = extractParams("docs/[...segments]", "docs/guide/getting-started");
        expect(params).toEqual({ segments: ["guide", "getting-started"] });
      });

      it("should return null if static part does not match", () => {
        const params = extractParams("blog/[...slug]", "news/a/b/c");
        expect(params).toBeNull();
      });
    });

    describe("mixed patterns", () => {
      it("should extract parameter before catch-all", () => {
        const params = extractParams("[lang]/[...path]", "en/docs/guide");
        expect(params).toEqual({ lang: "en", path: ["docs", "guide"] });
      });

      it("should handle static, dynamic, and catch-all", () => {
        const params = extractParams("api/[version]/[...path]", "api/v1/users/123");
        expect(params).toEqual({ version: "v1", path: ["users", "123"] });
      });

      it("should handle multiple dynamic before catch-all", () => {
        const params = extractParams("[lang]/[region]/[...path]", "en/us/docs/guide");
        expect(params).toEqual({ lang: "en", region: "us", path: ["docs", "guide"] });
      });
    });

    describe("edge cases", () => {
      it("should handle empty slug", () => {
        const params = extractParams("blog/[slug]", "blog/");
        expect(params).toBeNull();
      });

      it("should handle slug with only slashes", () => {
        const params = extractParams("blog/[slug]", "blog///");
        expect(params).toBeNull();
      });

      it("should handle pattern with empty segments", () => {
        const params = extractParams("blog//[slug]", "blog/my-post");
        expect(params).toEqual({ slug: "my-post" });
      });

      it("should handle mixed empty segments", () => {
        const params = extractParams("blog/[slug]/detail", "blog//my-post/detail");
        expect(params).toEqual({ slug: "my-post" });
      });

      it("should return null for completely different paths", () => {
        const params = extractParams("users/[id]", "posts/123");
        expect(params).toBeNull();
      });

      it("should handle parameter with dots in name", () => {
        const params = extractParams("api/[version.number]", "api/1.0");
        expect(params).toEqual({ "version.number": "1.0" });
      });

      it("should handle very long paths", () => {
        const pattern = "a/[b]/c/[d]/e/[f]";
        const slug = "a/B/c/D/e/F";
        const params = extractParams(pattern, slug);
        expect(params).toEqual({ b: "B", d: "D", f: "F" });
      });

      it("should return empty object for static route match", () => {
        const params = extractParams("blog/post", "blog/post");
        expect(params).toEqual({});
      });
    });

    describe("no match scenarios", () => {
      it("should return null when static segment does not match", () => {
        const params = extractParams("blog/[slug]", "news/article");
        expect(params).toBeNull();
      });

      it("should return null when pattern is longer than slug", () => {
        const params = extractParams("blog/[category]/[slug]", "blog/post");
        expect(params).toBeNull();
      });

      it("should return null when slug is longer than pattern (no catch-all)", () => {
        const params = extractParams("blog/[slug]", "blog/category/post");
        expect(params).toBeNull();
      });

      it("should return null for empty pattern", () => {
        const params = extractParams("", "blog/post");
        expect(params).toBeNull();
      });

      it("should handle empty slug with non-empty pattern", () => {
        const params = extractParams("blog/[slug]", "");
        expect(params).toBeNull();
      });
    });
  });

  describe("matchesPattern", () => {
    it("should return true for matching simple pattern", () => {
      expect(matchesPattern("blog/[slug]", "blog/my-post")).toBe(true);
    });

    it("should return false for non-matching pattern", () => {
      expect(matchesPattern("blog/[slug]", "news/article")).toBe(false);
    });

    it("should return true for matching catch-all pattern", () => {
      expect(matchesPattern("blog/[...slug]", "blog/a/b/c")).toBe(true);
    });

    it("should return true for matching multiple parameters", () => {
      expect(matchesPattern("users/[id]/posts/[postId]", "users/123/posts/456")).toBe(true);
    });

    it("should return false when segments do not match", () => {
      expect(matchesPattern("users/[id]", "posts/123")).toBe(false);
    });

    it("should return true for static route exact match", () => {
      expect(matchesPattern("blog/post", "blog/post")).toBe(true);
    });

    it("should return false for static route mismatch", () => {
      expect(matchesPattern("blog/post", "blog/article")).toBe(false);
    });

    it("should return true for root level dynamic", () => {
      expect(matchesPattern("[slug]", "my-post")).toBe(true);
    });

    it("should return false when pattern too long", () => {
      expect(matchesPattern("blog/[slug]/detail", "blog/post")).toBe(false);
    });

    it("should return false when slug too long (no catch-all)", () => {
      expect(matchesPattern("blog/[slug]", "blog/category/post")).toBe(false);
    });

    it("should return true for catch-all with extra segments", () => {
      expect(matchesPattern("blog/[...slug]", "blog/a/b/c/d/e")).toBe(true);
    });

    it("should return false for empty slug with pattern", () => {
      expect(matchesPattern("blog/[slug]", "")).toBe(false);
    });

    it("should return false for pattern with empty slug segment", () => {
      expect(matchesPattern("blog/[slug]", "blog/")).toBe(false);
    });
  });

  describe("integration tests", () => {
    it("should work end-to-end for blog route", () => {
      const pattern = "blog/[slug]";
      const slug = "blog/my-first-post";

      expect(isDynamicRoute(pattern)).toBe(true);
      expect(matchesPattern(pattern, slug)).toBe(true);

      const params = extractParams(pattern, slug);
      expect(params).toEqual({ slug: "my-first-post" });
    });

    it("should work end-to-end for user profile route", () => {
      const pattern = "users/[id]/profile";
      const slug = "users/123/profile";

      expect(isDynamicRoute(pattern)).toBe(true);
      expect(matchesPattern(pattern, slug)).toBe(true);

      const params = extractParams(pattern, slug);
      expect(params).toEqual({ id: "123" });
    });

    it("should work end-to-end for catch-all docs route", () => {
      const pattern = "docs/[...path]";
      const slug = "docs/getting-started/installation";

      expect(isDynamicRoute(pattern)).toBe(true);
      expect(matchesPattern(pattern, slug)).toBe(true);

      const params = extractParams(pattern, slug);
      expect(params).toEqual({ path: ["getting-started", "installation"] });
    });

    it("should work end-to-end for complex multi-param route", () => {
      const pattern = "[lang]/users/[id]/posts/[postId]";
      const slug = "en/users/123/posts/456";

      expect(isDynamicRoute(pattern)).toBe(true);
      expect(matchesPattern(pattern, slug)).toBe(true);

      const params = extractParams(pattern, slug);
      expect(params).toEqual({ lang: "en", id: "123", postId: "456" });
    });

    it("should reject non-matching route end-to-end", () => {
      const pattern = "blog/[slug]";
      const slug = "news/article";

      expect(isDynamicRoute(pattern)).toBe(true);
      expect(matchesPattern(pattern, slug)).toBe(false);

      const params = extractParams(pattern, slug);
      expect(params).toBeNull();
    });
  });

  describe("real-world examples", () => {
    it("should handle Next.js style blog route", () => {
      const params = extractParams("blog/[slug]", "blog/nextjs-tutorial");
      expect(params).toEqual({ slug: "nextjs-tutorial" });
    });

    it("should handle Next.js style API route", () => {
      const params = extractParams("api/users/[id]", "api/users/42");
      expect(params).toEqual({ id: "42" });
    });

    it("should handle Next.js catch-all docs", () => {
      const params = extractParams("docs/[...slug]", "docs/api/reference/hooks");
      expect(params).toEqual({ slug: ["api", "reference", "hooks"] });
    });

    it("should handle localized routes", () => {
      const params = extractParams("[locale]/blog/[slug]", "en/blog/hello-world");
      expect(params).toEqual({ locale: "en", slug: "hello-world" });
    });

    it("should handle shop product routes", () => {
      const params = extractParams("shop/[category]/[productId]", "shop/electronics/laptop-123");
      expect(params).toEqual({ category: "electronics", productId: "laptop-123" });
    });
  });
});
