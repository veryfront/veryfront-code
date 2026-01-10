import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { afterAll, beforeAll, describe, it } from "jsr:@std/testing@1/bdd";
import { createFileSystem, type FileSystem } from "./fs.ts";

describe("fs.ts", () => {
  describe("createFileSystem", () => {
    it("should export createFileSystem function", () => {
      assertExists(createFileSystem);
      assertEquals(typeof createFileSystem, "function");
    });

    it("should return a FileSystem instance", () => {
      const fs = createFileSystem();
      assertExists(fs);
      assertExists(fs.readTextFile);
      assertExists(fs.readFile);
      assertExists(fs.writeTextFile);
      assertExists(fs.writeFile);
      assertExists(fs.exists);
      assertExists(fs.stat);
      assertExists(fs.mkdir);
      assertExists(fs.readDir);
      assertExists(fs.remove);
      assertExists(fs.makeTempDir);
    });
  });

  describe("FileSystem operations", () => {
    let fs: FileSystem;
    let tempDir: string;

    beforeAll(async () => {
      fs = createFileSystem();
      tempDir = await fs.makeTempDir({ prefix: "fs-test-" });
    });

    afterAll(async () => {
      try {
        await fs.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should create temp directory", async () => {
      assertExists(tempDir);
      const stat = await fs.stat(tempDir);
      assertEquals(stat.isDirectory, true);
    });

    it("should write and read text file", async () => {
      const testPath = `${tempDir}/test.txt`;
      const content = "Hello, World!";

      await fs.writeTextFile(testPath, content);
      const read = await fs.readTextFile(testPath);

      assertEquals(read, content);
    });

    it("should write and read binary file", async () => {
      const testPath = `${tempDir}/test.bin`;
      const content = new Uint8Array([1, 2, 3, 4, 5]);

      await fs.writeFile(testPath, content);
      const read = await fs.readFile(testPath);

      assertEquals(read, content);
    });

    it("should check existence", async () => {
      const testPath = `${tempDir}/exists.txt`;

      assertEquals(await fs.exists(testPath), false);

      await fs.writeTextFile(testPath, "exists");
      assertEquals(await fs.exists(testPath), true);
    });

    it("should stat file", async () => {
      const testPath = `${tempDir}/stat.txt`;
      await fs.writeTextFile(testPath, "stat test content");

      const stat = await fs.stat(testPath);

      assertEquals(stat.isFile, true);
      assertEquals(stat.isDirectory, false);
      assertEquals(typeof stat.size, "number");
      assertEquals(stat.size > 0, true);
    });

    it("should create directory", async () => {
      const dirPath = `${tempDir}/subdir`;

      await fs.mkdir(dirPath);
      const stat = await fs.stat(dirPath);

      assertEquals(stat.isDirectory, true);
    });

    it("should create nested directories with recursive option", async () => {
      const dirPath = `${tempDir}/nested/deep/dir`;

      await fs.mkdir(dirPath, { recursive: true });
      const stat = await fs.stat(dirPath);

      assertEquals(stat.isDirectory, true);
    });

    it("should read directory contents", async () => {
      const dirPath = `${tempDir}/readdir-test`;
      await fs.mkdir(dirPath);
      await fs.writeTextFile(`${dirPath}/file1.txt`, "content1");
      await fs.writeTextFile(`${dirPath}/file2.txt`, "content2");

      const entries: string[] = [];
      for await (const entry of fs.readDir(dirPath)) {
        entries.push(entry.name);
      }

      assertEquals(entries.includes("file1.txt"), true);
      assertEquals(entries.includes("file2.txt"), true);
    });

    it("should remove file", async () => {
      const testPath = `${tempDir}/to-remove.txt`;
      await fs.writeTextFile(testPath, "to remove");

      assertEquals(await fs.exists(testPath), true);
      await fs.remove(testPath);
      assertEquals(await fs.exists(testPath), false);
    });

    it("should remove directory with recursive option", async () => {
      const dirPath = `${tempDir}/to-remove-dir`;
      await fs.mkdir(dirPath);
      await fs.writeTextFile(`${dirPath}/file.txt`, "content");

      assertEquals(await fs.exists(dirPath), true);
      await fs.remove(dirPath, { recursive: true });
      assertEquals(await fs.exists(dirPath), false);
    });
  });
});
