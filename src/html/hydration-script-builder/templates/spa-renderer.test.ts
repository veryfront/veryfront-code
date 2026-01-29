import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSpaLoaderScript, getSpaRendererScript } from "./spa-renderer.ts";

describe("hydration-script-builder/templates/spa-renderer", () => {
  describe("getSpaRendererScript", () => {
    it("should return a non-empty string", () => {
      const result = getSpaRendererScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define async initSpaApp function", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("async function initSpaApp()"), true);
    });

    it("should look for veryfront-hydration-data script element", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("getElementById('veryfront-hydration-data')"), true);
    });

    it("should parse hydration data as JSON", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("JSON.parse(dataScript.textContent"), true);
    });

    it("should handle missing hydration data", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("Hydration data not found"), true);
    });

    it("should handle JSON parse errors", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("Failed to parse hydration data"), true);
    });

    it("should set studioEmbed flag when present in data", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("initialData.studioEmbed"), true);
      assertEquals(result.includes("__veryfrontSetStudioEmbed"), true);
    });

    it("should load page component", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("loadComponent(initialData.pagePath)"), true);
    });

    it("should load layout components", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("initialData.layouts"), true);
    });

    it("should import ClientApp", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("lib/spa/ClientApp.js"), true);
    });

    it("should look for veryfront-content container", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("getElementById('veryfront-content')"), true);
    });

    it("should handle hydration when container has content", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("container.innerHTML.trim()"), true);
      assertEquals(result.includes("hydrateRoot"), true);
    });

    it("should use createRoot when container is empty", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("createRoot(container)"), true);
    });

    it("should use identifierPrefix 'vf'", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("identifierPrefix: 'vf'"), true);
    });

    it("should set __VERYFRONT_SPA_MODE__ on window", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("window.__VERYFRONT_SPA_MODE__ = true"), true);
    });

    it("should fallback to renderPage on error", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("renderPage(window.location.pathname)"), true);
    });

    it("should call initSpaApp at the end", () => {
      const result = getSpaRendererScript();
      assertEquals(result.trimEnd().endsWith("initSpaApp();"), true);
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
      assertEquals(result.includes("const componentCache = new Map()"), true);
      assertEquals(result.includes("const loadingPromises = new Map()"), true);
    });

    it("should define async loadComponent function", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("async function loadComponent(path)"), true);
    });

    it("should return null for empty path", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("if (!path) return null"), true);
    });

    it("should check cache before loading", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("componentCache.get(path)"), true);
    });

    it("should deduplicate in-flight requests", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("loadingPromises.get(path)"), true);
    });

    it("should use pathToModuleUrl for URL generation", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("pathToModuleUrl(path)"), true);
    });

    it("should get component from default export or module", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("module.default || module"), true);
    });

    it("should store loaded component in cache", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("componentCache.set(path, Component)"), true);
    });

    it("should expose loadComponent on window", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("window.__VERYFRONT_LOAD_COMPONENT__ = loadComponent"), true);
    });

    it("should handle load errors gracefully", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("Failed to load component"), true);
      assertEquals(result.includes("return null"), true);
    });

    it("should clean up loadingPromises in finally block", () => {
      const result = getSpaLoaderScript();
      assertEquals(result.includes("loadingPromises.delete(path)"), true);
    });
  });
});
