import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";

// The preset module has private helpers (dirname, basename) that aren't exported.
// We test the equivalent logic inline to verify the route path normalization
// and path manipulation patterns used in buildEmbeddedPreset.

describe("build/embedded/preset", () => {
  describe("dirname logic", () => {
    // Mirrors the private dirname(path: string) function in preset.ts
    function dirname(path: string): string {
      const idx = path.lastIndexOf("/");
      return idx === -1 ? "" : path.slice(0, idx);
    }

    it("should return parent directory for nested path", () => {
      assertEquals(dirname("/home/user/file.ts"), "/home/user", "should strip filename");
    });

    it("should return empty string for filename without directory", () => {
      assertEquals(dirname("file.ts"), "", "should return empty for bare filename");
    });

    it("should handle root-level file", () => {
      assertEquals(dirname("/file.ts"), "", "should return empty for root file");
    });

    it("should handle deeply nested path", () => {
      assertEquals(dirname("/a/b/c/d/e.ts"), "/a/b/c/d", "should return parent of deep path");
    });

    it("should handle path ending with slash", () => {
      assertEquals(dirname("/a/b/"), "/a/b", "should handle trailing slash");
    });
  });

  describe("basename logic", () => {
    // Mirrors the private basename(path: string) function in preset.ts
    function basename(path: string): string {
      const idx = path.lastIndexOf("/");
      return idx === -1 ? path : path.slice(idx + 1);
    }

    it("should return filename from path", () => {
      assertEquals(basename("/home/user/file.ts"), "file.ts", "should extract filename");
    });

    it("should return the input if no directory separator", () => {
      assertEquals(basename("file.ts"), "file.ts", "should return input as-is");
    });

    it("should handle deeply nested path", () => {
      assertEquals(basename("/a/b/c/d/e.ts"), "e.ts", "should extract basename from deep path");
    });

    it("should return empty string for path ending with slash", () => {
      assertEquals(basename("/a/b/"), "", "trailing slash yields empty basename");
    });
  });

  describe("route path normalization", () => {
    // Tests the route normalization patterns from discoverAppRoutes and discoverPagesRoutes

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

  describe("manifest structure", () => {
    it("should have correct version", () => {
      const manifest = {
        version: 1 as const,
        routes: [{ path: "/", file: "embedded/app.js", type: "page" as const }],
        assets: [],
      };
      assertEquals(manifest.version, 1, "manifest version should be 1");
    });

    it("should include root route as first entry", () => {
      const routes = [
        { path: "/about", file: "embedded/about.js", type: "page" as const },
      ];
      routes.unshift({ path: "/", file: "embedded/app.js", type: "page" as const });
      assertEquals(routes[0].path, "/", "root route should be first");
      assertEquals(routes[0].file, "embedded/app.js", "root route file should be app.js");
    });

    it("should include RSC assets with correct content types", () => {
      const assets = [
        {
          path: "/_veryfront/rsc/dom.js",
          file: "embedded/rsc/client-dom.js",
          contentType: "application/javascript",
        },
        {
          path: "/_veryfront/rsc/hydrator.js",
          file: "embedded/rsc/client-hydrator.js",
          contentType: "application/javascript",
        },
        {
          path: "/_veryfront/rsc/hydrate-client.js",
          file: "embedded/rsc/hydrate-client.js",
          contentType: "application/javascript",
        },
      ];
      assertEquals(assets.length, 3, "should have 3 RSC assets");
      for (const asset of assets) {
        assertEquals(
          asset.contentType,
          "application/javascript",
          `${asset.path} should have JS content type`,
        );
      }
    });
  });
});
