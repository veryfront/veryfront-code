import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";
import { PathValidationError } from "./types.ts";

function createAdapterWithFs(
  overrides: Partial<RuntimeAdapter["fs"]>,
): RuntimeAdapter {
  const adapter = createMockAdapter();
  Object.assign(adapter.fs, overrides);
  return adapter;
}

describe("security/path-validation/canonical", () => {
  describe("getCanonicalPath", () => {
    it("requires a runtime adapter instead of degrading to lexical resolution", async () => {
      await assertRejects(
        () => getCanonicalPath("/a/b/../c", undefined as never),
        TypeError,
        "requires a runtime adapter",
      );
    });

    it("should detect symlinks via adapter.fs.lstat", async () => {
      // lstat (not stat) is the correct symlink detector: stat() follows the
      // link and always reports isSymlink:false, so detection must use lstat.
      const mockAdapter = createAdapterWithFs({
        lstat: (_path: string) =>
          Promise.resolve({
            isSymlink: true,
            isDirectory: false,
            isFile: true,
            size: 0,
            mtime: null,
          }),
      });

      const { isSymlink } = await getCanonicalPath("/some/path", mockAdapter);
      assertEquals(isSymlink, true);
    });

    it("should resolve the nearest existing ancestor for a missing target", async () => {
      const mockAdapter = createAdapterWithFs({
        realPath: (path: string) => {
          if (path === "/project/link/new.txt") {
            return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
          }
          if (path === "/project/link") {
            return Promise.resolve("/outside");
          }
          return Promise.reject(new Error(`unexpected path: ${path}`));
        },
      });

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

        const adapter = createAdapterWithFs({
          realPath: (path: string) => Deno.realPath(path),
        });
        const physicalParent = await Deno.realPath(`${baseDir}/link/..`);
        const result = await getCanonicalPath(`${baseDir}/link/../new.txt`, adapter);

        assertEquals(result.path, `${physicalParent}/new.txt`);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("should fail closed when a missing traversal segment has no canonical ancestor", async () => {
      // Returning null here would drop the caller into purely lexical
      // resolution, which is exactly the escape the physical walk prevents.
      const mockAdapter = createAdapterWithFs({
        realPath: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
      });

      await assertRejects(
        () => getCanonicalPath("/project/missing/../new.txt", mockAdapter),
        Error,
        "missing traversal segment",
        "a missing component in front of a traversal segment must fail closed",
      );
    });

    it("should resolve ancestors physically on the collapsed traversal retry", async () => {
      const mockAdapter = createAdapterWithFs({
        realPath: (path: string) => {
          if (path === "/project/new.txt") return Promise.resolve("/physical/new.txt");
          if (path === "/project") return Promise.resolve("/physical");
          return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
        },
      });

      const result = await getCanonicalPath("/project/missing/../new.txt", mockAdapter);

      assertEquals(
        result.path,
        "/physical/new.txt",
        "the collapsed retry must still resolve ancestors physically",
      );
    });

    it("should preserve the root while walking a missing Windows drive path", async () => {
      const candidates: string[] = [];
      const mockAdapter = createAdapterWithFs({
        realPath: (path: string) => {
          candidates.push(path);
          if (path === "C:/") return Promise.resolve("C:/");
          return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
        },
      });

      const result = await getCanonicalPath("C:/project/new.txt", mockAdapter);

      assertEquals(result.path, "C:/project/new.txt");
      assertEquals(candidates, ["C:/project/new.txt", "C:/project", "C:/"]);
    });

    it("should propagate realPath errors other than not found", async () => {
      const mockAdapter = createAdapterWithFs({
        realPath: () =>
          Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
      });

      await assertRejects(
        () => getCanonicalPath("/project/file.txt", mockAdapter),
        Error,
        "permission denied",
      );
    });

    it("should propagate lstat errors other than not found", async () => {
      const mockAdapter = createAdapterWithFs({
        lstat: () =>
          Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
      });

      await assertRejects(
        () => getCanonicalPath("/project/file.txt", mockAdapter),
        Error,
        "permission denied",
      );
    });
  });

  describe("validateAllowedDirs", () => {
    it("should return valid when path is within base and no allowedDirs", () => {
      const { valid } = validateAllowedDirs("/project/src/file.ts", "/project", undefined);
      assertEquals(valid, true);
    });

    it("should treat an explicit empty allowlist as deny-all", () => {
      const { valid, code } = validateAllowedDirs("/project/src/file.ts", "/project", []);
      assertEquals(valid, false);
      assertEquals(code, PathValidationError.NOT_IN_ALLOWLIST);
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
