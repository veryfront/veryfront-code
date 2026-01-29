import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { collectAncestorDirs, RESERVED_COMPONENTS } from "./app-reserved.ts";

describe("rendering/app-reserved", () => {
  describe("RESERVED_COMPONENTS", () => {
    it("should define loading, error, and notFound components", () => {
      assertEquals(RESERVED_COMPONENTS.loading, "loading.tsx");
      assertEquals(RESERVED_COMPONENTS.error, "error.tsx");
      assertEquals(RESERVED_COMPONENTS.notFound, "not-found.tsx");
    });
  });

  describe("collectAncestorDirs", () => {
    it("should collect dirs from segment to root", () => {
      const dirs = collectAncestorDirs("/app/blog/posts", "/app");
      assertEquals(dirs.includes("/app/blog/posts"), true);
      assertEquals(dirs.includes("/app/blog"), true);
      assertEquals(dirs.includes("/app"), true);
    });

    it("should return only segment dir when at root", () => {
      const dirs = collectAncestorDirs("/app", "/app");
      assertEquals(dirs, ["/app"]);
    });

    it("should handle deeply nested paths", () => {
      const dirs = collectAncestorDirs("/project/app/a/b/c", "/project/app");
      assertEquals(dirs.length, 4);
      const first = dirs[0];
      const last = dirs[dirs.length - 1];
      assertExists(first);
      assertExists(last);
      assertEquals(first, "/project/app/a/b/c");
      assertEquals(last, "/project/app");
    });

    it("should stop at app root boundary", () => {
      const dirs = collectAncestorDirs("/project/app/page", "/project/app");
      for (const dir of dirs) {
        assertEquals(dir.startsWith("/project/app"), true);
      }
    });

    it("should normalize trailing slashes", () => {
      const dirs = collectAncestorDirs("/app/blog/", "/app");
      const first = dirs[0];
      assertExists(first);
      assertEquals(first.endsWith("/"), false);
    });
  });
});
