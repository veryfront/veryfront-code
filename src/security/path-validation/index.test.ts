import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createValidator,
  sanitizePathForDisplay,
  validatePath,
  validatePathSync,
} from "./index.ts";
import { PathValidationError } from "./types.ts";

describe("security/path-validation/index", () => {
  describe("validatePath", () => {
    it("should accept a valid relative path within base", async () => {
      const result = await validatePath("src/file.ts", {
        baseDir: "/project",
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/src/file.ts");
    });

    it("should reject paths with null bytes", async () => {
      const result = await validatePath("src/\0evil.ts", { baseDir: "/project" });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NULL_BYTE);
    });

    it("should reject absolute paths in strict mode when allowAbsolute is false", async () => {
      const result = await validatePath("/etc/passwd", {
        baseDir: "/project",
        level: "strict",
        allowAbsolute: false,
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("should allow absolute paths when allowAbsolute is true", async () => {
      const result = await validatePath("/project/src/file.ts", {
        baseDir: "/project",
        level: "strict",
        allowAbsolute: true,
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, true);
    });

    it("should allow absolute paths in normal mode even without allowAbsolute", async () => {
      const result = await validatePath("/project/src/file.ts", {
        baseDir: "/project",
        level: "normal",
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, true);
    });

    it("should reject paths outside base directory", async () => {
      const result = await validatePath("../../etc/passwd", {
        baseDir: "/project",
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should reject symlinks in strict mode", async () => {
      const mockAdapter = {
        fs: {
          stat: (_path: string) =>
            Promise.resolve({ isSymlink: true, isDirectory: false, isFile: true, size: 0 }),
        },
      } as Parameters<typeof validatePath>[1]["adapter"];

      const result = await validatePath("src/link.ts", {
        baseDir: "/project",
        level: "strict",
        followSymlinks: true,
        adapter: mockAdapter,
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.SYMLINK_DETECTED);
    });

    it("should reject when file not found and checkExists is true", async () => {
      const mockAdapter = {
        fs: {
          stat: () => Promise.reject(new Error("ENOENT")),
        },
      } as Parameters<typeof validatePath>[1]["adapter"];

      const result = await validatePath("src/missing.ts", {
        baseDir: "/project",
        level: "normal",
        checkExists: true,
        adapter: mockAdapter,
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.FILE_NOT_FOUND);
    });

    it("should enforce allowedDirs restriction", async () => {
      const result = await validatePath("secret/data.ts", {
        baseDir: "/project",
        allowedDirs: ["src", "lib"],
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should pass when no allowedDirs restriction is set", async () => {
      const result = await validatePath("anything/file.ts", {
        baseDir: "/project",
      });
      assertEquals(result.valid, true);
    });

    it("should resolve traversal in relative paths", async () => {
      const result = await validatePath("src/../lib/file.ts", {
        baseDir: "/project",
        allowedDirs: ["lib"],
      });
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/lib/file.ts");
    });
  });

  describe("validatePathSync", () => {
    it("should accept a valid relative path within base", () => {
      const result = validatePathSync("src/file.ts", {
        baseDir: "/project",
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, true);
    });

    it("should reject paths with null bytes", () => {
      const result = validatePathSync("src/\0evil.ts", { baseDir: "/project" });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NULL_BYTE);
    });

    it("should reject absolute paths in strict mode", () => {
      const result = validatePathSync("/etc/passwd", {
        baseDir: "/project",
        level: "strict",
        allowAbsolute: false,
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("should enforce allowedDirs", () => {
      const result = validatePathSync("secret/data.ts", {
        baseDir: "/project",
        allowedDirs: ["src"],
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should reject paths outside base directory", () => {
      const result = validatePathSync("../../etc/passwd", {
        baseDir: "/project",
      });
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should accept paths with no allowedDirs", () => {
      const result = validatePathSync("anything/file.ts", {
        baseDir: "/project",
      });
      assertEquals(result.valid, true);
    });
  });

  describe("createValidator", () => {
    it("should return a function that validates with default options", async () => {
      const validate = createValidator({
        baseDir: "/project",
        allowedDirs: ["src"],
      });

      const result = await validate("src/file.ts");
      assertEquals(result.valid, true);
    });

    it("should allow overriding options per call", async () => {
      const validate = createValidator({
        baseDir: "/project",
        allowedDirs: ["src"],
      });

      const result = await validate("lib/file.ts", { allowedDirs: ["lib"] });
      assertEquals(result.valid, true);
    });

    it("should reject invalid paths through the created validator", async () => {
      const validate = createValidator({
        baseDir: "/project",
        level: "strict",
      });

      const result = await validate("/etc/passwd");
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });
  });

  describe("sanitizePathForDisplay", () => {
    it("should strip the base directory prefix", () => {
      const result = sanitizePathForDisplay("/project/src/file.ts", "/project");
      assertEquals(result, "src/file.ts");
    });

    it("should strip leading slash from result", () => {
      const result = sanitizePathForDisplay("/project/file.ts", "/project");
      assertEquals(result, "file.ts");
    });

    it("should return filename when path is not under base", () => {
      const result = sanitizePathForDisplay("/other/dir/file.ts", "/project");
      assertEquals(result, "file.ts");
    });

    it("should handle Windows-style backslashes", () => {
      const result = sanitizePathForDisplay("C:\\project\\src\\file.ts", "C:\\project");
      assertEquals(result, "src/file.ts");
    });

    it("should return the path itself when it has no separators and is not under base", () => {
      const result = sanitizePathForDisplay("file.ts", "/project");
      assertEquals(result, "file.ts");
    });

    it("should handle base directory with trailing slash", () => {
      const result = sanitizePathForDisplay("/project/src/file.ts", "/project/");
      assertEquals(result, "src/file.ts");
    });

    it("should return the full normalized path when base does not match", () => {
      const result = sanitizePathForDisplay("/completely/different/path/deep/file.ts", "/project");
      assertEquals(result, "file.ts");
    });
  });
});
