import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import { delay } from "#std/async";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat";

const removeIt = isBun ? it.skip : it;

async function safeCleanup(
  fs: ReturnType<typeof createFileSystem>,
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  try {
    await fs.remove(path, options);
  } catch (e) {
    if (isBun && e instanceof Error && e.message.includes("EFAULT")) return;
    throw e;
  }
}

const TEST_DIR = await makeTempDir({ prefix: "veryfront_fs_test_" });

async function collectEntries(
  fs: ReturnType<typeof createFileSystem>,
  path: string,
): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
  const results: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
  for await (const entry of fs.readDir(path)) results.push(entry);
  return results;
}

async function cleanup(): Promise<void> {
  try {
    await remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("FS Compat", () => {
  afterAll(cleanup);

  describe("createFileSystem", () => {
    it("should return fs instance with all required methods", () => {
      const fs = createFileSystem();
      assertExists(fs);
      assertExists(fs.readTextFile);
      assertExists(fs.writeTextFile);
      assertExists(fs.exists);
      assertExists(fs.stat);
      assertExists(fs.mkdir);
      assertExists(fs.readDir);
      assertExists(fs.remove);
    });
  });

  describe("read/write operations", () => {
    it("should write and verify file exists", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "write-test.txt");

      await fs.writeTextFile(testFile, "Hello World");

      assert(await fs.exists(testFile), "File should exist");

      await fs.remove(testFile);
    });

    it("should read text file correctly", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "read-test.txt");

      const content = "Test content for reading";
      await fs.writeTextFile(testFile, content);

      assertEquals(await fs.readTextFile(testFile), content);

      await fs.remove(testFile);
    });

    it("should throw error for non-existent file", async () => {
      const fs = createFileSystem();
      const nonExistentFile = join(TEST_DIR, "non-existent.txt");

      await assertRejects(
        () => fs.readTextFile(nonExistentFile),
        Error,
        "",
        "Should throw error for non-existent file",
      );
    });

    it("should overwrite file content when writing to existing file", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "overwrite-test.txt");

      await fs.writeTextFile(testFile, "original content");
      assertEquals(await fs.readTextFile(testFile), "original content");

      await fs.writeTextFile(testFile, "new content");
      assertEquals(await fs.readTextFile(testFile), "new content");

      await fs.remove(testFile);
    });
  });

  describe("exists", () => {
    it("should verify file exists after write operation", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "exists-test.txt");

      await fs.writeTextFile(testFile, "content");

      assert(await fs.exists(testFile), "File should exist");

      await fs.remove(testFile);
    });

    it("should return false when checking existence of non-existent file", async () => {
      const fs = createFileSystem();
      const nonExistentFile = join(TEST_DIR, "does-not-exist.txt");

      assert(!(await fs.exists(nonExistentFile)), "File should not exist");
    });
  });

  describe("stat", () => {
    it("should provide correct stat information for files", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "stat-test.txt");

      await fs.writeTextFile(testFile, "Test content");

      const stat = await fs.stat(testFile);

      assertExists(stat);
      assert(stat.isFile, "Should be a file");
      assert(!stat.isDirectory, "Should not be a directory");
      assert(stat.size > 0, "File size should be greater than 0");
      assertExists(stat.mtime);

      await fs.remove(testFile);
    });

    it("should provide correct stat information for directories", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "stat-dir-test");

      await fs.mkdir(testDir);

      const stat = await fs.stat(testDir);

      assertExists(stat);
      assert(!stat.isFile, "Should not be a file");
      assert(stat.isDirectory, "Should be a directory");

      await safeCleanup(fs, testDir);
    });

    it("should report correct file size in stat information", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "size-test.txt");

      const content = "Test";
      await fs.writeTextFile(testFile, content);

      const stat = await fs.stat(testFile);
      assertEquals(stat.size, content.length);

      await fs.remove(testFile);
    });

    it("should update modification time when file is written", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "mtime-test.txt");

      await fs.writeTextFile(testFile, "content1");
      const stat1 = await fs.stat(testFile);

      await delay(100);

      await fs.writeTextFile(testFile, "content2");
      const stat2 = await fs.stat(testFile);

      assert(stat1.mtime !== null, "First mtime should not be null");
      assert(stat2.mtime !== null, "Second mtime should not be null");

      if (stat1.mtime && stat2.mtime) {
        assert(stat2.mtime >= stat1.mtime, "mtime should be updated");
      }

      await fs.remove(testFile);
    });
  });

  describe("mkdir", () => {
    it("should create directory with mkdir operation", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "mkdir-test");

      await fs.mkdir(testDir);

      assert(await fs.exists(testDir), "Directory should exist");

      const stat = await fs.stat(testDir);
      assert(stat.isDirectory, "Should be a directory");

      await safeCleanup(fs, testDir);
    });

    it("should create nested directories with recursive option", async () => {
      const fs = createFileSystem();
      const nestedDir = join(TEST_DIR, "parent", "child", "grandchild");

      await fs.mkdir(nestedDir, { recursive: true });

      assert(await fs.exists(nestedDir), "Nested directory should exist");

      await fs.remove(join(TEST_DIR, "parent"), { recursive: true });
    });
  });

  describe("readDir", () => {
    it("should list directory contents with correct file and directory entries", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "readdir-test");

      await fs.mkdir(testDir);

      await fs.writeTextFile(join(testDir, "file1.txt"), "content1");
      await fs.writeTextFile(join(testDir, "file2.txt"), "content2");
      await fs.mkdir(join(testDir, "subdir"));

      const entries = await collectEntries(fs, testDir);

      assertEquals(entries.length, 3);

      const names = entries.map((e) => e.name).sort();
      assertEquals(names, ["file1.txt", "file2.txt", "subdir"]);

      const file1 = entries.find((e) => e.name === "file1.txt");
      assertExists(file1);
      assert(file1.isFile, "file1.txt should be a file");
      assert(!file1.isDirectory, "file1.txt should not be a directory");

      const subdir = entries.find((e) => e.name === "subdir");
      assertExists(subdir);
      assert(!subdir.isFile, "subdir should not be a file");
      assert(subdir.isDirectory, "subdir should be a directory");

      await fs.remove(testDir, { recursive: true });
    });

    it("should return empty array for empty directory", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "empty-dir-test");

      await fs.mkdir(testDir);

      const entries = await collectEntries(fs, testDir);
      assertEquals(entries.length, 0);

      await safeCleanup(fs, testDir);
    });
  });

  describe("remove", () => {
    removeIt("should remove file with remove operation", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "remove-test.txt");

      await fs.writeTextFile(testFile, "content");

      assert(await fs.exists(testFile), "File should exist before removal");

      await fs.remove(testFile);

      assert(!(await fs.exists(testFile)), "File should not exist after removal");
    });

    removeIt("should remove empty directory with remove operation", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "remove-dir-test");

      await fs.mkdir(testDir);

      assert(await fs.exists(testDir), "Directory should exist before removal");

      await fs.remove(testDir);

      assert(!(await fs.exists(testDir)), "Directory should not exist after removal");
    });

    removeIt("should remove nested directories with recursive option", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "recursive-remove-test");

      await fs.mkdir(testDir);
      await fs.writeTextFile(join(testDir, "file.txt"), "content");
      await fs.mkdir(join(testDir, "subdir"));
      await fs.writeTextFile(join(testDir, "subdir", "nested.txt"), "nested");

      await fs.remove(testDir, { recursive: true });

      assert(!(await fs.exists(testDir)), "Directory should not exist after recursive removal");
    });
  });

  describe("content handling", () => {
    it("should handle UTF-8 content including emojis and special characters", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "utf8-test.txt");

      const utf8Content = "你好世界 🌍 émojis and ñ special chars";
      await fs.writeTextFile(testFile, utf8Content);

      assertEquals(await fs.readTextFile(testFile), utf8Content);

      await fs.remove(testFile);
    });

    it("should preserve multiline content with newline characters", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "multiline-test.txt");

      const multilineContent = "Line 1\nLine 2\nLine 3\n";
      await fs.writeTextFile(testFile, multilineContent);

      assertEquals(await fs.readTextFile(testFile), multilineContent);

      await fs.remove(testFile);
    });

    it("should handle empty files with zero size", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "empty-test.txt");

      await fs.writeTextFile(testFile, "");

      assertEquals(await fs.readTextFile(testFile), "");

      const stat = await fs.stat(testFile);
      assertEquals(stat.size, 0);

      await fs.remove(testFile);
    });

    it("should handle large files with 1MB content", async () => {
      const fs = createFileSystem();
      const testFile = join(TEST_DIR, "large-test.txt");

      const largeContent = "a".repeat(1024 * 1024);
      await fs.writeTextFile(testFile, largeContent);

      const readContent = await fs.readTextFile(testFile);
      assertEquals(readContent.length, largeContent.length);
      assertEquals(readContent, largeContent);

      const stat = await fs.stat(testFile);
      assert(stat.size >= 1024 * 1024, "File size should be at least 1MB");

      await fs.remove(testFile);
    });

    it("should handle filenames with special characters", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "special-chars-test");

      await fs.mkdir(testDir);

      const specialNames = ["file-with-dash.txt", "file_with_underscore.txt", "file.multiple.dots.txt"];

      for (const name of specialNames) {
        await fs.writeTextFile(join(testDir, name), "content");
      }

      const entries = await collectEntries(fs, testDir);
      assertEquals(entries.length, specialNames.length);

      const names = entries.map((e) => e.name).sort();
      assertEquals(names, specialNames.sort());

      await fs.remove(testDir, { recursive: true });
    });
  });

  describe("concurrent operations", () => {
    it("should handle sequential file operations across multiple files", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "sequence-test");

      await fs.mkdir(testDir);

      for (let i = 0; i < 5; i++) {
        await fs.writeTextFile(join(testDir, `file${i}.txt`), `content${i}`);
      }

      assertEquals((await collectEntries(fs, testDir)).length, 5);

      for (let i = 0; i < 5; i++) {
        assertEquals(await fs.readTextFile(join(testDir, `file${i}.txt`)), `content${i}`);
      }

      for (let i = 0; i < 5; i++) {
        await fs.remove(join(testDir, `file${i}.txt`));
      }

      assertEquals((await collectEntries(fs, testDir)).length, 0);

      await safeCleanup(fs, testDir);
    });

    it("should handle concurrent file write operations", async () => {
      const fs = createFileSystem();
      const testDir = join(TEST_DIR, "concurrent-test");

      await fs.mkdir(testDir);

      const promises: Array<Promise<void>> = [];
      for (let i = 0; i < 10; i++) {
        promises.push(fs.writeTextFile(join(testDir, `file${i}.txt`), `content${i}`));
      }

      await Promise.all(promises);

      assertEquals((await collectEntries(fs, testDir)).length, 10);

      await fs.remove(testDir, { recursive: true });
    });
  });
});
