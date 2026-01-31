import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { autoDetectContentPaths } from "./detector.ts";

describe("build/asset-pipeline/tailwind-processor/detector", () => {
  describe("autoDetectContentPaths", () => {
    it("should return four content path patterns", () => {
      assertEquals(autoDetectContentPaths("/project").length, 4);
    });

    it("should include app, pages, components, and src directories", () => {
      const joined = autoDetectContentPaths("/project").join("\n");
      assertEquals(joined.includes("/project/app/"), true);
      assertEquals(joined.includes("/project/pages/"), true);
      assertEquals(joined.includes("/project/components/"), true);
      assertEquals(joined.includes("/project/src/"), true);
    });

    it("should include the glob pattern for supported extensions", () => {
      for (const p of autoDetectContentPaths("/project")) {
        assertEquals(p.includes("**/*.{js,ts,jsx,tsx,mdx}"), true);
      }
    });

    it("should use the provided project directory as base", () => {
      for (const p of autoDetectContentPaths("/my/custom/dir")) {
        assertEquals(p.startsWith("/my/custom/dir/"), true);
      }
    });
  });
});
