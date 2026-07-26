import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RenderPipelineConfig } from "./pipeline.ts";
import { isDotPath, isHiddenSegment } from "./path-helpers.ts";
import { collectModulesToLoad, hasDataFetchingFunction } from "./module-collection.ts";
import {
  extractRenderedCssHash,
  hasRenderedReleaseAssetCss,
  serializeLayoutProps,
  serializeLayouts,
} from "./pipeline-helpers.ts";

describe("RenderPipeline helpers", () => {
  describe("pipeline-helpers", () => {
    it("extractRenderedCssHash returns the page css hash when present", () => {
      assertEquals(
        extractRenderedCssHash('<link rel="stylesheet" href="/_vf/css/abc123.css">'),
        "abc123",
      );
    });

    it("hasRenderedReleaseAssetCss recognizes immutable release CSS links", () => {
      assertEquals(
        hasRenderedReleaseAssetCss(
          `<link rel="stylesheet" href="/_vf/assets/${"c".repeat(64)}.css">`,
        ),
        true,
      );
      assertEquals(
        hasRenderedReleaseAssetCss('<link rel="stylesheet" href="/_vf/css/abc123.css">'),
        false,
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

    it("serializeLayoutProps uses project-relative layout keys", () => {
      const result = serializeLayoutProps(
        new Map([["/project/layouts/main.tsx", { title: "A" }]]),
        "/project",
      );
      assertEquals(result, { "layouts/main.tsx": { title: "A" } });
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
      assertEquals(isDotPath({ slug: ".veryfront/chat", projectDir: "/project" }), true);
      assertEquals(isDotPath({ slug: "api/.hidden/route", projectDir: "/project" }), true);
    });

    it("should detect dot-prefixed filePath segments", () => {
      assertEquals(
        isDotPath({
          slug: "normal-slug",
          filePath: "/project/.veryfront/pages/index.tsx",
          projectDir: "/project",
        }),
        true,
      );
    });

    it("should return false for normal paths", () => {
      assertEquals(isDotPath({ slug: "about", projectDir: "/project" }), false);
      assertEquals(isDotPath({ slug: "blog/post-1", projectDir: "/project" }), false);
      assertEquals(
        isDotPath({
          slug: "normal",
          filePath: "/project/pages/index.tsx",
          projectDir: "/project",
        }),
        false,
      );
    });

    it("should handle missing filePath", () => {
      assertEquals(isDotPath({ slug: "normal-slug", projectDir: "/project" }), false);
      assertEquals(
        isDotPath({ slug: "normal-slug", filePath: undefined, projectDir: "/project" }),
        false,
      );
    });

    it("should handle '.' and '..' in paths without triggering", () => {
      assertEquals(isDotPath({ slug: "./relative", projectDir: "/project" }), false);
      assertEquals(isDotPath({ slug: "../parent", projectDir: "/project" }), false);
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
