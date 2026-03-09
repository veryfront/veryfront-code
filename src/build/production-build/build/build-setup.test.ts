import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setupBuildDirectories } from "./build-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    name: "test",
    fs: {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
      mkdir: (path: string, opts?: { recursive?: boolean }) => Deno.mkdir(path, opts),
      readDir: () =>
        (async function* () {
        })(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: true, size: 0 }),
      remove: () => Promise.resolve(),
      readTextFile: () => Promise.resolve(""),
      writeTextFile: () => Promise.resolve(),
    },
  } as unknown as RuntimeAdapter;
}

describe("build/production-build/build/build-setup", () => {
  describe("setupBuildDirectories", () => {
    it("should create output directories", async () => {
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/build-output`;
      const adapter = createMockAdapter();

      try {
        await setupBuildDirectories(adapter, outputDir, false);

        // Verify directories were created
        const stat = await Deno.stat(outputDir);
        assertEquals(stat.isDirectory, true);

        const vfStat = await Deno.stat(`${outputDir}/_veryfront`);
        assertEquals(vfStat.isDirectory, true);

        const chunksStat = await Deno.stat(`${outputDir}/_veryfront/chunks`);
        assertEquals(chunksStat.isDirectory, true);

        const dataStat = await Deno.stat(`${outputDir}/_veryfront/data`);
        assertEquals(dataStat.isDirectory, true);

        const assetsStat = await Deno.stat(`${outputDir}/assets`);
        assertEquals(assetsStat.isDirectory, true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should skip directory creation in dry run", async () => {
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/dry-run-output`;
      const adapter = createMockAdapter();

      try {
        await setupBuildDirectories(adapter, outputDir, true);

        // In dry run, directories should not be created
        let exists = false;
        try {
          await Deno.stat(outputDir);
          exists = true;
        } catch {
          exists = false;
        }
        assertEquals(exists, false);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should handle existing directories gracefully", async () => {
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/existing-output`;
      await Deno.mkdir(outputDir, { recursive: true });
      await Deno.mkdir(`${outputDir}/_veryfront`, { recursive: true });
      const adapter = createMockAdapter();

      try {
        // Should not throw even though directories exist
        await setupBuildDirectories(adapter, outputDir, false);
        const stat = await Deno.stat(outputDir);
        assertEquals(stat.isDirectory, true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
