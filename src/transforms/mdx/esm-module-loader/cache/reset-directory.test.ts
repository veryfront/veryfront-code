import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { resetCacheDirectory } from "./reset-directory.ts";

type DirectoryResetFileSystem = Pick<FileSystem, "mkdir" | "remove">;

describe("resetCacheDirectory", () => {
  it("recreates a directory that is already absent", async () => {
    const calls: string[] = [];
    const missingError = Object.assign(new Error("cache is absent"), { code: "ENOENT" });
    const fs: DirectoryResetFileSystem = {
      remove: () => {
        calls.push("remove");
        return Promise.reject(missingError);
      },
      mkdir: () => {
        calls.push("mkdir");
        return Promise.resolve();
      },
    };

    await resetCacheDirectory(fs, "/cache");
    assertEquals(calls, ["remove", "mkdir"]);
  });

  it("propagates an operational removal failure without claiming success", async () => {
    const permissionError = Object.assign(new Error("cache removal denied"), {
      code: "EACCES",
    });
    let mkdirCalled = false;
    const fs: DirectoryResetFileSystem = {
      remove: () => Promise.reject(permissionError),
      mkdir: () => {
        mkdirCalled = true;
        return Promise.resolve();
      },
    };

    const error = await assertRejects(
      () => resetCacheDirectory(fs, "/cache"),
      Error,
      "cache removal denied",
    );
    assertEquals(error, permissionError);
    assertEquals(mkdirCalled, false);
  });

  it("propagates recreation failures", async () => {
    const ioError = Object.assign(new Error("cache recreation failed"), { code: "EIO" });
    const fs: DirectoryResetFileSystem = {
      remove: () => Promise.resolve(),
      mkdir: () => Promise.reject(ioError),
    };

    const error = await assertRejects(
      () => resetCacheDirectory(fs, "/cache"),
      Error,
      "cache recreation failed",
    );
    assertEquals(error, ioError);
  });
});
