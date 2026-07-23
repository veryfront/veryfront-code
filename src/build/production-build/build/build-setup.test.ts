import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  commitBuildOutput,
  createBuildOutputTransaction,
  rollbackBuildOutput,
  setupBuildDirectories,
} from "./build-setup.ts";
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

    it("does not remove an existing output directory during a dry run", async () => {
      let removeCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs.remove = () => {
        removeCalls++;
        return Promise.resolve();
      };

      await setupBuildDirectories(adapter, "/project/dist", true);

      assertEquals(removeCalls, 0);
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

    it("propagates failures while removing a previous output", async () => {
      const adapter = createMockAdapter();
      adapter.fs.remove = () => Promise.reject(new Deno.errors.PermissionDenied("denied"));

      await assertRejects(
        () => setupBuildDirectories(adapter, "/project/dist", false),
        Deno.errors.PermissionDenied,
        "denied",
      );
    });

    it("rejects root and blank output paths before removal", async () => {
      const adapter = createMockAdapter();
      await assertRejects(() => setupBuildDirectories(adapter, "/", false), TypeError);
      await assertRejects(() => setupBuildDirectories(adapter, " ", false), TypeError);
    });
  });

  describe("build output transaction", () => {
    it("atomically replaces the previous output only after commit", async () => {
      const root = await Deno.makeTempDir();
      const outputDir = `${root}/dist`;
      try {
        await Deno.mkdir(outputDir);
        await Deno.writeTextFile(`${outputDir}/old.txt`, "old");
        const transaction = createBuildOutputTransaction(outputDir, false);
        await Deno.mkdir(transaction.workingOutputDir);
        await Deno.writeTextFile(`${transaction.workingOutputDir}/new.txt`, "new");

        assertEquals(await Deno.readTextFile(`${outputDir}/old.txt`), "old");
        await commitBuildOutput(transaction);

        assertEquals(await Deno.readTextFile(`${outputDir}/new.txt`), "new");
        await assertRejects(() => Deno.readTextFile(`${outputDir}/old.txt`), Deno.errors.NotFound);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rolls back staging without changing the previous output", async () => {
      const root = await Deno.makeTempDir();
      const outputDir = `${root}/dist`;
      try {
        await Deno.mkdir(outputDir);
        await Deno.writeTextFile(`${outputDir}/old.txt`, "old");
        const transaction = createBuildOutputTransaction(outputDir, false);
        await Deno.mkdir(transaction.workingOutputDir);
        await Deno.writeTextFile(`${transaction.workingOutputDir}/partial.txt`, "partial");

        await rollbackBuildOutput(transaction);

        assertEquals(await Deno.readTextFile(`${outputDir}/old.txt`), "old");
        await assertRejects(
          () => Deno.stat(transaction.workingOutputDir),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("does not create staging paths for a dry run", async () => {
      const transaction = createBuildOutputTransaction("/project/dist", true);
      assertEquals(transaction.workingOutputDir, transaction.finalOutputDir);
      await commitBuildOutput(transaction);
    });

    it("freezes transaction paths against post-validation mutation", () => {
      const transaction = createBuildOutputTransaction("/project/dist", true);
      assertEquals(Object.isFrozen(transaction), true);
      assertThrows(
        () => {
          (transaction as { workingOutputDir: string }).workingOutputDir = "/";
        },
        TypeError,
      );
    });
  });
});
