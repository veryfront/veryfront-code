import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getLoaderScript } from "./loader.ts";

describe("hydration-script-builder/templates/loader", () => {
  describe("getLoaderScript", () => {
    function getResult(): string {
      return getLoaderScript();
    }

    it("should return a non-empty string", () => {
      const result = getResult();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define componentCache and loadingPromises maps", () => {
      const result = getResult();
      assertEquals(result.includes("const componentCache = new Map()"), true);
      assertEquals(result.includes("const loadingPromises = new Map()"), true);
    });

    it("should define clearComponentCache function", () => {
      const result = getResult();
      assertEquals(result.includes("function clearComponentCache(path)"), true);
    });

    it("should expose clearComponentCache on window", () => {
      const result = getResult();
      assertEquals(
        result.includes("window.__veryfrontClearComponentCache = clearComponentCache"),
        true,
      );
    });

    it("should define appendQueryParam function", () => {
      const result = getResult();
      assertEquals(result.includes("function appendQueryParam(url, key, value)"), true);
    });

    it("should define pathToModuleUrl function", () => {
      const result = getResult();
      assertEquals(result.includes("function pathToModuleUrl(path, studioEmbed)"), true);
    });

    it("should handle known source file extensions in pathToModuleUrl", () => {
      const result = getResult();
      assertEquals(result.includes("pages|components|app|lib|layouts|shared|features"), true);
    });

    it("should define setStudioEmbed function and expose on window", () => {
      const result = getResult();
      assertEquals(result.includes("function setStudioEmbed(value)"), true);
      assertEquals(result.includes("window.__veryfrontSetStudioEmbed = setStudioEmbed"), true);
    });

    it("should define setHMRRefreshTimestamp function and expose on window", () => {
      const result = getResult();
      assertEquals(result.includes("function setHMRRefreshTimestamp(timestamp)"), true);
      assertEquals(
        result.includes("window.__veryfrontSetHMRRefreshTimestamp = setHMRRefreshTimestamp"),
        true,
      );
    });

    it("should define async loadComponent function", () => {
      const result = getResult();
      assertEquals(result.includes("async function loadComponent(path)"), true);
    });

    it("should return null for empty path in loadComponent", () => {
      const result = getResult();
      assertEquals(result.includes("if (!path) return null"), true);
    });

    it("should use cache before loading in loadComponent", () => {
      const result = getResult();
      assertEquals(result.includes("componentCache.has(path)"), true);
      assertEquals(result.includes("componentCache.get(path)"), true);
    });

    it("should prefer MDXLayout over default export", () => {
      const result = getResult();
      assertEquals(
        result.includes("module.MDXLayout || module.MainLayout || module.default"),
        true,
      );
    });

    it("should include performance logging when DEBUG is enabled", () => {
      const result = getResult();
      assertEquals(result.includes("[Veryfront Perf]"), true);
    });

    it("should handle MODULE_SERVER_URL in pathToModuleUrl", () => {
      const result = getResult();
      assertEquals(result.includes("MODULE_SERVER_URL"), true);
    });
  });
});
