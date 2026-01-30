import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getFrameworkRoot, getFrameworkRootFromMeta, testGetFrameworkRoot } from "./vfs-paths.ts";

describe("getFrameworkRoot", () => {
  describe("standard dev paths", () => {
    it("should resolve Unix dev path correctly", () => {
      const devPath = "/Users/dev/code/veryfront-renderer/src/modules/server/module-server.ts";
      const result = getFrameworkRoot(devPath);
      assertEquals(result, "/Users/dev/code/veryfront-renderer");
    });

    it("should resolve Linux dev path correctly", () => {
      const devPath =
        "/home/developer/projects/veryfront-renderer/src/platform/compat/vfs-paths.ts";
      const result = getFrameworkRoot(devPath);
      assertEquals(result, "/home/developer/projects/veryfront-renderer");
    });
  });

  describe("compiled binary VFS paths", () => {
    it("should resolve deno-compile VFS path", () => {
      const vfsPath = "/tmp/deno-compile-veryfront/src/modules/server/module-server.ts";
      const result = getFrameworkRoot(vfsPath);
      assertEquals(result, "/tmp/deno-compile-veryfront");
    });

    it("should handle VFS path with random suffix", () => {
      const vfsPath = "/var/folders/xyz/deno-compile-abc123def/src/platform/compat/runtime.ts";
      const result = getFrameworkRoot(vfsPath);
      assertEquals(result, "/var/folders/xyz/deno-compile-abc123def");
    });

    it("should resolve production /app path", () => {
      const prodPath = "/app/src/modules/server/module-server.ts";
      const result = getFrameworkRoot(prodPath);
      assertEquals(result, "/app");
    });
  });

  describe("Windows paths", () => {
    it("should resolve Windows dev path with backslashes", () => {
      const winPath =
        "C:\\Users\\dev\\code\\veryfront-renderer\\src\\modules\\server\\module-server.ts";
      const result = getFrameworkRoot(winPath);
      assertEquals(result, "C:/Users/dev/code/veryfront-renderer");
    });

    it("should resolve Windows deno-compile VFS path", () => {
      const winVfsPath =
        "C:\\Users\\dev\\AppData\\Local\\Temp\\deno-compile-xyz\\src\\platform\\runtime.ts";
      const result = getFrameworkRoot(winVfsPath);
      assertEquals(result, "C:\\Users\\dev\\AppData\\Local\\Temp\\deno-compile-xyz");
    });

    it("should handle mixed slashes", () => {
      const mixedPath = "C:\\Users\\dev/code/veryfront-renderer/src\\modules/server.ts";
      const result = getFrameworkRoot(mixedPath);
      assertEquals(result, "C:/Users/dev/code/veryfront-renderer");
    });
  });

  describe("edge cases", () => {
    it("should return empty string for path without src/", () => {
      const noSrcPath = "/app/modules/server.ts";
      const result = getFrameworkRoot(noSrcPath);
      assertEquals(result, "");
    });

    it("should use last src/ when multiple exist", () => {
      // User has "src" in their home directory name
      const multiSrcPath = "/home/src-user/projects/veryfront-renderer/src/modules/server.ts";
      const result = getFrameworkRoot(multiSrcPath);
      assertEquals(result, "/home/src-user/projects/veryfront-renderer");
    });

    it("should handle empty string", () => {
      const result = getFrameworkRoot("");
      assertEquals(result, "");
    });
  });
});

describe("getFrameworkRootFromMeta", () => {
  it("should resolve from file:// URL", () => {
    const metaUrl = "file:///Users/dev/code/veryfront-renderer/src/platform/compat/vfs-paths.ts";
    const result = getFrameworkRootFromMeta(metaUrl);
    assertEquals(result, "/Users/dev/code/veryfront-renderer");
  });

  it("should resolve VFS URL from compiled binary", () => {
    const metaUrl = "file:///tmp/deno-compile-veryfront/src/modules/server/module-server.ts";
    const result = getFrameworkRootFromMeta(metaUrl);
    assertEquals(result, "/tmp/deno-compile-veryfront");
  });
});

describe("testGetFrameworkRoot (export for testing)", () => {
  it("should be same as getFrameworkRoot", () => {
    const path = "/app/src/test.ts";
    assertEquals(testGetFrameworkRoot(path), getFrameworkRoot(path));
  });
});
