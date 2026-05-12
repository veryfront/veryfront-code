import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  isPageFile,
  normalizeAppRoutePath,
  normalizePageRoutePath,
  presetBasename,
  presetDirname,
} from "./preset.ts";

describe("build/embedded/preset", () => {
  describe("presetDirname", () => {
    it("should return parent directory for nested path", () => {
      assertEquals(presetDirname("/home/user/file.ts"), "/home/user", "should strip filename");
    });

    it("should return empty string for filename without directory", () => {
      assertEquals(presetDirname("file.ts"), "", "should return empty for bare filename");
    });

    it("should handle root-level file", () => {
      assertEquals(presetDirname("/file.ts"), "", "should return empty for root file");
    });

    it("should handle deeply nested path", () => {
      assertEquals(
        presetDirname("/a/b/c/d/e.ts"),
        "/a/b/c/d",
        "should return parent of deep path",
      );
    });

    it("should handle path ending with slash", () => {
      assertEquals(presetDirname("/a/b/"), "/a/b", "should handle trailing slash");
    });
  });

  describe("presetBasename", () => {
    it("should return filename from path", () => {
      assertEquals(presetBasename("/home/user/file.ts"), "file.ts", "should extract filename");
    });

    it("should return the input if no directory separator", () => {
      assertEquals(presetBasename("file.ts"), "file.ts", "should return input as-is");
    });

    it("should handle deeply nested path", () => {
      assertEquals(
        presetBasename("/a/b/c/d/e.ts"),
        "e.ts",
        "should extract basename from deep path",
      );
    });

    it("should return empty string for path ending with slash", () => {
      assertEquals(presetBasename("/a/b/"), "", "trailing slash yields empty basename");
    });
  });

  describe("normalizeAppRoutePath", () => {
    it("should normalize empty string to /", () => {
      assertEquals(normalizeAppRoutePath(""), "/", "empty path should become /");
    });

    it("should preserve leading slash", () => {
      assertEquals(normalizeAppRoutePath("/about"), "/about", "should keep existing leading slash");
    });

    it("should add leading slash when missing", () => {
      assertEquals(normalizeAppRoutePath("about"), "/about", "should add leading slash");
    });

    it("should handle nested route paths", () => {
      assertEquals(
        normalizeAppRoutePath("blog/posts"),
        "/blog/posts",
        "should normalize nested path",
      );
    });

    it("should handle / input", () => {
      assertEquals(normalizeAppRoutePath("/"), "/", "should preserve single slash");
    });
  });

  describe("normalizePageRoutePath", () => {
    it("should strip .mdx extension and add leading slash", () => {
      assertEquals(normalizePageRoutePath("about.mdx"), "/about", "should normalize .mdx path");
    });

    it("should strip .md extension and add leading slash", () => {
      assertEquals(normalizePageRoutePath("about.md"), "/about", "should normalize .md path");
    });

    it("should handle nested page paths", () => {
      assertEquals(
        normalizePageRoutePath("blog/post.mdx"),
        "/blog/post",
        "should normalize nested page path",
      );
    });

    it("should collapse duplicate slashes", () => {
      assertEquals(
        normalizePageRoutePath("//blog//post.mdx"),
        "/blog/post",
        "should collapse duplicate slashes",
      );
    });

    it("should handle index files", () => {
      assertEquals(
        normalizePageRoutePath("index.mdx"),
        "/index",
        "should normalize index page",
      );
    });
  });

  describe("isPageFile", () => {
    it("should accept .mdx files", () => {
      assertEquals(isPageFile("page.mdx"), true, "should accept .mdx");
    });

    it("should accept .md files", () => {
      assertEquals(isPageFile("page.md"), true, "should accept .md");
    });

    it("should reject .ts files", () => {
      assertEquals(isPageFile("page.ts"), false, "should reject .ts");
    });

    it("should reject .jsx files", () => {
      assertEquals(isPageFile("page.jsx"), false, "should reject .jsx");
    });

    it("should reject underscore-prefixed .mdx files", () => {
      assertEquals(isPageFile("_layout.mdx"), false, "should reject _-prefixed files");
    });

    it("should reject underscore-prefixed .md files", () => {
      assertEquals(isPageFile("_draft.md"), false, "should reject _-prefixed .md files");
    });

    it("should accept nested filenames", () => {
      assertEquals(isPageFile("about.mdx"), true, "should accept regular .mdx");
    });
  });
});
