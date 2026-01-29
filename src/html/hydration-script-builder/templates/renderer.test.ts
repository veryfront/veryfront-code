import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRendererScript } from "./renderer.ts";

describe("hydration-script-builder/templates/renderer", () => {
  describe("getRendererScript", () => {
    it("should return a non-empty string", () => {
      const result = getRendererScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define async renderPage function", () => {
      const result = getRendererScript();
      assertEquals(result.includes("async function renderPage(pathname)"), true);
    });

    it("should look for veryfront-hydration-data script element", () => {
      const result = getRendererScript();
      assertEquals(result.includes("getElementById('veryfront-hydration-data')"), true);
    });

    it("should parse hydration data as JSON", () => {
      const result = getRendererScript();
      assertEquals(result.includes("JSON.parse"), true);
    });

    it("should handle studioEmbed flag", () => {
      const result = getRendererScript();
      assertEquals(result.includes("data.studioEmbed"), true);
      assertEquals(result.includes("__veryfrontSetStudioEmbed"), true);
    });

    it("should use pathToModuleUrl for page loading", () => {
      const result = getRendererScript();
      assertEquals(result.includes("pathToModuleUrl(data.pagePath"), true);
    });

    it("should fallback to Pages Router pattern", () => {
      const result = getRendererScript();
      assertEquals(result.includes("Falling back to Pages Router pattern"), true);
    });

    it("should handle root path in fallback", () => {
      const result = getRendererScript();
      assertEquals(result.includes("pathname === '/' ? 'index' : pathname.slice(1)"), true);
    });

    it("should get PageComponent from default export", () => {
      const result = getRendererScript();
      assertEquals(result.includes("pageModule.default || pageModule"), true);
    });

    it("should merge props with params", () => {
      const result = getRendererScript();
      assertEquals(result.includes("...(data.props || {}), params: data.params || {}"), true);
    });

    it("should wrap with layouts from innermost to outermost", () => {
      const result = getRendererScript();
      assertEquals(result.includes("data.layouts.length - 1; i >= 0; i--"), true);
    });

    it("should wrap with App component when appPath is provided", () => {
      const result = getRendererScript();
      assertEquals(result.includes("data.appPath"), true);
      assertEquals(result.includes("loadComponent(data.appPath)"), true);
    });

    it("should build page context with slug, path, params, query, frontmatter, and headings", () => {
      const result = getRendererScript();
      assertEquals(result.includes("slug: data.slug"), true);
      assertEquals(result.includes("path: data.pagePath"), true);
      assertEquals(result.includes("params: data.params"), true);
      assertEquals(result.includes("frontmatter: data.frontmatter"), true);
      assertEquals(result.includes("headings: headingsArray"), true);
    });

    it("should include mdxHeadings alias for backwards compatibility", () => {
      const result = getRendererScript();
      assertEquals(result.includes("mdxHeadings: headingsArray"), true);
    });

    it("should wrap with PageContextProvider", () => {
      const result = getRendererScript();
      assertEquals(result.includes("PageContextProvider"), true);
    });

    it("should wrap with RouterProvider", () => {
      const result = getRendererScript();
      assertEquals(result.includes("RouterProvider"), true);
    });

    it("should use hydrateRoot for initial render", () => {
      const result = getRendererScript();
      assertEquals(result.includes("hydrateRoot"), true);
    });

    it("should use identifierPrefix 'vf'", () => {
      const result = getRendererScript();
      assertEquals(result.includes("identifierPrefix: 'vf'"), true);
    });

    it("should expose renderPage on window for HMR", () => {
      const result = getRendererScript();
      assertEquals(result.includes("window.__veryfrontRenderPage = renderPage"), true);
    });

    it("should store initial page data in history state", () => {
      const result = getRendererScript();
      assertEquals(result.includes("window.history.replaceState"), true);
    });

    it("should signal hydration complete", () => {
      const result = getRendererScript();
      assertEquals(result.includes("__veryfrontHydrationComplete"), true);
    });

    it("should signal hydration failed", () => {
      const result = getRendererScript();
      assertEquals(result.includes("__veryfrontHydrationFailed"), true);
    });

    it("should look for veryfront-content container", () => {
      const result = getRendererScript();
      assertEquals(result.includes("getElementById('veryfront-content')"), true);
    });

    it("should support re-rendering via __reactRoot", () => {
      const result = getRendererScript();
      assertEquals(result.includes("container.__reactRoot"), true);
    });
  });
});
