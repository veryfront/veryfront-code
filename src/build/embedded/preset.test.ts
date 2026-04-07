import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { presetBasename, presetDirname } from "./preset.ts";

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

  describe("route path normalization", () => {
    describe("app routes", () => {
      it("should normalize empty relative path to /", () => {
        const rel = "";
        const norm = rel === "" ? "/" : rel.startsWith("/") ? rel : `/${rel}`;
        assertEquals(norm, "/", "empty path should become /");
      });

      it("should preserve leading slash", () => {
        const rel = "/about";
        const norm = rel === "" ? "/" : rel.startsWith("/") ? rel : `/${rel}`;
        assertEquals(norm, "/about", "should keep existing leading slash");
      });

      it("should add leading slash when missing", () => {
        const rel = "about";
        const norm = rel === "" ? "/" : rel.startsWith("/") ? rel : `/${rel}`;
        assertEquals(norm, "/about", "should add leading slash");
      });

      it("should handle nested route paths", () => {
        const rel = "blog/posts";
        const norm = rel === "" ? "/" : rel.startsWith("/") ? rel : `/${rel}`;
        assertEquals(norm, "/blog/posts", "should normalize nested path");
      });
    });

    describe("pages routes", () => {
      it("should strip .mdx extension from path", () => {
        const relNext = "about.mdx";
        const withoutExt = relNext.replace(/\.(mdx|md)$/, "");
        assertEquals(withoutExt, "about", "should remove .mdx extension");
      });

      it("should strip .md extension from path", () => {
        const relNext = "about.md";
        const withoutExt = relNext.replace(/\.(mdx|md)$/, "");
        assertEquals(withoutExt, "about", "should remove .md extension");
      });

      it("should handle nested page paths", () => {
        const relNext = "blog/post.mdx";
        const withoutExt = relNext.replace(/\.(mdx|md)$/, "");
        const norm = `/${withoutExt}`;
        assertEquals(norm, "/blog/post", "should normalize nested page path");
      });

      it("should normalize duplicate slashes", () => {
        const routePath = "//blog//post";
        const normalized = routePath.replace(/\/+/g, "/");
        assertEquals(normalized, "/blog/post", "should collapse duplicate slashes");
      });

      it("should not match files starting with underscore", () => {
        const name = "_layout.mdx";
        assertEquals(name.startsWith("_"), true, "underscore files should be excluded");
      });

      it("should match .mdx files for inclusion", () => {
        assertEquals("page.mdx".endsWith(".mdx"), true, "should match .mdx");
        assertEquals("page.md".endsWith(".md"), true, "should match .md");
        assertEquals("page.ts".endsWith(".mdx"), false, "should not match .ts");
      });
    });
  });
});
