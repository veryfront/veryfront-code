/**
 * Filesystem Compat Tests
 *
 * These tests verify the cross-runtime filesystem abstractions work correctly.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  chmod,
  createFileSystem,
  exists,
  isAlreadyExistsError,
  isNotFoundError,
  makeTempDir,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat,
  symlink,
  writeFile,
  writeTextFile,
} from "./fs.ts";
import { join } from "./path/index.ts";

describe("Filesystem Compat", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await makeTempDir({ prefix: "fs-test-" });
  });

  afterAll(async () => {
    try {
      await remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createFileSystem", () => {
    it("should create a filesystem instance", () => {
      const fs = createFileSystem();
      assertExists(fs);

      const methods = [
        "readTextFile",
        "writeTextFile",
        "exists",
        "mkdir",
        "remove",
        "chmod",
      ] as const;

      for (const method of methods) {
        assertEquals(typeof fs[method], "function");
      }
    });
  });

  describe("writeTextFile / readTextFile", () => {
    async function assertWriteReadTextFile(
      fileName: string,
      content: string,
    ): Promise<void> {
      const filePath = join(testDir, fileName);
      await writeTextFile(filePath, content);
      assertEquals(await readTextFile(filePath), content);
    }

    it("should write and read text files", async () => {
      await assertWriteReadTextFile("test-text.txt", "Hello, World!\nLine 2\n");
    });

    it("should handle unicode content", async () => {
      await assertWriteReadTextFile("test-unicode.txt", "こんにちは 🌍 مرحبا");
    });
  });

  describe("writeFile / readFile", () => {
    it("should write and read binary files", async () => {
      const filePath = join(testDir, "test-binary.bin");
      const content = new Uint8Array([0, 1, 2, 255, 254, 253]);

      await writeFile(filePath, content);
      const readContent = await readFile(filePath);

      // Compare as Uint8Array to handle Node.js Buffer vs Uint8Array differences
      const readAsUint8 = new Uint8Array(readContent);
      assertEquals(readAsUint8.length, content.length);

      for (let i = 0; i < content.length; i++) {
        assertEquals(readAsUint8[i], content[i]);
      }
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const filePath = join(testDir, "exists-test.txt");
      await writeTextFile(filePath, "test");

      assertEquals(await exists(filePath), true);
    });

    it("should return false for non-existent file", async () => {
      const filePath = join(testDir, "does-not-exist.txt");
      assertEquals(await exists(filePath), false);
    });

    it("should return true for existing directory", async () => {
      assertEquals(await exists(testDir), true);
    });
  });

  describe("stat", () => {
    it("should return file info for a file", async () => {
      const filePath = join(testDir, "stat-test.txt");
      await writeTextFile(filePath, "test content");

      const info = await stat(filePath);
      assertEquals(info.isFile, true);
      assertEquals(info.isDirectory, false);
      assertEquals(info.size > 0, true);
    });

    it("should return file info for a directory", async () => {
      const info = await stat(testDir);
      assertEquals(info.isFile, false);
      assertEquals(info.isDirectory, true);
    });
  });

  describe("mkdir", () => {
    it("should create a directory", async () => {
      const dirPath = join(testDir, "new-dir");
      await mkdir(dirPath);

      assertEquals(await exists(dirPath), true);
      assertEquals((await stat(dirPath)).isDirectory, true);
    });

    it("should create nested directories with recursive option", async () => {
      const dirPath = join(testDir, "nested", "deep", "dir");
      await mkdir(dirPath, { recursive: true });

      assertEquals(await exists(dirPath), true);
    });
  });

  describe("readDir", () => {
    it("should iterate over directory entries", async () => {
      const subDir = join(testDir, "readdir-test");
      await mkdir(subDir);
      await writeTextFile(join(subDir, "file1.txt"), "1");
      await writeTextFile(join(subDir, "file2.txt"), "2");
      await mkdir(join(subDir, "subdir"));

      const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
      for await (const entry of readDir(subDir)) {
        entries.push(entry);
      }

      assertEquals(entries.length, 3);

      const names = entries.map((e) => e.name).sort();
      assertEquals(names, ["file1.txt", "file2.txt", "subdir"]);

      const file1 = entries.find((e) => e.name === "file1.txt");
      const subdir = entries.find((e) => e.name === "subdir");

      assertEquals(file1?.isFile, true);
      assertEquals(subdir?.isDirectory, true);
    });
  });

  describe("remove", () => {
    it("should remove a file", async () => {
      const filePath = join(testDir, "to-remove.txt");
      await writeTextFile(filePath, "delete me");

      await remove(filePath);
      assertEquals(await exists(filePath), false);
    });

    it("should remove a directory with recursive option", async () => {
      const dirPath = join(testDir, "to-remove-dir");
      await mkdir(dirPath);
      await writeTextFile(join(dirPath, "file.txt"), "test");

      await remove(dirPath, { recursive: true });
      assertEquals(await exists(dirPath), false);
    });
  });

  describe("makeTempDir", () => {
    it("should create a temporary directory", async () => {
      const tempDir = await makeTempDir({ prefix: "test-temp-" });

      assertExists(tempDir);
      assertEquals(await exists(tempDir), true);
      assertEquals((await stat(tempDir)).isDirectory, true);

      await remove(tempDir, { recursive: true });
    });
  });

  describe("chmod", () => {
    it("should set file permissions without throwing", async () => {
      const filePath = join(testDir, "chmod-test.txt");
      await writeTextFile(filePath, "test");

      // Should not throw (may be no-op on Windows)
      await chmod(filePath, 0o600);
    });
  });

  describe("symlink", () => {
    it("should create a symlink", async () => {
      const filePath = join(testDir, "symlink-target.txt");
      const linkPath = join(testDir, "symlink-link.txt");
      await writeTextFile(filePath, "symlink test");

      await symlink(filePath, linkPath);

      const content = await readTextFile(linkPath);
      assertEquals(content, "symlink test");
    });
  });

  describe("isNotFoundError", () => {
    it("should return true for Deno.errors.NotFound", () => {
      try {
        Deno.readTextFileSync("/nonexistent/path/12345.txt");
      } catch (e) {
        assertEquals(isNotFoundError(e), true);
      }
    });

    it("should return true for Node ENOENT errors", () => {
      const error = new Error("ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      assertEquals(isNotFoundError(error), true);
    });

    it("should return true for VeryfrontError with file-not-found slug", () => {
      const error = new Error("File not found") as Error & { slug: string; name: string };
      error.name = "VeryfrontError";
      error.slug = "file-not-found";
      assertEquals(isNotFoundError(error), true);
    });

    it("should return false for generic errors", () => {
      assertEquals(isNotFoundError(new Error("generic")), false);
    });

    it("should return false for non-errors", () => {
      assertEquals(isNotFoundError("string"), false);
      assertEquals(isNotFoundError(null), false);
      assertEquals(isNotFoundError(undefined), false);
    });
  });

  describe("isAlreadyExistsError", () => {
    it("should return true for Deno.errors.AlreadyExists", async () => {
      const dirPath = join(testDir, "already-exists-test");
      await mkdir(dirPath);
      try {
        await mkdir(dirPath);
      } catch (e) {
        assertEquals(isAlreadyExistsError(e), true);
      }
    });

    it("should return true for Node EEXIST errors", () => {
      const error = new Error("EEXIST") as Error & { code: string };
      error.code = "EEXIST";
      assertEquals(isAlreadyExistsError(error), true);
    });

    it("should return false for generic errors", () => {
      assertEquals(isAlreadyExistsError(new Error("generic")), false);
    });
  });
});
