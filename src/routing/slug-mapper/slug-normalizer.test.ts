import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { getSlugFromPath, normalizeSlug, pathToSlug, slugToPath } from "./slug-normalizer.ts";

describe("slug-normalizer", () => {
  describe("normalizeSlug", () => {
    it("should remove leading slash", () => {
      expect(normalizeSlug("/blog/post")).toBe("blog/post");
    });

    it("should remove trailing slash", () => {
      expect(normalizeSlug("blog/post/")).toBe("blog/post");
    });

    it("should remove both leading and trailing slashes", () => {
      expect(normalizeSlug("/blog/post/")).toBe("blog/post");
    });

    it("should remove multiple leading slashes", () => {
      expect(normalizeSlug("///blog/post")).toBe("blog/post");
    });

    it("should remove multiple trailing slashes", () => {
      expect(normalizeSlug("blog/post///")).toBe("blog/post");
    });

    it("should remove empty segments between slashes", () => {
      expect(normalizeSlug("//blog//post//")).toBe("blog/post");
    });

    it("should handle empty string", () => {
      expect(normalizeSlug("")).toBe("");
    });

    it("should handle root path", () => {
      expect(normalizeSlug("/")).toBe("");
    });

    it("should handle single segment", () => {
      expect(normalizeSlug("blog")).toBe("blog");
    });

    it("should handle deep nested paths", () => {
      expect(normalizeSlug("/blog/category/post/detail")).toBe("blog/category/post/detail");
    });

    it("should preserve middle slashes", () => {
      expect(normalizeSlug("/blog/post")).toBe("blog/post");
    });

    it("should handle path with only slashes", () => {
      expect(normalizeSlug("///")).toBe("");
    });
  });

  describe("slugToPath", () => {
    it("should convert slug to path with leading slash", () => {
      expect(slugToPath("blog/post")).toBe("/blog/post");
    });

    it("should handle empty slug as root", () => {
      expect(slugToPath("")).toBe("/");
    });

    it("should normalize and convert slug", () => {
      expect(slugToPath("/blog/post/")).toBe("/blog/post");
    });

    it("should handle root path", () => {
      expect(slugToPath("/")).toBe("/");
    });

    it("should handle single segment", () => {
      expect(slugToPath("blog")).toBe("/blog");
    });

    it("should handle deep nested paths", () => {
      expect(slugToPath("blog/category/post")).toBe("/blog/category/post");
    });

    it("should remove duplicate slashes", () => {
      expect(slugToPath("//blog//post//")).toBe("/blog/post");
    });

    it("should add leading slash to normalized slug", () => {
      expect(slugToPath("about")).toBe("/about");
    });
  });

  describe("pathToSlug", () => {
    it("should remove leading slash from path", () => {
      expect(pathToSlug("/blog/post")).toBe("blog/post");
    });

    it("should handle root path", () => {
      expect(pathToSlug("/")).toBe("");
    });

    it("should remove trailing slash", () => {
      expect(pathToSlug("/blog/")).toBe("blog");
    });

    it("should handle path without leading slash", () => {
      expect(pathToSlug("blog/post")).toBe("blog/post");
    });

    it("should normalize before converting", () => {
      expect(pathToSlug("//blog//post//")).toBe("blog/post");
    });

    it("should handle single segment", () => {
      expect(pathToSlug("/about")).toBe("about");
    });

    it("should handle deep nested paths", () => {
      expect(pathToSlug("/blog/category/post")).toBe("blog/category/post");
    });

    it("should handle empty string", () => {
      expect(pathToSlug("")).toBe("");
    });
  });

  describe("getSlugFromPath", () => {
    it("should extract slug from MDX file", () => {
      expect(getSlugFromPath("/project/pages/blog.mdx")).toBe("blog");
    });

    it("should extract slug from TSX file", () => {
      expect(getSlugFromPath("/project/pages/about.tsx")).toBe("about");
    });

    it("should extract slug from JSX file", () => {
      expect(getSlugFromPath("/project/pages/contact.jsx")).toBe("contact");
    });

    it("should handle index file as empty slug", () => {
      expect(getSlugFromPath("/project/pages/index.tsx")).toBe("");
    });

    it("should handle page file as parent directory", () => {
      expect(getSlugFromPath("/project/app/blog/page.tsx")).toBe("blog");
    });

    it("should handle nested page file", () => {
      expect(getSlugFromPath("/project/app/blog/post/page.tsx")).toBe("post");
    });

    it("should handle index in subdirectory", () => {
      expect(getSlugFromPath("/project/pages/blog/index.tsx")).toBe("blog");
    });

    it("should handle root index file", () => {
      expect(getSlugFromPath("/project/pages/index.tsx")).toBe("");
    });

    it("should handle root page file", () => {
      expect(getSlugFromPath("/project/app/page.tsx")).toBe("");
    });

    it("should handle MD file", () => {
      expect(getSlugFromPath("/project/pages/readme.md")).toBe("readme");
    });

    it("should handle TS file", () => {
      expect(getSlugFromPath("/project/pages/api.ts")).toBe("api");
    });

    it("should handle JS file", () => {
      expect(getSlugFromPath("/project/pages/utils.js")).toBe("utils");
    });

    it("should handle file without directory", () => {
      expect(getSlugFromPath("blog.mdx")).toBe("blog");
    });

    it("should handle deep nested file", () => {
      expect(getSlugFromPath("/project/app/blog/category/post/detail.tsx")).toBe("detail");
    });

    it("should handle page in app directory", () => {
      expect(getSlugFromPath("/project/app/page.tsx")).toBe("");
    });

    it("should handle index in pages directory", () => {
      expect(getSlugFromPath("/project/pages/index.mdx")).toBe("");
    });

    it("should extract parent directory for page files", () => {
      expect(getSlugFromPath("/project/app/about/page.tsx")).toBe("about");
    });

    it("should extract parent directory for index files", () => {
      expect(getSlugFromPath("/project/pages/about/index.tsx")).toBe("about");
    });

    it("should handle empty filename", () => {
      expect(getSlugFromPath("/project/pages/")).toBe("");
    });
  });

  describe("round-trip conversions", () => {
    it("should convert slug to path and back", () => {
      const slug = "blog/post";
      const path = slugToPath(slug);
      const backToSlug = pathToSlug(path);
      expect(backToSlug).toBe(slug);
    });

    it("should convert path to slug and back", () => {
      const path = "/blog/post";
      const slug = pathToSlug(path);
      const backToPath = slugToPath(slug);
      expect(backToPath).toBe(path);
    });

    it("should normalize in both directions", () => {
      const messySlug = "//blog//post//";
      const path = slugToPath(messySlug);
      const cleanSlug = pathToSlug(path);
      expect(cleanSlug).toBe("blog/post");
      expect(path).toBe("/blog/post");
    });

    it("should handle root path round-trip", () => {
      const path = "/";
      const slug = pathToSlug(path);
      const backToPath = slugToPath(slug);
      expect(slug).toBe("");
      expect(backToPath).toBe("/");
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
