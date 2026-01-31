import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRendererScript } from "./renderer.ts";

describe("hydration-script-builder/templates/renderer", () => {
  describe("getRendererScript", () => {
    function assertIncludes(result: string, substring: string): void {
      assertEquals(result.includes(substring), true);
    }

    it("should return a non-empty string", () => {
      const result = getRendererScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define async renderPage function", () => {
      assertIncludes(getRendererScript(), "async function renderPage(pathname)");
    });

    it("should look for veryfront-hydration-data script element", () => {
      assertIncludes(getRendererScript(), "getElementById('veryfront-hydration-data')");
    });

    it("should parse hydration data as JSON", () => {
      assertIncludes(getRendererScript(), "JSON.parse");
    });

    it("should handle studioEmbed flag", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.studioEmbed");
      assertIncludes(result, "__veryfrontSetStudioEmbed");
    });

    it("should use pathToModuleUrl for page loading", () => {
      assertIncludes(getRendererScript(), "pathToModuleUrl(data.pagePath");
    });

    it("should fallback to Pages Router pattern", () => {
      assertIncludes(getRendererScript(), "Falling back to Pages Router pattern");
    });

    it("should handle root path in fallback", () => {
      assertIncludes(getRendererScript(), "pathname === '/' ? 'index' : pathname.slice(1)");
    });

    it("should get PageComponent from default export", () => {
      assertIncludes(getRendererScript(), "pageModule.default || pageModule");
    });

    it("should merge props with params", () => {
      assertIncludes(getRendererScript(), "...(data.props || {}), params: data.params || {}");
    });

    it("should wrap with layouts from innermost to outermost", () => {
      assertIncludes(getRendererScript(), "layouts.length - 1; i >= 0; i--");
    });

    it("should wrap with App component when appPath is provided", () => {
      const result = getRendererScript();
      assertIncludes(result, "data.appPath");
      assertIncludes(result, "loadComponent(data.appPath)");
    });

    it("should build page context with slug, path, params, query, frontmatter, and headings", () => {
      const result = getRendererScript();
      assertIncludes(result, "slug: data.slug");
      assertIncludes(result, "path: data.pagePath");
      assertIncludes(result, "params: data.params");
      assertIncludes(result, "frontmatter: data.frontmatter");
      assertIncludes(result, "headings,");
    });

    it("should include mdxHeadings alias for backwards compatibility", () => {
      assertIncludes(getRendererScript(), "mdxHeadings: headings");
    });

    it("should wrap with PageContextProvider", () => {
      assertIncludes(getRendererScript(), "PageContextProvider");
    });

    it("should wrap with RouterProvider", () => {
      assertIncludes(getRendererScript(), "RouterProvider");
    });

    it("should use hydrateRoot for initial render", () => {
      assertIncludes(getRendererScript(), "hydrateRoot");
    });

    it("should use identifierPrefix 'vf'", () => {
      assertIncludes(getRendererScript(), "identifierPrefix: 'vf'");
    });

    it("should expose renderPage on window for HMR", () => {
      assertIncludes(getRendererScript(), "window.__veryfrontRenderPage = renderPage");
    });

    it("should store initial page data in history state", () => {
      assertIncludes(getRendererScript(), "window.history.replaceState");
    });

    it("should signal hydration complete", () => {
      assertIncludes(getRendererScript(), "__veryfrontHydrationComplete");
    });

    it("should signal hydration failed", () => {
      assertIncludes(getRendererScript(), "__veryfrontHydrationFailed");
    });

    it("should look for veryfront-content container", () => {
      assertIncludes(getRendererScript(), "getElementById('veryfront-content')");
    });

    it("should support re-rendering via __reactRoot", () => {
      assertIncludes(getRendererScript(), "container.__reactRoot");
    });
  });
});
