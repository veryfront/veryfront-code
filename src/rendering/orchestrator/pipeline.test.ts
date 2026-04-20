import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RenderPipelineConfig } from "./pipeline.ts";
import { isDotPath, isHiddenSegment } from "./path-helpers.ts";
import { getPageCssCacheKey } from "./css-cache.ts";
import { collectModulesToLoad, hasDataFetchingFunction } from "./module-collection.ts";
import {
  extractRenderedCssHash,
  serializeLayoutProps,
  serializeLayouts,
} from "./pipeline-helpers.ts";

const PAGE_CSS_CACHE_MAX_SIZE = 200;
const pageCssCache = new Map<string, string>();

function getCachedPageCss(cacheKey: string): string | undefined {
  return pageCssCache.get(cacheKey);
}

function cachePageCss(cacheKey: string, css: string): void {
  if (pageCssCache.size >= PAGE_CSS_CACHE_MAX_SIZE && !pageCssCache.has(cacheKey)) {
    const firstKey = pageCssCache.keys().next().value as string | undefined;
    if (firstKey) pageCssCache.delete(firstKey);
  }
  pageCssCache.set(cacheKey, css);
}

describe("RenderPipeline helpers", () => {
  describe("pipeline-helpers", () => {
    it("extractRenderedCssHash returns the page css hash when present", () => {
      assertEquals(
        extractRenderedCssHash('<link rel="stylesheet" href="/_vf/css/abc123.css">'),
        "abc123",
      );
    });

    it("serializeLayouts keeps project-relative layout paths", () => {
      const result = serializeLayouts(
        [{
          kind: "tsx",
          path: "/project/app/layout.tsx",
          componentPath: "/project/app/layout.tsx",
        } as any],
        "/project",
      );
      assertEquals(result, [{ kind: "tsx", path: "app/layout.tsx" }]);
    });

    it("serializeLayoutProps converts the layout prop map into a plain object", () => {
      const result = serializeLayoutProps(new Map([["layout-a", { title: "A" }]]));
      assertEquals(result, { "layout-a": { title: "A" } });
    });
  });
  describe("isHiddenSegment", () => {
    it("should detect dot-prefixed segments", () => {
      assertEquals(isHiddenSegment(".veryfront"), true);
      assertEquals(isHiddenSegment(".hidden"), true);
      assertEquals(isHiddenSegment(".git"), true);
    });

    it("should not flag '.' or '..'", () => {
      assertEquals(isHiddenSegment("."), false);
      assertEquals(isHiddenSegment(".."), false);
    });

    it("should not flag normal segments", () => {
      assertEquals(isHiddenSegment("pages"), false);
      assertEquals(isHiddenSegment("components"), false);
      assertEquals(isHiddenSegment("index"), false);
    });
  });

  describe("isDotPath", () => {
    it("should detect dot-prefixed slug segments", () => {
      assertEquals(isDotPath(".veryfront/chat"), true);
      assertEquals(isDotPath("api/.hidden/route"), true);
    });

    it("should detect dot-prefixed filePath segments", () => {
      assertEquals(isDotPath("normal-slug", "/project/.veryfront/pages/index.tsx"), true);
    });

    it("should return false for normal paths", () => {
      assertEquals(isDotPath("about"), false);
      assertEquals(isDotPath("blog/post-1"), false);
      assertEquals(isDotPath("normal", "/project/pages/index.tsx"), false);
    });

    it("should handle missing filePath", () => {
      assertEquals(isDotPath("normal-slug"), false);
      assertEquals(isDotPath("normal-slug", undefined), false);
    });

    it("should handle '.' and '..' in paths without triggering", () => {
      assertEquals(isDotPath("./relative"), false);
      assertEquals(isDotPath("../parent"), false);
    });
  });

  describe("getPageCssCacheKey", () => {
    it("should build key from all parts", () => {
      const key = getPageCssCacheKey("proj1", "production", "/about", "2024-01-01");
      assertEquals(key, "proj1:production:/about:2024-01-01");
    });

    it("should use defaults for undefined values", () => {
      const key = getPageCssCacheKey(undefined, undefined, "/home", undefined);
      assertEquals(key, "default:preview:/home:draft");
    });

    it("should use defaults for partially undefined values", () => {
      const key = getPageCssCacheKey("proj1", undefined, "/", undefined);
      assertEquals(key, "proj1:preview:/:draft");
    });
  });

  describe("pageCssCache (LRU eviction)", () => {
    it("should store and retrieve cached CSS", () => {
      pageCssCache.clear();
      cachePageCss("key1", ".body { color: red; }");
      assertEquals(getCachedPageCss("key1"), ".body { color: red; }");
    });

    it("should return undefined for missing keys", () => {
      pageCssCache.clear();
      assertEquals(getCachedPageCss("nonexistent"), undefined);
    });

    it("should update existing keys without eviction", () => {
      pageCssCache.clear();
      cachePageCss("key1", "old-css");
      cachePageCss("key1", "new-css");
      assertEquals(getCachedPageCss("key1"), "new-css");
      assertEquals(pageCssCache.size, 1);
    });

    it("should evict oldest entry when at max capacity", () => {
      pageCssCache.clear();

      for (let i = 0; i < PAGE_CSS_CACHE_MAX_SIZE; i++) {
        cachePageCss(`fill-${i}`, `css-${i}`);
      }
      assertEquals(pageCssCache.size, PAGE_CSS_CACHE_MAX_SIZE);

      cachePageCss("overflow-key", "overflow-css");
      assertEquals(pageCssCache.size, PAGE_CSS_CACHE_MAX_SIZE);
      assertEquals(getCachedPageCss("fill-0"), undefined);
      assertEquals(getCachedPageCss("overflow-key"), "overflow-css");
    });
  });

  describe("hasDataFetchingFunction", () => {
    it("should return true when getServerData is a function", () => {
      assertEquals(hasDataFetchingFunction({ getServerData: () => {} }), true);
    });

    it("should return true when getStaticData is a function", () => {
      assertEquals(hasDataFetchingFunction({ getStaticData: () => {} }), true);
    });

    it("should return false for null or undefined", () => {
      assertEquals(hasDataFetchingFunction(null), false);
      assertEquals(hasDataFetchingFunction(undefined), false);
    });

    it("should return false for non-objects", () => {
      assertEquals(hasDataFetchingFunction("string"), false);
      assertEquals(hasDataFetchingFunction(42), false);
    });

    it("should return false for objects without data functions", () => {
      assertEquals(hasDataFetchingFunction({ render: () => {} }), false);
      assertEquals(hasDataFetchingFunction({}), false);
    });

    it("should return false when properties are not functions", () => {
      assertEquals(hasDataFetchingFunction({ getServerData: "not-a-function" }), false);
    });
  });

  describe("collectModulesToLoad", () => {
    it("should include page module for component pages in pages dir", () => {
      const result = collectModulesToLoad("/project/pages/index.tsx", true, true, []);
      assertEquals(result.length, 1);

      const first = result[0];
      assertExists(first);
      assertEquals(first.type, "page");
      assertEquals(first.path, "/project/pages/index.tsx");
    });

    it("should not include page module for non-component pages", () => {
      const result = collectModulesToLoad("/project/pages/index.mdx", false, true, []);
      assertEquals(result.length, 0);
    });

    it("should not include page module outside pages/app dir", () => {
      const result = collectModulesToLoad("/project/other/index.tsx", true, false, []);
      assertEquals(result.length, 0);
    });

    it("should include tsx layouts with component paths", () => {
      const layouts = [
        { kind: "tsx", componentPath: "/project/app/layout.tsx" },
        { kind: "mdx" },
        { kind: "tsx", componentPath: "/project/app/sub/layout.tsx" },
      ];
      const result = collectModulesToLoad("/page.tsx", false, false, layouts);
      assertEquals(result.length, 2);

      const first = result[0];
      const second = result[1];
      assertExists(first);
      assertExists(second);
      assertEquals(first.type, "layout");
      assertEquals(first.path, "/project/app/layout.tsx");
      assertEquals(second.path, "/project/app/sub/layout.tsx");
    });

    it("should skip tsx layouts without componentPath", () => {
      const layouts = [{ kind: "tsx" }];
      const result = collectModulesToLoad("/page.tsx", false, false, layouts);
      assertEquals(result.length, 0);
    });

    it("should combine page and layout modules", () => {
      const layouts = [{ kind: "tsx", componentPath: "/layout.tsx" }];
      const result = collectModulesToLoad("/pages/index.tsx", true, true, layouts);
      assertEquals(result.length, 2);

      const first = result[0];
      const second = result[1];
      assertExists(first);
      assertExists(second);
      assertEquals(first.type, "page");
      assertEquals(second.type, "layout");
    });
  });

  describe("RenderPipelineConfig type", () => {
    it("should require all configuration fields", () => {
      const requiredFields = [
        "pageResolver",
        "cacheCoordinator",
        "pageRenderer",
        "layoutOrchestrator",
        "ssrOrchestrator",
        "adapter",
        "mode",
        "projectDir",
      ];
      assertEquals(requiredFields.length, 8);
    });

    it("should accept development mode", () => {
      const config: Partial<RenderPipelineConfig> = { mode: "development" };
      assertEquals(config.mode, "development");
    });

    it("should accept production mode", () => {
      const config: Partial<RenderPipelineConfig> = { mode: "production" };
      assertEquals(config.mode, "production");
    });

    it("should accept projectDir as string", () => {
      const config: Partial<RenderPipelineConfig> = { projectDir: "/path/to/project" };
      assertEquals(config.projectDir, "/path/to/project");
    });
  });
});
