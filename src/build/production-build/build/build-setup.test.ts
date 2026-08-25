import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
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
          VeryfrontError,
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(
          error.slug,
          "build-failed",
          "the refusal must stay classified so the CLI maps its exit code and tips",
        );

        const message = error.message;
        assertStringIncludes(message, "foreign-output");
        assertStringIncludes(message, "outDir");
        assertEquals(
          message.includes(tmpDir),
          false,
          "the refusal must name the output directory without leaking the machine's paths",
        );

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

    it("refuses to clear an output directory whose contents cannot be listed", async () => {
      // Ownership is inferred from what the directory holds, so a listing that
      // fails — no permission, a transient filesystem error, a path that turns
      // out to be a file — proves nothing. Treating that as "ours" hands the
      // deletion back to the case this guard exists to stop, so an output that
      // cannot be inspected fails closed.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/unreadable-output`;
      const adapter = createDeletingAdapter();
      const removed: string[] = [];
      const fs = adapter.fs as unknown as {
        readDir: (path: string) => AsyncIterable<Deno.DirEntry>;
        remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
      };
      fs.readDir = () => {
        throw new Deno.errors.PermissionDenied("readdir");
      };
      const remove = fs.remove;
      fs.remove = (path, opts) => {
        removed.push(path);
        return remove(path, opts);
      };

      try {
        await Deno.mkdir(outputDir, { recursive: true });
        await Deno.writeTextFile(`${outputDir}/IMPORTANT.txt`, "do not delete");

        const error = await assertRejects(
          () => setupBuildDirectories(adapter, outputDir, false),
          VeryfrontError,
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(
          error.slug,
          "build-failed",
          "the refusal must stay classified so the CLI maps its exit code and tips",
        );

        const message = error.message;
        assertStringIncludes(message, "unreadable-output");
        assertEquals(removed, [], "an uninspectable output directory must not be deleted");
        assertEquals(
          await Deno.readTextFile(`${outputDir}/IMPORTANT.txt`),
          "do not delete",
          "an uninspectable output directory must survive the build",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("refuses to clear a foreign directory holding a _veryfront file", async () => {
      // Ownership is claimed by the `_veryfront/` directory the build creates.
      // A plain file (or a symlink) of that name is not that directory, and
      // matching on the name alone let any project that happens to keep one
      // authorize the deletion of everything beside it.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/marker-file-output`;
      const adapter = createDeletingAdapter();

      try {
        await Deno.mkdir(outputDir, { recursive: true });
        await Deno.writeTextFile(`${outputDir}/_veryfront`, "not our directory");
        await Deno.writeTextFile(`${outputDir}/IMPORTANT.txt`, "do not delete");

        await assertRejects(() => setupBuildDirectories(adapter, outputDir, false));

        assertEquals(
          await Deno.readTextFile(`${outputDir}/IMPORTANT.txt`),
          "do not delete",
          "a name-only marker match must not authorize deleting a foreign directory",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("strips control characters from the entry names it lists", async () => {
      // The names come off the filesystem, so a file can be called anything a
      // filesystem allows — including an ANSI escape sequence that rewrites the
      // rest of the line instead of appearing in it, hiding the very sentence
      // that tells the developer what to do.
      const tmpDir = await Deno.makeTempDir();
      const outputDir = `${tmpDir}/escaping-output`;
      const adapter = createDeletingAdapter();
      const hostile = "\u001b[2Kfake.txt";

      try {
        await Deno.mkdir(outputDir, { recursive: true });
        await Deno.writeTextFile(`${outputDir}/${hostile}`, "sneaky");

        const error = await assertRejects(
          () => setupBuildDirectories(adapter, outputDir, false),
        );

        const message = error instanceof Error ? error.message : String(error);
        assertStringIncludes(message, "?[2Kfake.txt");
        assertEquals(
          // deno-lint-ignore no-control-regex
          /[\u0000-\u001F\u007F-\u009F]/.test(message),
          false,
          "the refusal must not replay control characters from a filename",
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
