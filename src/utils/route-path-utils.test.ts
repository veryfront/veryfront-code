import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  containsPathControlCharacters,
  extractParamName,
  extractParamsFromPattern,
  extractRelativePath,
  extractRouteParams,
  extractRouterBasePath,
  isCatchAllSegment,
  isDynamicRoute,
  isDynamicSegment,
  matchesPattern,
  parseRouteParameterSegment,
  removeFileExtension,
} from "./route-path-utils.ts";

describe("route-path-utils", () => {
  describe("containsPathControlCharacters", () => {
    it("rejects C0, DEL, and C1 control characters", () => {
      assertEquals(containsPathControlCharacters("a\u0000b"), true, "NUL must be rejected");
      assertEquals(containsPathControlCharacters("a\u001fb"), true, "C0 controls must be rejected");
      assertEquals(containsPathControlCharacters("a\u007fb"), true, "DEL must be rejected");
      assertEquals(containsPathControlCharacters("a\u0080b"), true, "C1 start must be rejected");
      assertEquals(containsPathControlCharacters("a\u009fb"), true, "C1 end must be rejected");
    });

    it("accepts printable paths", () => {
      assertEquals(
        containsPathControlCharacters("a-b_c.tsx"),
        false,
        "printable ASCII paths must pass",
      );
      assertEquals(
        containsPathControlCharacters("café.tsx"),
        false,
        "printable non-ASCII paths must pass",
      );
    });
  });

  describe("isDynamicSegment", () => {
    it("should detect standard dynamic segments", () => {
      const segments = ["[id]", "[slug]", "[userId]", "[version.number]", "[post-id]"] as const;

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
      const segments = ["[[...slug]]", "[[...params]]", "[[...slug]].tsx"] as const;

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

  describe("parseRouteParameterSegment", () => {
    it("parses supported dynamic segment forms and file suffixes", () => {
      assertEquals(parseRouteParameterSegment("[id]"), {
        name: "id",
        kind: "dynamic",
        suffix: "",
      });
      assertEquals(parseRouteParameterSegment("[version.number]"), {
        name: "version.number",
        kind: "dynamic",
        suffix: "",
      });
      assertEquals(parseRouteParameterSegment("[...path].MDX"), {
        name: "path",
        kind: "catch-all",
        suffix: ".MDX",
      });
      assertEquals(parseRouteParameterSegment("[[...slug]].tsx"), {
        name: "slug",
        kind: "optional-catch-all",
        suffix: ".tsx",
      });
    });

    it("rejects incomplete or unsafe parameter syntax", () => {
      const invalid = [
        "[]",
        "[...].tsx",
        "[[...slug].tsx",
        "[a/b].tsx",
        "[a\\b].tsx",
        "[my param].tsx",
        "[slug!].tsx",
        "[.slug].tsx",
        "[slug.].tsx",
        "[slug..part].tsx",
        "[id]tsx",
        "[slug].draft",
        "[slug].draft.mdx",
        "[id]\n.tsx",
      ] as const;

      for (const segment of invalid) {
        assertEquals(parseRouteParameterSegment(segment), null);
      }
    });

    it("parses hyphenated parameter names", () => {
      assertEquals(parseRouteParameterSegment("[post-id]"), {
        name: "post-id",
        kind: "dynamic",
        suffix: "",
      });
      assertEquals(parseRouteParameterSegment("[post-id].tsx"), {
        name: "post-id",
        kind: "dynamic",
        suffix: ".tsx",
      });
    });
  });

  describe("isDynamicRoute", () => {
    it("should detect routes with dynamic segments", () => {
      const routes = [
        "/users/[id]",
        "[...slug]",
        "/blog/[year]/[month]",
        "/api/[version.number]",
      ] as const;

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
      assertEquals(extractParamName("[version.number]"), "version.number");
    });

    it("should extract name from catch-all segments", () => {
      assertEquals(extractParamName("[...slug]"), "slug");
      assertEquals(extractParamName("[...path]"), "path");
    });

    it("should extract name from optional catch-all segments", () => {
      assertEquals(extractParamName("[[...slug]]"), "slug");
      assertEquals(extractParamName("[[...params]]"), "params");
      assertEquals(extractParamName("[[...params]].tsx"), "params");
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

    it("detects configured router roots", () => {
      const result = extractRouterBasePath(
        "/project/src/routes/users/[id]/page.tsx",
        { app: "src/routes", pages: "src/legacy-pages" },
      );

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

    it("extracts optional catch-all params with zero remaining segments", () => {
      const result = extractRouteParams(
        "/app/docs/[[...slug]]/page.tsx",
        "docs",
      );

      assertEquals(result.matched, true);
      assertEquals(result.params["slug"], []);
    });

    it("does not match an optional catch-all whose static prefix differs", () => {
      const result = extractRouteParams("/app/docs/[[...slug]]/page.tsx", "blog");

      assertEquals(
        result.matched,
        false,
        "optional catch-all must not match a different static prefix",
      );
      assertEquals(
        Object.keys(result.params).length,
        0,
        "no slug param is produced for a non-matching prefix",
      );
    });

    it("matches an optional catch-all behind a dynamic segment", () => {
      const result = extractRouteParams("/app/docs/[lang]/[[...slug]]/page.tsx", "docs/en");

      assertEquals(result.matched, true, "a dynamic segment satisfies the static prefix check");
      assertEquals(result.params["lang"], "en", "the dynamic segment is still extracted");
      assertEquals(result.params["slug"], [], "the optional catch-all resolves to zero segments");
    });

    it("preserves __proto__ route params without changing the params prototype", () => {
      const dynamic = extractRouteParams("/app/users/[__proto__]/page.tsx", "users/123");
      assertEquals(dynamic.matched, true);
      assertEquals(dynamic.params["__proto__"], "123");
      assertEquals(Object.getPrototypeOf(dynamic.params), null);

      const catchAll = extractRouteParams(
        "/app/docs/[...__proto__]/page.tsx",
        "docs/a/b",
      );
      assertEquals(catchAll.matched, true);
      assertEquals(catchAll.params["__proto__"], ["a", "b"]);
      assertEquals(Object.getPrototypeOf(catchAll.params), null);
    });

    it("extracts params from configured router roots", () => {
      const result = extractRouteParams(
        "/project/src/legacy-pages/users/[id].tsx",
        "users/123",
        { app: "src/routes", pages: "src/legacy-pages" },
      );

      assertEquals(result.matched, true);
      assertEquals(result.params["id"], "123");
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

    it("preserves __proto__ pattern params without changing the params prototype", () => {
      const dynamic = extractParamsFromPattern("[__proto__]", "123");
      assertEquals(dynamic?.["__proto__"], "123");
      assertEquals(Object.getPrototypeOf(dynamic), null);

      const catchAll = extractParamsFromPattern("[...__proto__]", "a/b");
      assertEquals(catchAll?.["__proto__"], ["a", "b"]);
      assertEquals(Object.getPrototypeOf(catchAll), null);
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
