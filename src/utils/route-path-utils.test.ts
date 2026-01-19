import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
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
      assertEquals(isDynamicSegment("[id]"), true);
      assertEquals(isDynamicSegment("[slug]"), true);
      assertEquals(isDynamicSegment("[userId]"), true);
    });

    it("should detect catch-all segments", () => {
      assertEquals(isDynamicSegment("[...slug]"), true);
      assertEquals(isDynamicSegment("[...path]"), true);
    });

    it("should detect optional catch-all segments", () => {
      assertEquals(isDynamicSegment("[[...slug]]"), true);
      assertEquals(isDynamicSegment("[[...params]]"), true);
    });

    it("should detect file-style dynamic segments", () => {
      assertEquals(isDynamicSegment("[id].tsx"), true);
      assertEquals(isDynamicSegment("[slug].ts"), true);
    });

    it("should return false for static segments", () => {
      assertEquals(isDynamicSegment("about"), false);
      assertEquals(isDynamicSegment("users"), false);
      assertEquals(isDynamicSegment("page.tsx"), false);
    });

    it("should return false for non-bracket strings", () => {
      assertEquals(isDynamicSegment(""), false);
      assertEquals(isDynamicSegment("normal"), false);
    });
  });

  describe("isDynamicRoute", () => {
    it("should detect routes with dynamic segments", () => {
      assertEquals(isDynamicRoute("/users/[id]"), true);
      assertEquals(isDynamicRoute("[...slug]"), true);
      assertEquals(isDynamicRoute("/blog/[year]/[month]"), true);
    });

    it("should return false for static routes", () => {
      assertEquals(isDynamicRoute("/about"), false);
      assertEquals(isDynamicRoute("/users/list"), false);
    });
  });

  describe("isCatchAllSegment", () => {
    it("should detect catch-all segments", () => {
      assertEquals(isCatchAllSegment("[...slug]"), true);
      assertEquals(isCatchAllSegment("[...path]"), true);
    });

    it("should detect optional catch-all segments", () => {
      assertEquals(isCatchAllSegment("[[...slug]]"), true);
    });

    it("should return false for standard dynamic segments", () => {
      assertEquals(isCatchAllSegment("[id]"), false);
      assertEquals(isCatchAllSegment("[slug]"), false);
    });

    it("should return false for static segments", () => {
      assertEquals(isCatchAllSegment("about"), false);
    });
  });

  describe("removeFileExtension", () => {
    it("should remove tsx extension", () => {
      assertEquals(removeFileExtension("page.tsx"), "page");
    });

    it("should remove jsx extension", () => {
      assertEquals(removeFileExtension("component.jsx"), "component");
    });

    it("should remove ts extension", () => {
      assertEquals(removeFileExtension("utils.ts"), "utils");
    });

    it("should remove js extension", () => {
      assertEquals(removeFileExtension("script.js"), "script");
    });

    it("should remove mdx extension", () => {
      assertEquals(removeFileExtension("content.mdx"), "content");
    });

    it("should not modify paths without extensions", () => {
      assertEquals(removeFileExtension("folder"), "folder");
      assertEquals(removeFileExtension("[id]"), "[id]");
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
      const result = extractRelativePath("/project/src/file.ts", "/project");
      assertEquals(result, "src/file.ts");
    });

    it("should handle paths that dont match project dir", () => {
      const result = extractRelativePath("/other/path/file.ts", "/project");
      assertEquals(result, "other/path/file.ts");
    });

    it("should remove leading slash from result", () => {
      const result = extractRelativePath("/project/file.ts", "/project");
      assertEquals(result.startsWith("/"), false);
    });
  });

  describe("extractParamsFromPattern", () => {
    it("should extract single param", () => {
      const result = extractParamsFromPattern("[id]", "123");
      assertEquals(result, { id: "123" });
    });

    it("should extract multiple params", () => {
      const result = extractParamsFromPattern("[year]/[month]", "2024/01");
      assertEquals(result, { year: "2024", month: "01" });
    });

    it("should extract catch-all params", () => {
      const result = extractParamsFromPattern("[...slug]", "a/b/c");
      assertEquals(result, { slug: ["a", "b", "c"] });
    });

    it("should handle mixed static and dynamic segments", () => {
      const result = extractParamsFromPattern("users/[id]/posts", "users/123/posts");
      assertEquals(result, { id: "123" });
    });

    it("should return null for non-matching static segments", () => {
      const result = extractParamsFromPattern("users/list", "users/detail");
      assertEquals(result, null);
    });

    it("should return null for length mismatch without catch-all", () => {
      const result = extractParamsFromPattern("[id]", "a/b");
      assertEquals(result, null);
    });

    it("should handle empty slug parts", () => {
      const result = extractParamsFromPattern("[id]", "123");
      assertEquals(result, { id: "123" });
    });
  });

  describe("matchesPattern", () => {
    it("should return true for matching patterns", () => {
      assertEquals(matchesPattern("[id]", "123"), true);
      assertEquals(matchesPattern("users/[id]", "users/123"), true);
    });

    it("should return false for non-matching patterns", () => {
      assertEquals(matchesPattern("users/list", "users/detail"), false);
      assertEquals(matchesPattern("[id]", "a/b"), false);
    });

    it("should match catch-all patterns", () => {
      assertEquals(matchesPattern("[...slug]", "a/b/c"), true);
    });
  });
});
