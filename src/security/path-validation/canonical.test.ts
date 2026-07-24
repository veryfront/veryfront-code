import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";
import { PathValidationError } from "./types.ts";

describe("security/path-validation/canonical", () => {
  describe("getCanonicalPath", () => {
    it("should resolve path segments without adapter", async () => {
      const { path, isSymlink } = await getCanonicalPath("/a/b/../c");
      assertEquals(path, "/a/c");
      assertEquals(isSymlink, false);
    });

    it("should resolve dot segments", async () => {
      const { path, isSymlink } = await getCanonicalPath("/a/./b/./c");
      assertEquals(path, "/a/b/c");
      assertEquals(isSymlink, false);
    });

    it("should return isSymlink false when followSymlinks is false", async () => {
      const { isSymlink } = await getCanonicalPath("/some/path", undefined, false);
      assertEquals(isSymlink, false);
    });

    it("should return isSymlink false when adapter is undefined", async () => {
      const { isSymlink } = await getCanonicalPath("/some/path", undefined, true);
      assertEquals(isSymlink, false);
    });

    it("should detect symlinks via adapter.fs.lstat", async () => {
      // lstat (not stat) is the correct symlink detector: stat() follows the
      // link and always reports isSymlink:false, so detection must use lstat.
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          lstat: (_path: string) =>
            Promise.resolve({
              isSymlink: true,
              isDirectory: false,
              isFile: true,
              size: 0,
            }),
        },
      };

      const { isSymlink } = await getCanonicalPath("/some/path", mockAdapter, true);
      assertEquals(isSymlink, true);
    });

    it("should fall back gracefully when adapter.fs.stat throws", async () => {
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          stat: () => Promise.reject(new Error("not found")),
        },
      };

      const { path, isSymlink } = await getCanonicalPath("/some/path", mockAdapter, true);
      assertEquals(path, "/some/path");
      assertEquals(isSymlink, false);
    });

    it("should handle relative paths", async () => {
      const { path } = await getCanonicalPath("a/b/../c");
      assertEquals(path, "a/c");
    });

    it("should resolve the nearest existing ancestor for a missing target", async () => {
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          realPath: (path: string) => {
            if (path === "/project/link/new.txt") {
              return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
            }
            if (path === "/project/link") {
              return Promise.resolve("/outside");
            }
            return Promise.reject(new Error(`unexpected path: ${path}`));
          },
        },
      };

      const result = await getCanonicalPath("/project/link/new.txt", mockAdapter);

      assertEquals(result.path, "/outside/new.txt");
    });

    it("should resolve symlinks before parent segments for a missing target", async () => {
      if (Deno.build.os === "windows") return;

      const root = await Deno.makeTempDir({ prefix: "vf-canonical-" });
      const baseDir = `${root}/base`;
      const outsideDir = `${root}/outside`;
      try {
        await Deno.mkdir(baseDir);
        await Deno.mkdir(`${outsideDir}/child`, { recursive: true });
        await Deno.symlink(`${outsideDir}/child`, `${baseDir}/link`);

        const adapter: Parameters<typeof getCanonicalPath>[1] = {
          fs: { realPath: (path: string) => Deno.realPath(path) },
        };
        const physicalParent = await Deno.realPath(`${baseDir}/link/..`);
        const result = await getCanonicalPath(`${baseDir}/link/../new.txt`, adapter);

        assertEquals(result.path, `${physicalParent}/new.txt`);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("should preserve the root while walking a missing Windows drive path", async () => {
      const candidates: string[] = [];
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          realPath: (path: string) => {
            candidates.push(path);
            if (path === "C:/") return Promise.resolve("C:/");
            return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
          },
        },
      };

      const result = await getCanonicalPath("C:/project/new.txt", mockAdapter);

      assertEquals(result.path, "C:/project/new.txt");
      assertEquals(candidates, ["C:/project/new.txt", "C:/project", "C:/"]);
    });

    it("should propagate realPath errors other than not found", async () => {
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          realPath: () =>
            Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
        },
      };

      await assertRejects(
        () => getCanonicalPath("/project/file.txt", mockAdapter),
        Error,
        "permission denied",
      );
    });

    it("should propagate lstat errors other than not found", async () => {
      const mockAdapter: Parameters<typeof getCanonicalPath>[1] = {
        fs: {
          lstat: () =>
            Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
        },
      };

      await assertRejects(
        () => getCanonicalPath("/project/file.txt", mockAdapter),
        Error,
        "permission denied",
      );
    });
  });

  describe("validateAllowedDirs", () => {
    it("should return valid when path is within base and no allowedDirs", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", []);
      assertEquals(valid, true);
    });

    it("should return invalid when path is outside base directory", () => {
      const { valid, code } = validateAllowedDirs("/other/file.ts", "/project", []);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.OUTSIDE_BASE);
    });

    it("should return valid when path equals base directory", () => {
      const { valid } = validateAllowedDirs("/project", "/project", ["src"]);
      assertEquals(valid, true);
    });

    it("should return valid when top-level dir is in allowedDirs", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", ["src", "lib"]);
      assertEquals(valid, true);
    });

    it("should return invalid when top-level dir is not in allowedDirs", () => {
      const { valid, code } = validateAllowedDirs("/project/secret/file.ts", "/project", [
        "src",
        "lib",
      ]);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should handle paths with trailing slashes in base", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project/", ["src"]);
      assertEquals(valid, true);
    });

    it("should handle Windows-style separators", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", ["src"]);
      assertEquals(valid, true);
    });

    it("should return invalid for sibling directories that share prefix", () => {
      const { valid, code } = validateAllowedDirs("/project-evil/file.ts", "/project", []);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.OUTSIDE_BASE);
    });

    it("should resolve dot-dot segments before validation", () => {
      const { valid } = validateAllowedDirs("/project/src/../lib/file.ts", "/project", ["lib"]);
      assertEquals(valid, true);
    });
  });
});
