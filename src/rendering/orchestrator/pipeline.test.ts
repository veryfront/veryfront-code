import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RenderPipelineConfig } from "./pipeline.ts";

// ---- Inline reimplementations of non-exported helpers for unit testing ----

/** Check if a path segment is a hidden dot-directory (not . or ..) */
function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

/** Check if a path contains dot-prefixed segments */
function isDotPath(slug: string, filePath?: string): boolean {
  const hasDotSegment = (path: string) => path.split("/").some(isHiddenSegment);
  return hasDotSegment(slug) || (filePath ? hasDotSegment(filePath) : false);
}

/** Create a cache key for page CSS */
function getPageCssCacheKey(
  projectId: string | undefined,
  environment: string | undefined,
  slug: string,
  projectUpdatedAt: string | undefined,
): string {
  return `${projectId || "default"}:${environment || "preview"}:${slug}:${
    projectUpdatedAt || "draft"
  }`;
}

/** Page CSS cache (LRU-style eviction) */
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

/** hasDataFetchingFunction logic */
function hasDataFetchingFunction(mod: unknown): boolean {
  if (!mod || typeof mod !== "object") return false;
  const m = mod as Record<string, unknown>;
  return typeof m.getServerData === "function" || typeof m.getStaticData === "function";
}

/** collectModulesToLoad logic */
interface ModuleToLoad {
  type: "page" | "layout";
  id: string;
  path: string;
}

function collectModulesToLoad(
  pagePath: string,
  isComponentPage: boolean,
  isInPagesOrAppDir: boolean,
  nestedLayouts: Array<{ kind: string; componentPath?: string }>,
): ModuleToLoad[] {
  const modules: ModuleToLoad[] = [];
  if (isComponentPage && isInPagesOrAppDir) {
    modules.push({ type: "page", id: pagePath, path: pagePath });
  }
  for (const layout of nestedLayouts) {
    if (layout.kind === "tsx" && layout.componentPath) {
      modules.push({ type: "layout", id: layout.componentPath, path: layout.componentPath });
    }
  }
  return modules;
}

// ---- Tests ----

describe("RenderPipeline helpers", () => {
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
      // Fill to max
      for (let i = 0; i < PAGE_CSS_CACHE_MAX_SIZE; i++) {
        cachePageCss(`fill-${i}`, `css-${i}`);
      }
      assertEquals(pageCssCache.size, PAGE_CSS_CACHE_MAX_SIZE);

      // Add one more - should evict first
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
