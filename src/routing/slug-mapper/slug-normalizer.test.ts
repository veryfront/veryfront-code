import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { getSlugFromPath, normalizeSlug, pathToSlug, slugToPath } from "./slug-normalizer.ts";

describe("slug-normalizer", () => {
  describe("normalizeSlug", () => {
    it("should normalize slashes and segments", () => {
      const cases: [input: string, expected: string][] = [
        ["/blog/post", "blog/post"],
        ["blog/post/", "blog/post"],
        ["/blog/post/", "blog/post"],
        ["///blog/post", "blog/post"],
        ["blog/post///", "blog/post"],
        ["//blog//post//", "blog/post"],
        ["", ""],
        ["/", ""],
        ["blog", "blog"],
        ["/blog/category/post/detail", "blog/category/post/detail"],
        ["///", ""],
      ];

      for (const [input, expected] of cases) {
        expect(normalizeSlug(input)).toBe(expected);
      }
    });
  });

  describe("slugToPath", () => {
    it("should convert slug to path", () => {
      const cases: [input: string, expected: string][] = [
        ["blog/post", "/blog/post"],
        ["", "/"],
        ["/blog/post/", "/blog/post"],
        ["/", "/"],
        ["blog", "/blog"],
        ["blog/category/post", "/blog/category/post"],
        ["//blog//post//", "/blog/post"],
        ["about", "/about"],
      ];

      for (const [input, expected] of cases) {
        expect(slugToPath(input)).toBe(expected);
      }
    });
  });

  describe("pathToSlug", () => {
    it("should convert path to slug", () => {
      const cases: [input: string, expected: string][] = [
        ["/blog/post", "blog/post"],
        ["/", ""],
        ["/blog/", "blog"],
        ["blog/post", "blog/post"],
        ["//blog//post//", "blog/post"],
        ["/about", "about"],
        ["/blog/category/post", "blog/category/post"],
        ["", ""],
      ];

      for (const [input, expected] of cases) {
        expect(pathToSlug(input)).toBe(expected);
      }
    });
  });

  describe("getSlugFromPath", () => {
    it("should extract slug from file paths", () => {
      const cases: [input: string, expected: string][] = [
        ["/project/pages/blog.mdx", "blog"],
        ["/project/pages/about.tsx", "about"],
        ["/project/pages/contact.jsx", "contact"],
        ["/project/pages/index.tsx", ""],
        ["/project/app/blog/page.tsx", "blog"],
        ["/project/app/blog/post/page.tsx", "post"],
        ["/project/pages/blog/index.tsx", "blog"],
        ["/project/app/page.tsx", ""],
        ["/project/pages/readme.md", "readme"],
        ["/project/pages/api.ts", "api"],
        ["/project/pages/utils.js", "utils"],
        ["blog.mdx", "blog"],
        ["/project/app/blog/category/post/detail.tsx", "detail"],
        ["/project/pages/index.mdx", ""],
        ["/project/app/about/page.tsx", "about"],
        ["/project/pages/about/index.tsx", "about"],
        ["/project/pages/", ""],
      ];

      for (const [input, expected] of cases) {
        expect(getSlugFromPath(input)).toBe(expected);
      }
    });
  });

  describe("round-trip conversions", () => {
    it("should convert slug to path and back", () => {
      const slug = "blog/post";
      expect(pathToSlug(slugToPath(slug))).toBe(slug);
    });

    it("should convert path to slug and back", () => {
      const path = "/blog/post";
      expect(slugToPath(pathToSlug(path))).toBe(path);
    });

    it("should normalize in both directions", () => {
      const messySlug = "//blog//post//";
      const path = slugToPath(messySlug);

      expect(pathToSlug(path)).toBe("blog/post");
      expect(path).toBe("/blog/post");
    });

    it("should handle root path round-trip", () => {
      const path = "/";
      const slug = pathToSlug(path);

      expect(slug).toBe("");
      expect(slugToPath(slug)).toBe("/");
    });
  });

  describe("edge cases", () => {
    it("should handle slug with special characters", () => {
      const slug = "blog/post-with-dashes";
      expect(normalizeSlug(slug)).toBe(slug);
    });

    it("should handle slug with numbers", () => {
      const slug = "2024/01/post";
      expect(normalizeSlug(slug)).toBe(slug);
    });

    it("should handle very long paths", () => {
      const longPath = "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p";
      expect(normalizeSlug(longPath)).toBe(longPath);
    });

    it("should handle file path with dots", () => {
      expect(getSlugFromPath("/project/pages/blog.post.mdx")).toBe("blog.post");
    });

    it("should handle uppercase extensions", () => {
      expect(getSlugFromPath("/project/pages/blog.MDX")).toBe("blog.MDX");
    });
  });
});
