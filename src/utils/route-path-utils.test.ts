import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  compareRouteSpecificity,
  compileRoutePattern,
  extractParamName,
  extractParamsFromPattern,
  extractRelativePath,
  extractRouteParams,
  extractRouterBasePath,
  isCatchAllSegment,
  isDynamicRoute,
  isDynamicSegment,
  isInterceptionRouteSegment,
  isRouteGroupSegment,
  matchesPattern,
  matchRoutePattern,
  removeFileExtension,
} from "./route-path-utils.ts";

describe("route-path-utils", () => {
  describe("isDynamicSegment", () => {
    it("should detect standard dynamic segments", () => {
      const segments = [
        "[id]",
        "[slug]",
        "[userId]",
        "[version.number]",
        "[user-id]",
        "[användare]",
      ] as const;

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

  describe("isRouteGroupSegment", () => {
    it("should detect complete App Router route-group segments", () => {
      assertEquals(isRouteGroupSegment("(marketing)"), true);
      assertEquals(isRouteGroupSegment("(internal-tools)"), true);
    });

    it("should reject partial groups and ordinary parenthesized path content", () => {
      assertEquals(isRouteGroupSegment("(marketing"), false);
      assertEquals(isRouteGroupSegment("marketing)"), false);
      assertEquals(isRouteGroupSegment("product-(legacy)"), false);
    });

    it("does not classify interception markers as route groups", () => {
      for (const segment of ["(.)", "(..)", "(...)", "(.)photo", "(..)(..)photo"]) {
        assertEquals(isInterceptionRouteSegment(segment), true);
        assertEquals(isRouteGroupSegment(segment), false);
      }
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

    it("should reject slugs whose static segments do not match", () => {
      const result = extractRouteParams(
        "/app/users/[id]/page.tsx",
        "admins/123",
      );
      assertEquals(result, { params: {}, matched: false });
    });

    it("preserves App Router directories named page", () => {
      assertEquals(
        extractRouteParams("/repo/app/page/[id]/page.tsx", "page/123"),
        { params: { id: "123" }, matched: true },
      );
    });

    it("preserves App Router directories named route", () => {
      assertEquals(
        extractRouteParams("/repo/app/route/[id]/page.tsx", "route/123"),
        { params: { id: "123" }, matched: true },
      );
    });

    it("removes only a terminal Pages Router index file", () => {
      assertEquals(
        extractRouteParams("/repo/pages/blog/[slug]/index.tsx", "blog/hello"),
        { params: { slug: "hello" }, matched: true },
      );
      assertEquals(
        extractRouteParams("/repo/pages/index/[id].tsx", "index/123"),
        { params: { id: "123" }, matched: true },
      );
    });

    it("extracts Pages Router catch-alls below nested index files", () => {
      assertEquals(
        extractRouteParams(
          "/repo/pages/docs/[...slug]/index.tsx",
          "docs/api/reference",
        ),
        { params: { slug: ["api", "reference"] }, matched: true },
      );
      assertEquals(
        extractRouteParams("/repo/pages/docs/[[...slug]]/index.tsx", "docs"),
        { params: { slug: [] }, matched: true },
      );
    });

    it("omits App Router route groups while extracting dynamic params", () => {
      assertEquals(
        extractRouteParams(
          "/repo/app/(marketing)/(published)/blog/[slug]/page.tsx",
          "blog/hello",
        ),
        { params: { slug: "hello" }, matched: true },
      );
    });

    it("matches the outer router root when a route contains a nested root name", () => {
      assertEquals(
        extractRouteParams(
          "/repo/app/foo/app/[user-id]/page.tsx",
          "foo/app/42",
        ),
        { params: { "user-id": "42" }, matched: true },
      );
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

    it("should not strip a project directory that is only a string prefix", () => {
      assertEquals(
        extractRelativePath("/project-backup/src/file.ts", "/project"),
        "project-backup/src/file.ts",
      );
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

    it("should preserve dots in dynamic parameter names", () => {
      assertEquals(extractParamsFromPattern("api/[version.number]", "api/1.0"), {
        "version.number": "1.0",
      });
    });

    it("preserves hyphenated and Unicode parameter names", () => {
      assertEquals(extractParamsFromPattern("users/[user-id]", "users/42"), {
        "user-id": "42",
      });
      assertEquals(extractParamsFromPattern("users/[användare]", "users/anna"), {
        användare: "anna",
      });
    });

    it("returns reserved object-property parameter names as own data", () => {
      const params = extractParamsFromPattern("users/[__proto__]", "users/42");

      assertEquals(Object.hasOwn(params ?? {}, "__proto__"), true);
      assertEquals(params?.["__proto__"], "42");
      assertEquals(Object.getPrototypeOf(params), Object.prototype);
    });

    it("should extract catch-all params", () => {
      assertEquals(extractParamsFromPattern("[...slug]", "a/b/c"), {
        slug: ["a", "b", "c"],
      });
    });

    it("should require at least one segment for a required catch-all", () => {
      assertEquals(extractParamsFromPattern("docs/[...slug]", "docs"), null);
    });

    it("should allow an empty optional catch-all", () => {
      assertEquals(extractParamsFromPattern("docs/[[...slug]]", "docs"), {
        slug: [],
      });
    });

    it("should backtrack an optional catch-all to match a suffix", () => {
      assertEquals(
        extractParamsFromPattern("docs/[[...slug]]/edit", "docs/edit"),
        { slug: [] },
      );
      assertEquals(
        extractParamsFromPattern(
          "docs/[[...slug]]/edit",
          "docs/api/reference/edit",
        ),
        { slug: ["api", "reference"] },
      );
    });

    it("should match trailing segments after a required catch-all", () => {
      assertEquals(
        extractParamsFromPattern("docs/[...slug]/edit", "docs/api/reference/edit"),
        { slug: ["api", "reference"] },
      );
    });

    it("should reject catch-all routes whose trailing segment does not match", () => {
      assertEquals(
        extractParamsFromPattern("docs/[...slug]/edit", "docs/api/reference/view"),
        null,
      );
      assertEquals(
        extractParamsFromPattern("docs/[...slug]/edit", "docs/edit"),
        null,
      );
    });

    it("matches the canonical router's catch-all suffix semantics", () => {
      const cases: Array<{
        pattern: string;
        slug: string;
        expected: Record<string, string | string[]> | null;
      }> = [
        {
          pattern: "docs/[...slug]/edit",
          slug: "docs/topic/edit/edit",
          expected: { slug: ["topic", "edit"] },
        },
        {
          pattern: "[...path]/download/[file]",
          slug: "assets/images/download/logo.svg",
          expected: { path: ["assets", "images"], file: "logo.svg" },
        },
        {
          pattern: "[...path]/download/[file]",
          slug: "download/logo.svg",
          expected: null,
        },
      ];

      for (const { pattern, slug, expected } of cases) {
        assertEquals(extractParamsFromPattern(pattern, slug), expected);
        assertEquals(matchesPattern(pattern, slug), expected !== null);
      }
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

    it("rejects ambiguous multi-catch-all patterns in bounded time", () => {
      const pattern = new Array(8).fill("[...part]").join("/");
      const slug = new Array(18).fill("segment").join("/");

      assertEquals(compileRoutePattern(pattern).valid, false);
      assertEquals(extractParamsFromPattern(pattern, slug), null);
    });

    it("bounds pattern and slug input lengths", () => {
      const oversized = "a".repeat(4097);
      assertEquals(compileRoutePattern(oversized).valid, false);
      assertEquals(extractParamsFromPattern("[value]", oversized), null);
    });

    it("returns independent catch-all arrays across calls", () => {
      const first = extractParamsFromPattern("docs/[...slug]", "docs/a/b");
      const firstSlug = first?.slug;
      if (Array.isArray(firstSlug)) firstSlug.push("mutated");

      assertEquals(extractParamsFromPattern("docs/[...slug]", "docs/a/b"), {
        slug: ["a", "b"],
      });
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

  describe("route specificity", () => {
    it("ranks a static suffix after an empty optional catch-all structurally", () => {
      const suffix = matchRoutePattern("docs/[[...slug]]/edit", "docs/edit");
      const dynamic = matchRoutePattern("docs/[page]", "docs/edit");

      assertEquals(suffix !== null, true);
      assertEquals(dynamic !== null, true);
      assertEquals(
        compareRouteSpecificity(suffix!.specificity, dynamic!.specificity) > 0,
        true,
      );
    });

    it("distinguishes specificity beyond floating-point precision", () => {
      const prefix = Array.from({ length: 18 }, (_, index) => `[part${index}]`);
      const slug = [...new Array(18).fill("value"), "fixed"].join("/");
      const staticTail = matchRoutePattern([...prefix, "fixed"].join("/"), slug);
      const dynamicTail = matchRoutePattern([...prefix, "[tail]"].join("/"), slug);

      assertEquals(staticTail !== null, true);
      assertEquals(dynamicTail !== null, true);
      assertEquals(
        compareRouteSpecificity(staticTail!.specificity, dynamicTail!.specificity) > 0,
        true,
      );
    });
  });
});
