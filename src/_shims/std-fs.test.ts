import { assertEquals, assert, assertExists } from "std/assert/mod.ts";
import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import {
  exists,
  existsSync,
  ensureDir,
  walk,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "./std-fs.ts";
import * as path from "std/path/mod.ts";

const TEST_DIR = path.join(Deno.cwd(), "test_temp_fs");

describe("std-fs", () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test directory after each test
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      await mkdir(TEST_DIR, { recursive: true });
      const testFile = path.join(TEST_DIR, "test.txt");
      await writeFile(testFile, "test content");

      const result = await exists(testFile);

      assertEquals(result, true);
    });

    it("should return false for non-existing file", async () => {
      const nonExistentPath = path.join(TEST_DIR, "nonexistent.txt");

      const result = await exists(nonExistentPath);

      assertEquals(result, false);
    });

    it("should return true for existing directory", async () => {
      await mkdir(TEST_DIR, { recursive: true });

      const result = await exists(TEST_DIR);

      assertEquals(result, true);
    });

    it("should return false for non-existing directory", async () => {
      const nonExistentDir = path.join(TEST_DIR, "nonexistent");

      const result = await exists(nonExistentDir);

      assertEquals(result, false);
    });
  });

  describe("existsSync", () => {
    it("should return true for existing file synchronously", async () => {
      await mkdir(TEST_DIR, { recursive: true });
      const testFile = path.join(TEST_DIR, "test.txt");
      await writeFile(testFile, "test content");

      const result = existsSync(testFile);

      assertEquals(result, true);
    });

    it("should return false for non-existing file synchronously", () => {
      const nonExistentPath = path.join(TEST_DIR, "nonexistent.txt");

      const result = existsSync(nonExistentPath);

      assertEquals(result, false);
    });

    it("should return true for existing directory synchronously", async () => {
      await mkdir(TEST_DIR, { recursive: true });

      const result = existsSync(TEST_DIR);

      assertEquals(result, true);
    });
  });

  describe("ensureDir", () => {
    it("should create a new directory", async () => {
      const newDir = path.join(TEST_DIR, "new_dir");

      await ensureDir(newDir);

      const result = await exists(newDir);
      assertEquals(result, true);
    });

    it("should create nested directories", async () => {
      const nestedDir = path.join(TEST_DIR, "level1", "level2", "level3");

      await ensureDir(nestedDir);

      const result = await exists(nestedDir);
      assertEquals(result, true);
    });

    it("should not throw error if directory already exists", async () => {
      await mkdir(TEST_DIR, { recursive: true });

      // Should not throw
      await ensureDir(TEST_DIR);

      const result = await exists(TEST_DIR);
      assertEquals(result, true);
    });
  });

  describe("walk", () => {
    it("should walk through directory and yield files", async () => {
      // Create test structure
      await ensureDir(TEST_DIR);
      await writeFile(path.join(TEST_DIR, "file1.txt"), "content1");
      await writeFile(path.join(TEST_DIR, "file2.txt"), "content2");

      const entries = [];
      for await (const entry of walk(TEST_DIR)) {
        entries.push(entry);
      }

      const files = entries.filter((e) => e.isFile);
      assertEquals(files.length, 2);
      assert(files.some((f) => f.name === "file1.txt"));
      assert(files.some((f) => f.name === "file2.txt"));
    });

    it("should walk through nested directories", async () => {
      // Create nested structure
      await ensureDir(path.join(TEST_DIR, "subdir"));
      await writeFile(path.join(TEST_DIR, "root.txt"), "root");
      await writeFile(path.join(TEST_DIR, "subdir", "nested.txt"), "nested");

      const entries = [];
      for await (const entry of walk(TEST_DIR)) {
        entries.push(entry);
      }

      const files = entries.filter((e) => e.isFile);
      assertEquals(files.length, 2);
      assert(files.some((f) => f.name === "root.txt"));
      assert(files.some((f) => f.name === "nested.txt"));
    });

    it("should respect maxDepth option", async () => {
      // Create nested structure
      await ensureDir(path.join(TEST_DIR, "level1", "level2"));
      await writeFile(path.join(TEST_DIR, "root.txt"), "root");
      await writeFile(path.join(TEST_DIR, "level1", "l1.txt"), "l1");
      await writeFile(path.join(TEST_DIR, "level1", "level2", "l2.txt"), "l2");

      const entries = [];
      for await (const entry of walk(TEST_DIR, { maxDepth: 1 })) {
        entries.push(entry);
      }

      const files = entries.filter((e) => e.isFile);
      // Should only get root.txt and l1.txt, not l2.txt
      assert(files.some((f) => f.name === "root.txt"));
      assert(files.some((f) => f.name === "l1.txt"));
      assert(!files.some((f) => f.name === "l2.txt"));
    });

    it("should filter by file extensions", async () => {
      await ensureDir(TEST_DIR);
      await writeFile(path.join(TEST_DIR, "file.txt"), "txt");
      await writeFile(path.join(TEST_DIR, "file.md"), "md");
      await writeFile(path.join(TEST_DIR, "file.json"), "json");

      const entries = [];
      for await (const entry of walk(TEST_DIR, { exts: ["txt", "md"] })) {
        entries.push(entry);
      }

      const files = entries.filter((e) => e.isFile);
      assertEquals(files.length, 2);
      assert(files.some((f) => f.name === "file.txt"));
      assert(files.some((f) => f.name === "file.md"));
      assert(!files.some((f) => f.name === "file.json"));
    });

    it("should skip paths matching skip patterns", async () => {
      await ensureDir(path.join(TEST_DIR, "node_modules"));
      await writeFile(path.join(TEST_DIR, "main.txt"), "main");
      await writeFile(path.join(TEST_DIR, "node_modules", "dep.txt"), "dep");

      const entries = [];
      for await (const entry of walk(TEST_DIR, { skip: [/node_modules/] })) {
        entries.push(entry);
      }

      const files = entries.filter((e) => e.isFile);
      assertEquals(files.length, 1);
      assert(files.some((f) => f.name === "main.txt"));
      assert(!files.some((f) => f.name === "dep.txt"));
    });

    it("should include directories when includeDirs is true", async () => {
      await ensureDir(path.join(TEST_DIR, "subdir"));
      await writeFile(path.join(TEST_DIR, "file.txt"), "content");

      const entries = [];
      for await (const entry of walk(TEST_DIR, { includeDirs: true })) {
        entries.push(entry);
      }

      const dirs = entries.filter((e) => e.isDirectory);
      assert(dirs.length > 0);
      assert(dirs.some((d) => d.name === "subdir"));
    });

    it("should exclude files when includeFiles is false", async () => {
      await ensureDir(path.join(TEST_DIR, "subdir"));
      await writeFile(path.join(TEST_DIR, "file.txt"), "content");

      const entries = [];
      for await (
        const entry of walk(TEST_DIR, {
          includeFiles: false,
          includeDirs: true,
        })
      ) {
        entries.push(entry);
      }

      const files = entries.filter((e) => e.isFile);
      assertEquals(files.length, 0);
    });

    it("should handle empty directory", async () => {
      await ensureDir(TEST_DIR);

      const entries = [];
      for await (const entry of walk(TEST_DIR)) {
        entries.push(entry);
      }

      assertEquals(entries.length, 0);
    });
  });

  describe("readFile and writeFile", () => {
    it("should write and read file content", async () => {
      await ensureDir(TEST_DIR);
      const testFile = path.join(TEST_DIR, "test.txt");
      const content = "Hello, World!";

      await writeFile(testFile, content);
      const readContent = await readFile(testFile, "utf-8");

      assertEquals(readContent, content);
    });

    it("should handle binary content", async () => {
      await ensureDir(TEST_DIR);
      const testFile = path.join(TEST_DIR, "binary.bin");
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);

      await writeFile(testFile, buffer);
      const readBuffer = await readFile(testFile) as unknown as Uint8Array;

      assertEquals(Array.from(readBuffer), Array.from(buffer));
    });

    it("should overwrite existing file", async () => {
      await ensureDir(TEST_DIR);
      const testFile = path.join(TEST_DIR, "overwrite.txt");

      await writeFile(testFile, "first");
      await writeFile(testFile, "second");
      const content = await readFile(testFile, "utf-8");

      assertEquals(content, "second");
    });
  });

  describe("mkdir and rm", () => {
    it("should create and remove directory", async () => {
      const newDir = path.join(TEST_DIR, "to_remove");

      await mkdir(newDir, { recursive: true });
      assertEquals(await exists(newDir), true);

      await rm(newDir, { recursive: true });
      assertEquals(await exists(newDir), false);
    });

    it("should remove directory with contents", async () => {
      const dirWithContents = path.join(TEST_DIR, "with_contents");
      await mkdir(dirWithContents, { recursive: true });
      await writeFile(path.join(dirWithContents, "file.txt"), "content");

      await rm(dirWithContents, { recursive: true });

      assertEquals(await exists(dirWithContents), false);
    });
  });

  describe("WalkEntry interface", () => {
    it("should provide correct entry properties", async () => {
      await ensureDir(path.join(TEST_DIR, "subdir"));
      await writeFile(path.join(TEST_DIR, "file.txt"), "content");

      const entries = [];
      for await (const entry of walk(TEST_DIR, { includeDirs: true })) {
        entries.push(entry);
      }

      // Check file entry
      const fileEntry = entries.find((e) => e.name === "file.txt");
      assertExists(fileEntry);
      assertEquals(fileEntry.isFile, true);
      assertEquals(fileEntry.isDirectory, false);
      assertEquals(fileEntry.isSymlink, false);
      assertExists(fileEntry.path);

      // Check directory entry
      const dirEntry = entries.find((e) => e.name === "subdir");
      assertExists(dirEntry);
      assertEquals(dirEntry.isFile, false);
      assertEquals(dirEntry.isDirectory, true);
      assertEquals(dirEntry.isSymlink, false);
    });
  });
});
