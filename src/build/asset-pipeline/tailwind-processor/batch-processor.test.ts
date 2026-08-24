import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  makeTempDir,
  mkdir,
  remove,
  symlink,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { installTestCSSOptimizationEngine } from "../../../../tests/_helpers/css-optimization-engine.ts";
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
      const tmpDir = await makeTempDir();
      try {
        await mkdir(`${tmpDir}/styles`, { recursive: true });
        await writeTextFile(`${tmpDir}/styles/readme.md`, "# Styles");

        const result = await processTailwindCSSInDirectory(tmpDir, "styles", ".veryfront/css");
        assertEquals(result, []);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should return empty array for CSS files without tailwind imports", async () => {
      const tmpDir = await makeTempDir();
      try {
        await mkdir(`${tmpDir}/styles`, { recursive: true });
        await writeTextFile(`${tmpDir}/styles/global.css`, "body { color: red; }");

        const result = await processTailwindCSSInDirectory(tmpDir, "styles", ".veryfront/css");
        assertEquals(result, []);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    // Directory discovery (lstat/readDir) goes through the runtime-native
    // filesystem, so the stylesheet must exist on disk for the scan to find it.
    // Every content read and the emit itself go through the injected
    // RuntimeAdapter, so an in-memory adapter carrying the same source lets the
    // emitted stylesheet be asserted from the adapter instead of reading the
    // host filesystem back.
    it("should process a Tailwind v4 stylesheet and write it to the output directory", async () => {
      const source = '@import "tailwindcss";\n.btn { color: red; }';
      const tmpDir = await makeTempDir();
      const restoreEngine = installTestCSSOptimizationEngine();
      const memoryAdapter = createMockAdapter();
      try {
        await mkdir(`${tmpDir}/styles`, { recursive: true });
        await writeTextFile(`${tmpDir}/styles/app.css`, source);
        await memoryAdapter.fs.mkdir(`${tmpDir}/styles`, { recursive: true });
        await memoryAdapter.fs.writeFile(`${tmpDir}/styles/app.css`, source);
        await runtime.set(memoryAdapter);

        const results = await processTailwindCSSInDirectory(tmpDir, "styles", ".veryfront/css");

        assertEquals(results.length, 1, "a Tailwind v4 stylesheet must be processed");
        const [processed] = results;
        assertExists(processed, "a Tailwind v4 stylesheet must be processed");
        assertStringIncludes(
          processed.css,
          "tailwindcss",
          "processed CSS must carry the Tailwind import",
        );
        assertEquals(
          memoryAdapter.fs.files.get(`${tmpDir}/.veryfront/css/app.css`),
          processed.css,
          "processed CSS must be emitted under the output directory",
        );
      } finally {
        await runtime.reset();
        restoreEngine();
        await remove(tmpDir, { recursive: true });
      }
    });

    it("should reject a symlinked CSS source directory", async () => {
      const root = await makeTempDir();
      try {
        const realStyles = `${root}/real-styles`;
        const projectDir = `${root}/project`;
        await mkdir(realStyles, { recursive: true });
        await mkdir(projectDir, { recursive: true });
        await symlink(realStyles, `${projectDir}/styles`);

        await assertRejects(
          () => processTailwindCSSInDirectory(projectDir, "styles", ".veryfront/css"),
          TypeError,
          "Tailwind CSS source path must be a real directory",
        );
      } finally {
        await remove(root, { recursive: true });
      }
    });
  });
});
