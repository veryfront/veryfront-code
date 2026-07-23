import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { autoDetectContentPaths, hasTailwindV4Import } from "./detector.ts";

describe("hasTailwindV4Import", () => {
  it("detects top-level Tailwind imports", () => {
    assertEquals(hasTailwindV4Import('@import "tailwindcss";'), true);
    assertEquals(hasTailwindV4Import("@import url('tailwindcss/theme');"), true);
  });

  it("ignores comments and quoted text", () => {
    assertEquals(hasTailwindV4Import('/* @import "tailwindcss"; */'), false);
    assertEquals(
      hasTailwindV4Import(".label::before { content: '@import \"tailwindcss\"'; }"),
      false,
    );
  });
});

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
