import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractParamName,
  extractParamsFromPattern,
  extractRelativePath,
  extractRouteParams,
  extractRouterBasePath,
  isCatchAllSegment,
  isDynamicRoute,
  isDynamicSegment,
  matchesPattern,
  removeFileExtension,
} from "./route-path-utils.ts";

describe("route-path-utils", () => {
  describe("isDynamicSegment", () => {
    it("should detect standard dynamic segments", () => {
      const segments = ["[id]", "[slug]", "[userId]"] as const;

      for (const segment of segments) {
        assertEquals(isDynamicSegment(segment), true);
      }
    });

    it("should detect catch-all segments", () => {
      const segments = ["[...slug]", "[...path]"] as const;

      for (const segment of segments) {
        assertEquals(isDynamicSegment(segment), true);
      }
    });

    it("should detect optional catch-all segments", () => {
      const segments = ["[[...slug]]", "[[...params]]"] as const;

      for (const segment of segments) {
        assertEquals(isDynamicSegment(segment), true);
      }
    });

    it("should detect file-style dynamic segments", () => {
      const segments = ["[id].tsx", "[slug].ts"] as const;

      for (const segment of segments) {
        assertEquals(isDynamicSegment(segment), true);
      }
    });

    it("should return false for static segments", () => {
      const segments = ["about", "users", "page.tsx"] as const;

      for (const segment of segments) {
        assertEquals(isDynamicSegment(segment), false);
      }
    });

    it("should return false for non-bracket strings", () => {
      const segments = ["", "normal"] as const;

      for (const segment of segments) {
        assertEquals(isDynamicSegment(segment), false);
      }
    });
  });

  describe("isDynamicRoute", () => {
    it("should detect routes with dynamic segments", () => {
      const routes = ["/users/[id]", "[...slug]", "/blog/[year]/[month]"] as const;

      for (const route of routes) {
        assertEquals(isDynamicRoute(route), true);
      }
    });

    it("should return false for static routes", () => {
      const routes = ["/about", "/users/list"] as const;

      for (const route of routes) {
        assertEquals(isDynamicRoute(route), false);
      }
    });
  });

  describe("isCatchAllSegment", () => {
    it("should detect catch-all segments", () => {
      const segments = ["[...slug]", "[...path]"] as const;

      for (const segment of segments) {
        assertEquals(isCatchAllSegment(segment), true);
      }
    });

    it("should detect optional catch-all segments", () => {
      assertEquals(isCatchAllSegment("[[...slug]]"), true);
    });

    it("should return false for standard dynamic segments", () => {
      const segments = ["[id]", "[slug]"] as const;

      for (const segment of segments) {
        assertEquals(isCatchAllSegment(segment), false);
      }
    });

    it("should return false for static segments", () => {
      assertEquals(isCatchAllSegment("about"), false);
    });
  });

  describe("removeFileExtension", () => {
    it("should remove known extensions", () => {
      const cases = [
        ["page.tsx", "page"],
        ["component.jsx", "component"],
        ["utils.ts", "utils"],
        ["script.js", "script"],
        ["content.mdx", "content"],
      ] as const;

      for (const [input, expected] of cases) {
        assertEquals(removeFileExtension(input), expected);
      }
    });

    it("should not modify paths without extensions", () => {
      const inputs = ["folder", "[id]"] as const;

      for (const input of inputs) {
        assertEquals(removeFileExtension(input), input);
      }
    });
  });

  describe("extractParamName", () => {
    it("should extract name from standard segments", () => {
      assertEquals(extractParamName("[id]"), "id");
      assertEquals(extractParamName("[slug]"), "slug");
    });

    it("should extract name from catch-all segments", () => {
      assertEquals(extractParamName("[...slug]"), "slug");
      assertEquals(extractParamName("[...path]"), "path");
    });

    it("should extract name from optional catch-all segments", () => {
      assertEquals(extractParamName("[[...slug]]"), "slug");
      assertEquals(extractParamName("[[...params]]"), "params");
    });
  });

  describe("extractRouterBasePath", () => {
    it("should detect app router paths", () => {
      const result = extractRouterBasePath("/project/app/page.tsx");
      assertEquals(result.type, "app");
      assertEquals(result.relativePath, "page.tsx");
    });

    it("should detect pages router paths", () => {
      const result = extractRouterBasePath("/project/pages/index.tsx");
      assertEquals(result.type, "pages");
      assertEquals(result.relativePath, "index.tsx");
    });

    it("should handle nested app router paths", () => {
      const result = extractRouterBasePath("/project/app/users/[id]/page.tsx");
      assertEquals(result.type, "app");
      assertEquals(result.relativePath, "users/[id]/page.tsx");
    });

    it("should return null for paths without router prefix", () => {
      const result = extractRouterBasePath("/project/components/Button.tsx");
      assertEquals(result.type, null);
      assertEquals(result.relativePath, null);
    });
  });

  describe("extractRouteParams", () => {
    it("should extract single dynamic param from app router", () => {
      const result = extractRouteParams("/app/users/[id]/page.tsx", "users/123");
      assertEquals(result.matched, true);
      assertEquals(result.params["id"], "123");
    });

    it("should extract multiple dynamic params", () => {
      const result = extractRouteParams(
        "/app/blog/[year]/[month]/page.tsx",
        "blog/2024/01",
      );
      assertEquals(result.matched, true);
      assertEquals(result.params["year"], "2024");
      assertEquals(result.params["month"], "01");
    });

    it("should extract catch-all params", () => {
      const result = extractRouteParams(
        "/app/docs/[...slug]/page.tsx",
        "docs/getting-started/intro",
      );
      assertEquals(result.matched, true);
      assertEquals(result.params["slug"], ["getting-started", "intro"]);
    });

    it("should return empty params for paths without router prefix", () => {
      const result = extractRouteParams("/components/Button.tsx", "button");
      assertEquals(result.matched, false);
      assertEquals(Object.keys(result.params).length, 0);
    });
  });

  describe("extractRelativePath", () => {
    it("should extract relative path from absolute path", () => {
      assertEquals(extractRelativePath("/project/src/file.ts", "/project"), "src/file.ts");
    });

    it("should handle paths that dont match project dir", () => {
      assertEquals(
        extractRelativePath("/other/path/file.ts", "/project"),
        "other/path/file.ts",
      );
    });

    it("should remove leading slash from result", () => {
      const result = extractRelativePath("/project/file.ts", "/project");
      assertEquals(result.startsWith("/"), false);
    });
  });

  describe("extractParamsFromPattern", () => {
    it("should extract single param", () => {
      assertEquals(extractParamsFromPattern("[id]", "123"), { id: "123" });
    });

    it("should extract multiple params", () => {
      assertEquals(extractParamsFromPattern("[year]/[month]", "2024/01"), {
        year: "2024",
        month: "01",
      });
    });

    it("should extract catch-all params", () => {
      assertEquals(extractParamsFromPattern("[...slug]", "a/b/c"), {
        slug: ["a", "b", "c"],
      });
    });

    it("should handle mixed static and dynamic segments", () => {
      assertEquals(extractParamsFromPattern("users/[id]/posts", "users/123/posts"), {
        id: "123",
      });
    });

    it("should return null for non-matching static segments", () => {
      assertEquals(extractParamsFromPattern("users/list", "users/detail"), null);
    });

    it("should return null for length mismatch without catch-all", () => {
      assertEquals(extractParamsFromPattern("[id]", "a/b"), null);
    });

    it("should handle empty slug parts", () => {
      assertEquals(extractParamsFromPattern("[id]", "123"), { id: "123" });
    });
  });

  describe("matchesPattern", () => {
    it("should return true for matching patterns", () => {
      const cases = [
        ["[id]", "123"],
        ["users/[id]", "users/123"],
      ] as const;

      for (const [pattern, path] of cases) {
        assertEquals(matchesPattern(pattern, path), true);
      }
    });

    it("should return false for non-matching patterns", () => {
      const cases = [
        ["users/list", "users/detail"],
        ["[id]", "a/b"],
      ] as const;

      for (const [pattern, path] of cases) {
        assertEquals(matchesPattern(pattern, path), false);
      }
    });

    it("should match catch-all patterns", () => {
      assertEquals(matchesPattern("[...slug]", "a/b/c"), true);
    });
  });
});
