import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractFrameworkBundlePaths } from "./framework-bundle-paths.ts";

describe("transforms/shared/framework-bundle-paths", () => {
  describe("extractFrameworkBundlePaths", () => {
    it("extracts a single framework bundle path", () => {
      const code = `import "file:///cache/framework/vfmod-abc123.mjs";`;
      assertEquals(extractFrameworkBundlePaths(code), ["/cache/framework/vfmod-abc123.mjs"]);
    });

    it("extracts multiple framework bundle paths", () => {
      const code = `
        import "file:///cache/framework/vfmod-abc.mjs";
        import "file:///cache/framework/vfmod-def.mjs";
      `;
      const result = extractFrameworkBundlePaths(code);
      assertEquals(result.length, 2);
      assertEquals(result.includes("/cache/framework/vfmod-abc.mjs"), true);
      assertEquals(result.includes("/cache/framework/vfmod-def.mjs"), true);
    });

    it("deduplicates identical paths", () => {
      const code = `
        import "file:///cache/framework/vfmod-abc.mjs";
        import "file:///cache/framework/vfmod-abc.mjs";
      `;
      assertEquals(extractFrameworkBundlePaths(code), ["/cache/framework/vfmod-abc.mjs"]);
    });

    it("returns empty array for code with no framework bundles", () => {
      const code = `import "react";`;
      assertEquals(extractFrameworkBundlePaths(code), []);
    });

    it("returns empty array for empty string", () => {
      assertEquals(extractFrameworkBundlePaths(""), []);
    });

    it("ignores non-framework file:// paths", () => {
      const code = `import "file:///cache/other/module.mjs";`;
      assertEquals(extractFrameworkBundlePaths(code), []);
    });

    it("strips the file:// prefix", () => {
      const code = `import "file:///home/user/.cache/framework/vfmod-test.mjs";`;
      const result = extractFrameworkBundlePaths(code);
      assertEquals(result[0]!.startsWith("file://"), false);
      assertEquals(result[0], "/home/user/.cache/framework/vfmod-test.mjs");
    });
  });
});
