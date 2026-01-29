import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { autoDetectContentPaths } from "./detector.ts";

describe("build/asset-pipeline/tailwind-processor/detector", () => {
  describe("autoDetectContentPaths", () => {
    it("should return four content path patterns", () => {
      const paths = autoDetectContentPaths("/project");
      assertEquals(paths.length, 4);
    });

    it("should include app, pages, components, and src directories", () => {
      const paths = autoDetectContentPaths("/project");
      const joined = paths.join("\n");
      assertEquals(joined.includes("/project/app/"), true);
      assertEquals(joined.includes("/project/pages/"), true);
      assertEquals(joined.includes("/project/components/"), true);
      assertEquals(joined.includes("/project/src/"), true);
    });

    it("should include the glob pattern for supported extensions", () => {
      const paths = autoDetectContentPaths("/project");
      for (const p of paths) {
        assertEquals(p.includes("**/*.{js,ts,jsx,tsx,mdx}"), true);
      }
    });

    it("should use the provided project directory as base", () => {
      const paths = autoDetectContentPaths("/my/custom/dir");
      for (const p of paths) {
        assertEquals(p.startsWith("/my/custom/dir/"), true);
      }
    });
  });
});
