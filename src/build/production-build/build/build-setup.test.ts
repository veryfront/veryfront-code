import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
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
 * The shared mock stubs `remove` out and reports every directory as empty, so
 * it cannot observe what the setup step deletes or what it found first. This
 * adapter reads and deletes for real.
 */
function createDeletingAdapter(): RuntimeAdapter {
  const adapter = createMockAdapter();
  const fs = adapter.fs as unknown as {
    remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    readDir: (path: string) => AsyncIterable<{ name: string }>;
  };
  fs.remove = async (path, opts) => {
    await Deno.remove(path, opts).catch(() => undefined);
  };
  fs.exists = exists;
  fs.readDir = (path) => Deno.readDir(path);
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

    it("refuses to clear an output directory no Veryfront build produced", async () => {
      // `veryfront build` deleted whatever already lived in dist/ without a
      // word: a host project that keeps its own build output there lost it,
      // and the CLI still printed a plain success. The output directory is
      // only ours to empty once a Veryfront build has claimed it.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/foreign-output`;
      const adapter = createDeletingAdapter();

      try {
        await Deno.mkdir(`${outputDir}/nested`, { recursive: true });
        await Deno.writeTextFile(`${outputDir}/index.js`, "PRECIOUS-HOST-ARTIFACT");
        await Deno.writeTextFile(`${outputDir}/IMPORTANT.txt`, "do not delete");
        await Deno.writeTextFile(`${outputDir}/nested/deep.txt`, "keepme");

        const error = await assertRejects(
          () => setupBuildDirectories(adapter, outputDir, false),
        );

        const message = error instanceof Error ? error.message : String(error);
        assertStringIncludes(message, outputDir);
        assertStringIncludes(message, "outDir");

        assertEquals(
          await Deno.readTextFile(`${outputDir}/index.js`),
          "PRECIOUS-HOST-ARTIFACT",
          "a foreign output directory must survive the build",
        );
        assertEquals(
          await Deno.readTextFile(`${outputDir}/nested/deep.txt`),
          "keepme",
          "a foreign output directory must survive the build, nested files included",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("does not try to clear an output directory that does not exist", async () => {
      // Removing a path that was never there failed every first build into
      // `! Operation failed, using fallback err=NotFound ... remove '.../dist'`,
      // one line above a green build.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/absent-output`;
      const adapter = createDeletingAdapter();
      const removed: string[] = [];
      const fs = adapter.fs as unknown as {
        remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
      };
      const remove = fs.remove;
      fs.remove = (path, opts) => {
        removed.push(path);
        return remove(path, opts);
      };

      try {
        await setupBuildDirectories(adapter, outputDir, false);

        assertEquals(removed, [], "nothing to clear when the directory is absent");
        assertEquals((await Deno.stat(`${outputDir}/assets`)).isDirectory, true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("clears an empty pre-existing output directory", async () => {
      // Nothing to lose, so nothing to refuse: an empty dist/ (or one the
      // project's own tooling only mkdir'd) must not block a build.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/empty-output`;
      const adapter = createDeletingAdapter();

      try {
        await Deno.mkdir(outputDir, { recursive: true });

        await setupBuildDirectories(adapter, outputDir, false);

        assertEquals((await Deno.stat(`${outputDir}/assets`)).isDirectory, true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("still clears the output directory for a real build", async () => {
      // The dry-run guard must not disable the clean step that keeps stale
      // artifacts from a previous build out of the new one. `_veryfront/` is
      // the marker every Veryfront build leaves behind, so this directory is
      // a previous build's output and is ours to replace.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/real-build`;
      const adapter = createDeletingAdapter();

      try {
        await Deno.mkdir(`${outputDir}/_veryfront`, { recursive: true });
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
