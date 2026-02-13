import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSpaLoaderScript, getSpaRendererScript } from "./spa-renderer.ts";

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

describe("hydration-script-builder/templates/spa-renderer", () => {
  describe("getSpaRendererScript", () => {
    it("should return a non-empty string", () => {
      const result = getSpaRendererScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define async initSpaApp function", () => {
      assertIncludes(getSpaRendererScript(), "async function initSpaApp()");
    });

    it("should look for veryfront-hydration-data script element", () => {
      assertIncludes(
        getSpaRendererScript(),
        "getElementById('veryfront-hydration-data')",
      );
    });

    it("should parse hydration data as JSON", () => {
      assertIncludes(getSpaRendererScript(), "JSON.parse(dataScript.textContent");
    });

    it("should handle missing hydration data", () => {
      assertIncludes(getSpaRendererScript(), "Hydration data not found");
    });

    it("should handle JSON parse errors", () => {
      assertIncludes(getSpaRendererScript(), "Failed to parse hydration data");
    });

    it("should set studioEmbed flag when present in data", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "initialData.studioEmbed");
      assertIncludes(result, "__veryfrontSetStudioEmbed");
    });

    it("should load page component", () => {
      assertIncludes(getSpaRendererScript(), "loadComponent(initialData.pagePath)");
    });

    it("should load layout components", () => {
      assertIncludes(getSpaRendererScript(), "initialData.layouts");
    });

    it("should import ClientApp", () => {
      assertIncludes(getSpaRendererScript(), "_veryfront/client/spa/ClientApp.js");
    });

    it("should look for root container", () => {
      assertIncludes(getSpaRendererScript(), "getElementById('root')");
    });

    it("should handle hydration when container has content", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "container.innerHTML.trim()");
      assertIncludes(result, "hydrateRoot");
    });

    it("should use createRoot when container is empty", () => {
      assertIncludes(getSpaRendererScript(), "createRoot(container)");
    });

    it("should use identifierPrefix 'vf'", () => {
      assertIncludes(getSpaRendererScript(), "identifierPrefix: 'vf'");
    });

    it("should set __VERYFRONT_SPA_MODE__ on window", () => {
      assertIncludes(getSpaRendererScript(), "window.__VERYFRONT_SPA_MODE__ = true");
    });

    it("should fallback to renderPage on error", () => {
      assertIncludes(getSpaRendererScript(), "renderPage(window.location.pathname)");
    });

    it("should call initSpaApp at the end", () => {
      assertEquals(getSpaRendererScript().trimEnd().endsWith("initSpaApp();"), true);
    });
  });

  describe("getSpaLoaderScript", () => {
    it("should return a non-empty string", () => {
      const result = getSpaLoaderScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define componentCache and loadingPromises maps", () => {
      const result = getSpaLoaderScript();
      assertIncludes(result, "const componentCache = new Map()");
      assertIncludes(result, "const loadingPromises = new Map()");
    });

    it("should define async loadComponent function", () => {
      assertIncludes(getSpaLoaderScript(), "async function loadComponent(path)");
    });

    it("should return null for empty path", () => {
      assertIncludes(getSpaLoaderScript(), "if (!path) return null");
    });

    it("should check cache before loading", () => {
      assertIncludes(getSpaLoaderScript(), "componentCache.get(path)");
    });

    it("should deduplicate in-flight requests", () => {
      assertIncludes(getSpaLoaderScript(), "loadingPromises.get(path)");
    });

    it("should use pathToModuleUrl for URL generation", () => {
      assertIncludes(getSpaLoaderScript(), "pathToModuleUrl(path)");
    });

    it("should get component from default export or module", () => {
      assertIncludes(getSpaLoaderScript(), "module.default || module");
    });

    it("should store loaded component in cache", () => {
      assertIncludes(getSpaLoaderScript(), "componentCache.set(path, Component)");
    });

    it("should expose loadComponent on window", () => {
      assertIncludes(
        getSpaLoaderScript(),
        "window.__VERYFRONT_LOAD_COMPONENT__ = loadComponent",
      );
    });

    it("should handle load errors gracefully", () => {
      const result = getSpaLoaderScript();
      assertIncludes(result, "Failed to load component");
      assertIncludes(result, "return null");
    });

    it("should clean up loadingPromises in finally block", () => {
      assertIncludes(getSpaLoaderScript(), "loadingPromises.delete(path)");
    });
  });
});
