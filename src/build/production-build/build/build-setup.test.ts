import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
      remove: (path: string, opts?: { recursive?: boolean }) => Deno.remove(path, opts),
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

    it("should preserve existing output in dry run", async () => {
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/dry-run-output`;
      const sentinelPath = `${outputDir}/keep.txt`;
      const adapter = createMockAdapter();

      try {
        await Deno.mkdir(outputDir, { recursive: true });
        await Deno.writeTextFile(sentinelPath, "existing artifact");

        await setupBuildDirectories(adapter, outputDir, true);

        assertEquals(await Deno.readTextFile(sentinelPath), "existing artifact");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should propagate output cleanup failures", async () => {
      const cleanupError = new Error("permission denied");
      const adapter = createMockAdapter();
      adapter.fs.remove = () => Promise.reject(cleanupError);

      const error = await assertRejects(() =>
        setupBuildDirectories(adapter, "/protected/output", false)
      );

      assertEquals(error, cleanupError);
    });

    it("should use the selected adapter for every directory operation", async () => {
      const removed: string[] = [];
      const created: string[] = [];
      const adapter = createMockAdapter();
      adapter.fs.remove = (path) => {
        removed.push(path);
        return Promise.resolve();
      };
      adapter.fs.mkdir = (path) => {
        created.push(path);
        return Promise.resolve();
      };

      await setupBuildDirectories(adapter, "/virtual/output", false);

      assertEquals(removed, ["/virtual/output"]);
      assertEquals(created, [
        "/virtual/output",
        "/virtual/output/_veryfront",
        "/virtual/output/_veryfront/chunks",
        "/virtual/output/_veryfront/data",
        "/virtual/output/assets",
      ]);
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
