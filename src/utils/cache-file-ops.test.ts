import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { isCacheWriteRaceError, verifyCacheFileExists, writeCacheFile } from "./cache-file-ops.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { FileInfo } from "#veryfront/platform/adapters/base.ts";

const FILE_STAT: FileInfo = {
  isFile: true,
  isDirectory: false,
  isSymlink: false,
  size: 100,
  mtime: null,
};

const DIR_STAT: FileInfo = {
  isFile: false,
  isDirectory: true,
  isSymlink: false,
  size: 0,
  mtime: null,
};

function createMockFs(overrides: Partial<FileSystem> = {}): FileSystem {
  return {
    readTextFile: () => Promise.resolve(""),
    readFile: () => Promise.resolve(new Uint8Array()),
    writeTextFile: () => Promise.resolve(),
    writeFile: () => Promise.resolve(),
    exists: () => Promise.resolve(true),
    stat: () => Promise.resolve(FILE_STAT),
    mkdir: () => Promise.resolve(),
    readDir: () => (async function* () {})(),
    remove: () => Promise.resolve(),
    makeTempDir: () => Promise.resolve("/tmp/test"),
    chmod: () => Promise.resolve(),
    ...overrides,
  } as FileSystem;
}

describe("cache-file-ops", () => {
  describe("writeCacheFile", () => {
    it("creates parent directory, writes file, and verifies", async () => {
      const calls: string[] = [];
      const fs = createMockFs({
        mkdir: (path, opts) => {
          calls.push(`mkdir:${path}:${JSON.stringify(opts)}`);
          return Promise.resolve();
        },
        writeTextFile: (path, _data) => {
          calls.push(`write:${path}`);
          return Promise.resolve();
        },
        stat: (path) => {
          calls.push(`stat:${path}`);
          return Promise.resolve(FILE_STAT);
        },
      });

      const result = await writeCacheFile(fs, "/cache/dir/file.js", "content", "TEST");
      assertEquals(result, true);
      assertEquals(calls[0], 'mkdir:/cache/dir:{"recursive":true}');
      assertEquals(calls[1], "write:/cache/dir/file.js");
      assertEquals(calls[2], "stat:/cache/dir/file.js");
    });

    it("throws when mkdir fails", async () => {
      const fs = createMockFs({
        mkdir: () => Promise.reject(new Error("permission denied")),
      });

      await assertRejects(
        () => writeCacheFile(fs, "/cache/dir/file.js", "content", "TEST"),
        Error,
        "permission denied",
      );
    });

    it("returns false when write race condition occurs (ENOENT)", async () => {
      const fs = createMockFs({
        writeTextFile: () => {
          const err = new Error("not found") as Error & { code: string };
          err.code = "ENOENT";
          return Promise.reject(err);
        },
      });

      const result = await writeCacheFile(fs, "/cache/dir/file.js", "content", "TEST");
      assertEquals(result, false);
    });

    it("throws on non-race write errors", async () => {
      const fs = createMockFs({
        writeTextFile: () => Promise.reject(new Error("disk full")),
      });

      await assertRejects(
        () => writeCacheFile(fs, "/cache/dir/file.js", "content", "TEST"),
        Error,
        "disk full",
      );
    });

    it("returns false when post-write verification fails", async () => {
      const fs = createMockFs({
        stat: () => Promise.reject(new Error("file gone")),
      });

      const result = await writeCacheFile(fs, "/cache/dir/file.js", "content", "TEST");
      assertEquals(result, false);
    });

    it("returns false when stat says not a file", async () => {
      const fs = createMockFs({
        stat: () => Promise.resolve(DIR_STAT),
      });

      const result = await writeCacheFile(fs, "/cache/dir/file.js", "content", "TEST");
      assertEquals(result, false);
    });
  });

  describe("verifyCacheFileExists", () => {
    it("returns true when file exists", async () => {
      const fs = createMockFs({
        stat: () => Promise.resolve(FILE_STAT),
      });

      const result = await verifyCacheFileExists(fs, "/cache/file.js", "TEST");
      assertEquals(result, true);
    });

    it("returns false when file does not exist", async () => {
      const fs = createMockFs({
        stat: () => Promise.reject(new Error("not found")),
      });

      const result = await verifyCacheFileExists(fs, "/cache/file.js", "TEST");
      assertEquals(result, false);
    });

    it("returns false when path is a directory", async () => {
      const fs = createMockFs({
        stat: () => Promise.resolve(DIR_STAT),
      });

      const result = await verifyCacheFileExists(fs, "/cache/file.js", "TEST");
      assertEquals(result, false);
    });
  });

  describe("isCacheWriteRaceError", () => {
    it("returns true for ENOENT code", () => {
      const err = new Error("not found") as Error & { code: string };
      err.code = "ENOENT";
      assertEquals(isCacheWriteRaceError(err), true);
    });

    it("returns true for os error 22 TypeError", () => {
      const err = new TypeError("os error 22");
      assertEquals(isCacheWriteRaceError(err), true);
    });

    it("returns false for generic errors", () => {
      assertEquals(isCacheWriteRaceError(new Error("disk full")), false);
    });

    it("returns false for null/undefined", () => {
      assertEquals(isCacheWriteRaceError(null), false);
      assertEquals(isCacheWriteRaceError(undefined), false);
    });
  });
});
