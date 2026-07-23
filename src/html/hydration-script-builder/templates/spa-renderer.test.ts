import "#veryfront/schemas/_test-setup.ts";
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
      assertIncludes(
        getSpaRendererScript(),
        "assertValidPageData(JSON.parse(serializedData))",
      );
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

    it("should install release asset modules from initial data", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "initialData.releaseAssetModules");
      assertIncludes(result, "__veryfrontSetReleaseAssetModules");
    });

    it("should install release id from initial data", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "initialData.releaseId");
      assertIncludes(result, "__veryfrontSetReleaseId");
    });

    it("should load page component", () => {
      assertIncludes(getSpaRendererScript(), "loadComponent(initialData.pagePath)");
    });

    it("should load layout components", () => {
      assertIncludes(getSpaRendererScript(), "initialData.layouts");
    });

    it("should preload the app wrapper before hydration", () => {
      assertIncludes(getSpaRendererScript(), "loadComponent(initialData.appPath)");
    });

    it("should import ClientApp", () => {
      assertIncludes(getSpaRendererScript(), "_veryfront/client/spa/ClientApp.js");
    });

    it("should look for root container", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "getElementById('root')");
      assertIncludes(result, "throw new Error('Content container not found')");
    });

    it("enforces the hydration-data byte limit before parsing", () => {
      assertIncludes(
        getSpaRendererScript(),
        "new TextEncoder().encode(serializedData).byteLength",
      );
    });

    it("should handle hydration when container has content", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "container.innerHTML.trim()");
      assertIncludes(result, "hydrateRoot");
    });

    it("should use createRoot when container is empty", () => {
      assertIncludes(getSpaRendererScript(), "createRoot(container)");
    });

    it("retains the React root for subsequent SPA navigation", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "container.__reactRoot = hydrateRoot(container, tree");
      assertIncludes(result, "container.__reactRoot = createRoot(container)");
      assertIncludes(result, "container.__reactRoot.render(tree)");
      assertIncludes(result, "window.__veryfrontHydrationComplete()");
    });

    it("should use identifierPrefix 'vf'", () => {
      assertIncludes(getSpaRendererScript(), "identifierPrefix: 'vf'");
    });

    it("reports recoverable hydration errors without a silent callback", () => {
      const result = getSpaRendererScript();
      assertIncludes(result, "Hydration recovery failed (");
      assertEquals(result.includes("onRecoverableError: () => {}"), false);
    });

    it("does not log raw hydration data or parse errors", () => {
      const result = getSpaRendererScript();
      assertEquals(result.includes("Initial page data:', initialData"), false);
      assertEquals(result.includes("Failed to parse hydration data:', parseError"), false);
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

    it("should define async loadComponent function", () => {
      assertIncludes(getSpaLoaderScript(), "async function loadComponent(path)");
    });

    it("should return null for empty path", () => {
      assertIncludes(getSpaLoaderScript(), "if (!path) return null");
    });

    it("should delegate to the canonical shared component loader", () => {
      const result = getSpaLoaderScript();
      assertIncludes(result, "_veryfront/client/spa/component-loader.js");
      assertIncludes(result, "loader.loadComponent(path)");
      assertEquals(result.includes("module.default || module"), false);
      assertEquals(result.includes("const componentCache = new Map()"), false);
    });

    it("should expose loadComponent on window", () => {
      assertIncludes(
        getSpaLoaderScript(),
        "window.__VERYFRONT_LOAD_COMPONENT__ = loadComponent",
      );
    });

    it("should handle load errors gracefully", () => {
      const result = getSpaLoaderScript();
      assertIncludes(result, "Component loader is unavailable");
      assertIncludes(result, "return null");
    });

    it("allows the shared loader import to recover after a transient failure", () => {
      const result = getSpaLoaderScript();
      assertIncludes(result, "componentLoaderPromise = null");
      assertIncludes(result, ".catch((error) =>");
    });
  });
});
