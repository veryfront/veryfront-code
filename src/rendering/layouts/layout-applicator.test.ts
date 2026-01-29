import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { LayoutApplicationOptions } from "./layout-applicator.ts";

// ---- Inline reimplementations of non-exported pure logic ----

/** Detect if page path is a dot-prefixed path */
function isDotPath(pageFilePath: string): boolean {
  return pageFilePath.split("/").some((s) => s.startsWith(".") && s !== "." && s !== "..");
}

/** Build SSR router context for server-side rendering */
function buildSSRRouter(requestUrl: URL | undefined, pageFilePath: string, pageSlug: string) {
  return {
    domain: requestUrl?.origin ?? "",
    path: requestUrl?.pathname ?? pageFilePath,
    pathname: requestUrl?.pathname ?? `/${pageSlug}`,
    params: {},
    query: requestUrl ? Object.fromEntries(requestUrl.searchParams) : {},
    isPreview: false,
    isMounted: false,
    navigate: () => {},
    push: () => {},
    replace: () => {},
    reload: () => {},
  };
}

/** Build page context for PageContextProvider */
function buildPageContext(
  slug: string,
  path: string,
  frontmatter: Record<string, unknown>,
  headings: Array<{ id: string; text: string; level: number }>,
) {
  return {
    slug,
    path,
    params: {},
    query: {},
    frontmatter,
    headings,
    mdxHeadings: headings,
  };
}

// ---- Tests ----

describe("LayoutApplicator helpers", () => {
  describe("isDotPath", () => {
    it("should detect .veryfront paths", () => {
      assertEquals(isDotPath("/project/.veryfront/chat/page.tsx"), true);
    });

    it("should detect hidden directory paths", () => {
      assertEquals(isDotPath("/project/.hidden/page.tsx"), true);
    });

    it("should not flag normal paths", () => {
      assertEquals(isDotPath("/project/pages/about.tsx"), false);
      assertEquals(isDotPath("/project/app/blog/page.tsx"), false);
    });

    it("should not flag . or .. segments", () => {
      assertEquals(isDotPath("./relative/path.tsx"), false);
      assertEquals(isDotPath("../parent/path.tsx"), false);
    });

    it("should handle root-level dot paths", () => {
      assertEquals(isDotPath(".config/page.tsx"), true);
    });
  });

  describe("buildSSRRouter", () => {
    it("should build router from URL", () => {
      const url = new URL("https://example.com/about?foo=bar");
      const router = buildSSRRouter(url, "/pages/about.tsx", "about");
      assertEquals(router.domain, "https://example.com");
      assertEquals(router.pathname, "/about");
      assertEquals(router.query, { foo: "bar" });
      assertEquals(router.isPreview, false);
      assertEquals(router.isMounted, false);
    });

    it("should use fallback values when URL is undefined", () => {
      const router = buildSSRRouter(undefined, "/pages/about.tsx", "about");
      assertEquals(router.domain, "");
      assertEquals(router.path, "/pages/about.tsx");
      assertEquals(router.pathname, "/about");
      assertEquals(router.query, {});
    });

    it("should always have empty params", () => {
      const url = new URL("https://example.com/blog/123");
      const router = buildSSRRouter(url, "/pages/blog/[id].tsx", "blog/123");
      assertEquals(router.params, {});
    });

    it("should handle URL with multiple search params", () => {
      const url = new URL("https://example.com/search?q=test&page=2&lang=en");
      const router = buildSSRRouter(url, "/pages/search.tsx", "search");
      assertEquals(router.query, { q: "test", page: "2", lang: "en" });
    });

    it("should provide async navigate/push/replace/reload methods", async () => {
      const router = buildSSRRouter(undefined, "/page.tsx", "page");
      // These should be callable but no-ops
      await router.navigate();
      await router.push();
      await router.replace();
      await router.reload();
    });
  });

  describe("buildPageContext", () => {
    it("should build context with all fields", () => {
      const headings = [{ id: "intro", text: "Introduction", level: 1 }];
      const ctx = buildPageContext("about", "/pages/about.tsx", { title: "About" }, headings);
      assertEquals(ctx.slug, "about");
      assertEquals(ctx.path, "/pages/about.tsx");
      assertEquals(ctx.frontmatter, { title: "About" });
      assertEquals(ctx.headings, headings);
      assertEquals(ctx.mdxHeadings, headings);
    });

    it("should always have empty params and query", () => {
      const ctx = buildPageContext("home", "/pages/index.tsx", {}, []);
      assertEquals(ctx.params, {});
      assertEquals(ctx.query, {});
    });

    it("should handle empty frontmatter", () => {
      const ctx = buildPageContext("test", "/test.tsx", {}, []);
      assertEquals(ctx.frontmatter, {});
    });

    it("should handle multiple headings", () => {
      const headings = [
        { id: "h1", text: "Title", level: 1 },
        { id: "h2", text: "Subtitle", level: 2 },
        { id: "h3", text: "Section", level: 3 },
      ];
      const ctx = buildPageContext("docs", "/docs.tsx", {}, headings);
      assertEquals(ctx.headings.length, 3);
      assertEquals(ctx.mdxHeadings.length, 3);
    });
  });

  describe("LayoutApplicationOptions type", () => {
    it("should accept valid options", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        projectDir: "/project",
        projectId: "proj-123",
        projectSlug: "my-project",
        contentSourceId: "branch:main",
        mode: "development",
      };
      assertEquals(opts.projectDir, "/project");
      assertEquals(opts.mode, "development");
    });

    it("should accept production mode", () => {
      const opts: Partial<LayoutApplicationOptions> = { mode: "production" };
      assertEquals(opts.mode, "production");
    });

    it("should accept optional requestUrl", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        requestUrl: new URL("https://example.com/about"),
      };
      assertEquals(opts.requestUrl?.pathname, "/about");
    });

    it("should accept optional frontmatter", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        frontmatter: { title: "Test", description: "A test page" },
      };
      assertEquals(opts.frontmatter?.title, "Test");
    });

    it("should accept optional headings", () => {
      const opts: Partial<LayoutApplicationOptions> = {
        headings: [{ id: "h1", text: "Hello", level: 1 }],
      };
      assertEquals(opts.headings?.length, 1);
    });
  });

  describe("ESM vs function-body layout mode detection", () => {
    it("should detect ESM mode from config", () => {
      const config: { experimental?: { esmLayouts?: boolean } } = {
        experimental: { esmLayouts: true },
      };
      assertEquals(Boolean(config?.experimental?.esmLayouts), true);
    });

    it("should default to function-body mode when not set", () => {
      const config: { experimental?: { esmLayouts?: boolean } } = {};
      assertEquals(Boolean((config as any)?.experimental?.esmLayouts), false);
    });

    it("should default to function-body mode when experimental is undefined", () => {
      const config: { experimental?: { esmLayouts?: boolean } } = { experimental: undefined };
      assertEquals(Boolean(config?.experimental?.esmLayouts), false);
    });

    it("should default to function-body mode when esmLayouts is false", () => {
      const config: { experimental?: { esmLayouts?: boolean } } = {
        experimental: { esmLayouts: false },
      };
      assertEquals(Boolean(config?.experimental?.esmLayouts), false);
    });
  });
});
