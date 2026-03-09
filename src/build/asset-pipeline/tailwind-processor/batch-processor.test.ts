import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { processTailwindCSSInDirectory } from "./batch-processor.ts";

describe("build/asset-pipeline/tailwind-processor/batch-processor", () => {
  describe("processTailwindCSSInDirectory", () => {
    it("should return empty array for non-existent directory", async () => {
      const result = await processTailwindCSSInDirectory(
        "/tmp/nonexistent-dir-" + Date.now(),
        "styles",
        ".veryfront/css",
      );
      assertEquals(result, []);
    });

    it("should return empty array for directory with no CSS files", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${tmpDir}/styles`, { recursive: true });
        await Deno.writeTextFile(`${tmpDir}/styles/readme.md`, "# Styles");

        const result = await processTailwindCSSInDirectory(tmpDir, "styles", ".veryfront/css");
        assertEquals(result, []);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should return empty array for CSS files without tailwind imports", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${tmpDir}/styles`, { recursive: true });
        await Deno.writeTextFile(`${tmpDir}/styles/global.css`, "body { color: red; }");

        const result = await processTailwindCSSInDirectory(tmpDir, "styles", ".veryfront/css");
        assertEquals(result, []);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
