import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

/**
 * The shared mock stubs `remove` out, so it cannot observe what the setup step
 * deletes. This adapter deletes for real.
 */
function createDeletingAdapter(): RuntimeAdapter {
  const adapter = createMockAdapter();
  (adapter.fs as unknown as {
    remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  }).remove = async (path, opts) => {
    await Deno.remove(path, opts).catch(() => undefined);
  };
  return adapter;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
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

    it("leaves an existing output directory untouched in dry run", async () => {
      // `--dry-run` promises "no files will be written". Clearing the output
      // directory before the dry-run guard broke that promise in the most
      // damaging direction: it deleted the project's previous build output
      // (and anything else living in dist/) and then wrote nothing back.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/dry-run-existing`;
      const adapter = createDeletingAdapter();

      try {
        await Deno.mkdir(`${outputDir}/nested`, { recursive: true });
        await Deno.writeTextFile(`${outputDir}/index.js`, "PRECIOUS-HOST-ARTIFACT");
        await Deno.writeTextFile(`${outputDir}/nested/deep.txt`, "keepme");

        await setupBuildDirectories(adapter, outputDir, true);

        assertEquals(
          await Deno.readTextFile(`${outputDir}/index.js`),
          "PRECIOUS-HOST-ARTIFACT",
          "dry run must not delete existing output",
        );
        assertEquals(
          await Deno.readTextFile(`${outputDir}/nested/deep.txt`),
          "keepme",
          "dry run must not delete nested output",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("still clears the output directory for a real build", async () => {
      // The dry-run guard must not disable the clean step that keeps stale
      // artifacts from a previous build out of the new one.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/real-build`;
      const adapter = createDeletingAdapter();

      try {
        await Deno.mkdir(outputDir, { recursive: true });
        await Deno.writeTextFile(`${outputDir}/stale.html`, "stale");

        await setupBuildDirectories(adapter, outputDir, false);

        assertEquals(
          await exists(`${outputDir}/stale.html`),
          false,
          "a real build must clear stale artifacts",
        );
        assertEquals((await Deno.stat(`${outputDir}/assets`)).isDirectory, true);
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
