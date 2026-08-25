import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import {
  createValidator,
  sanitizePathForDisplay,
  validateLexicalPath,
  validatePath,
  validatePathSync,
  ValidationPresets,
} from "./index.ts";
import { PathValidationError } from "./types.ts";

function createAdapterWithFs(
  overrides: Partial<RuntimeAdapter["fs"]>,
): RuntimeAdapter {
  const adapter = createMockAdapter();
  Object.assign(adapter.fs, overrides);
  return adapter;
}

describe("security/path-validation/index", () => {
  describe("validatePath", () => {
    const adapter = createMockAdapter();

    it("should accept a valid relative path within base", async () => {
      const result = await validatePath("src/file.ts", {
        baseDir: "/project",
        allowedDirs: ["src"],
        adapter,
      });

      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/src/file.ts");
    });

    it("should reject paths with null bytes", async () => {
      const result = await validatePath("src/\0evil.ts", {
        baseDir: "/project",
        adapter,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NULL_BYTE);
    });

    it("should reject absolute paths whenever allowAbsolute is false", async () => {
      const result = await validatePath("/etc/passwd", {
        baseDir: "/project",
        level: "strict",
        allowAbsolute: false,
        adapter,
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
        adapter,
      });

      assertEquals(result.valid, true);
    });

    it("should reject absolute paths in normal mode unless explicitly enabled", async () => {
      const result = await validatePath("/project/src/file.ts", {
        baseDir: "/project",
        level: "normal",
        allowedDirs: ["src"],
        adapter,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("should reject paths outside base directory", async () => {
      const result = await validatePath("../../etc/passwd", {
        baseDir: "/project",
        adapter,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should reject symlinks in strict mode", async () => {
      const mockAdapter = createAdapterWithFs({
        // lstat detects the link itself; stat() would follow it and hide it.
        lstat: (_path: string) =>
          Promise.resolve({
            isSymlink: true,
            isDirectory: false,
            isFile: true,
            size: 0,
            mtime: null,
          }),
      });

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

    it("fails closed when an adapter cannot prove no-follow symlink semantics", async () => {
      const adapter = createMockAdapter();
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");

      const result = await validatePath("src/file.ts", {
        baseDir: "/project",
        adapter,
        followSymlinks: false,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.SYMLINK_CAPABILITY_REQUIRED);
    });

    it("requires lstat for strict validation even when realPath is available", async () => {
      const adapter = createAdapterWithFs({
        realPath: (path: string) => Promise.resolve(path),
      });
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");

      const result = await validatePath("src/file.ts", {
        baseDir: "/project",
        level: "strict",
        adapter,
        allowAbsolute: false,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.SYMLINK_CAPABILITY_REQUIRED);
    });

    it("requires realPath before an adapter may follow symlinks", async () => {
      const adapter = createAdapterWithFs({
        lstat: () =>
          Promise.resolve({
            isSymlink: false,
            isDirectory: false,
            isFile: true,
            size: 0,
            mtime: null,
          }),
      });
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");

      const result = await validatePath("src/file.ts", {
        baseDir: "/project",
        adapter,
        followSymlinks: true,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.SYMLINK_CAPABILITY_REQUIRED);
    });

    it("accepts lexical validation only with an explicit symlink-free marker", async () => {
      const adapter = createMockAdapter();

      const result = await validatePath("src/file.ts", {
        baseDir: "/project",
        adapter,
        followSymlinks: false,
      });

      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/src/file.ts");
    });

    it("fails closed without a filesystem adapter, including physical presets", async () => {
      for (
        const options of [
          { baseDir: "/project" },
          ValidationPresets.userInput("/project"),
          ValidationPresets.static("/project"),
        ]
      ) {
        const result = await validatePath("src/file.ts", options as never);
        assertEquals(result.valid, false);
        assertEquals(result.code, PathValidationError.INVALID_PATH);
      }
    });

    it("enforces followSymlinks for intermediate links inside the trust root", async () => {
      if (Deno.build.os === "windows") return;

      const baseDir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${baseDir}/target`);
        await Deno.writeTextFile(`${baseDir}/target/file.ts`, "export {};");
        await Deno.symlink(`${baseDir}/target`, `${baseDir}/link`);
        const adapter = new DenoAdapter();

        const denied = await validatePath("link/file.ts", {
          baseDir,
          level: "normal",
          followSymlinks: false,
          adapter,
        });
        const allowed = await validatePath("link/file.ts", {
          baseDir,
          level: "normal",
          followSymlinks: true,
          adapter,
        });

        assertEquals(denied.code, PathValidationError.SYMLINK_DETECTED);
        assertEquals(allowed.valid, true);
        assertEquals(allowed.canonicalPath, await Deno.realPath(`${baseDir}/target/file.ts`));
      } finally {
        await Deno.remove(baseDir, { recursive: true });
      }
    });

    it("should reject when file not found and checkExists is true", async () => {
      const mockAdapter = createAdapterWithFs({
        stat: () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
      });

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

    it("propagates filesystem failures that are not not-found errors", async () => {
      const mockAdapter = createAdapterWithFs({
        stat: () =>
          Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })),
      });

      await assertRejects(
        () =>
          validatePath("src/private.ts", {
            baseDir: "/project",
            level: "normal",
            checkExists: true,
            adapter: mockAdapter,
            allowedDirs: ["src"],
          }),
        Error,
        "permission denied",
      );
    });

    it("should enforce allowedDirs restriction", async () => {
      const result = await validatePath("secret/data.ts", {
        baseDir: "/project",
        allowedDirs: ["src", "lib"],
        adapter,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should pass when no allowedDirs restriction is set", async () => {
      const result = await validatePath("anything/file.ts", {
        baseDir: "/project",
        adapter,
      });

      assertEquals(result.valid, true);
    });

    it("should resolve traversal in relative paths", async () => {
      const result = await validatePath("src/../lib/file.ts", {
        baseDir: "/project",
        allowedDirs: ["lib"],
        adapter,
      });

      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/lib/file.ts");
    });

    it("should reject a missing target beneath a symlinked parent outside the base", async () => {
      const mockAdapter = createAdapterWithFs({
        realPath: (path: string) => {
          if (path === "/project/link/new.txt") {
            return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
          }
          if (path === "/project/link") {
            return Promise.resolve("/outside");
          }
          if (path === "/project") {
            return Promise.resolve("/project");
          }
          return Promise.reject(new Error(`unexpected path: ${path}`));
        },
      });

      const result = await validatePath("link/new.txt", {
        baseDir: "/project",
        adapter: mockAdapter,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("rejects unknown, inherited, and accessor-backed options without invoking accessors", async () => {
      let getterCalls = 0;
      const accessorOptions = { baseDir: "/project" } as Record<string, unknown>;
      Object.defineProperty(accessorOptions, "allowedDirs", {
        enumerable: true,
        get() {
          getterCalls++;
          return ["src"];
        },
      });

      for (
        const options of [
          { baseDir: "/project", unknown: true },
          Object.create({ baseDir: "/project" }),
          accessorOptions,
        ]
      ) {
        const result = await validatePath("src/file.ts", options as never);
        assertEquals(result.code, PathValidationError.INVALID_PATH);
      }
      assertEquals(getterCalls, 0);
    });
  });

  describe("validateLexicalPath", () => {
    it("should accept a valid relative path within base", () => {
      const result = validateLexicalPath("src/file.ts", {
        baseDir: "/project",
        allowedDirs: ["src"],
      });

      assertEquals(result.valid, true);
    });

    it("should reject paths with null bytes", () => {
      const result = validateLexicalPath("src/\0evil.ts", { baseDir: "/project" });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NULL_BYTE);
    });

    it("should reject absolute paths unless explicitly enabled", () => {
      const result = validateLexicalPath("/etc/passwd", {
        baseDir: "/project",
        allowAbsolute: false,
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("should enforce allowedDirs", () => {
      const result = validateLexicalPath("secret/data.ts", {
        baseDir: "/project",
        allowedDirs: ["src"],
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.NOT_IN_ALLOWLIST);
    });

    it("should reject paths outside base directory", () => {
      const result = validateLexicalPath("../../etc/passwd", {
        baseDir: "/project",
      });

      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.OUTSIDE_BASE);
    });

    it("should accept paths with no allowedDirs", () => {
      const result = validateLexicalPath("anything/file.ts", {
        baseDir: "/project",
      });

      assertEquals(result.valid, true);
    });

    it("rejects malformed lexical policy objects and directory lists", () => {
      const unknownOption = validateLexicalPath("src/file.ts", {
        baseDir: "/project",
        unknown: true,
      } as never);
      const nestedAllowedDir = validateLexicalPath("src/file.ts", {
        baseDir: "/project",
        allowedDirs: ["src/nested"],
      });

      assertEquals(unknownOption.code, PathValidationError.INVALID_PATH);
      assertEquals(nestedAllowedDir.code, PathValidationError.INVALID_PATH);
    });
  });

  describe("validatePathSync compatibility", () => {
    it("delegates legacy policy fields to hardened lexical validation", () => {
      const options = {
        baseDir: "/project",
        allowedDirs: ["src"],
        level: "strict" as const,
        followSymlinks: true,
        checkExists: true,
        adapter: createMockAdapter(),
      };

      assertEquals(
        validatePathSync("src/file.ts", options),
        validateLexicalPath("src/file.ts", {
          baseDir: "/project",
          allowedDirs: ["src"],
        }),
      );
      assertEquals(
        validatePathSync("../outside.ts", options).code,
        PathValidationError.OUTSIDE_BASE,
      );
      assertEquals(
        validatePathSync("/etc/passwd", options).code,
        PathValidationError.ABSOLUTE_PATH_DENIED,
        "legacy policy fields must not weaken absolute-path containment",
      );
    });

    it("forwards an explicit allowAbsolute without widening base containment", () => {
      const options = {
        baseDir: "/project",
        allowAbsolute: true,
        adapter: createMockAdapter(),
      };

      assertEquals(
        validatePathSync("/project/src/file.ts", options).valid,
        true,
        "an explicit allowAbsolute admits an in-base absolute path",
      );
      assertEquals(
        validatePathSync("/etc/passwd", options).code,
        PathValidationError.OUTSIDE_BASE,
        "allowAbsolute still enforces base containment",
      );
    });

    it("rejects hostile compatibility policy objects without invoking accessors", () => {
      let getterCalls = 0;
      const options = { baseDir: "/project" } as Record<string, unknown>;
      Object.defineProperty(options, "level", {
        enumerable: true,
        get() {
          getterCalls++;
          return "normal";
        },
      });

      assertEquals(
        validatePathSync("src/file.ts", options as never).code,
        PathValidationError.INVALID_PATH,
      );
      assertEquals(getterCalls, 0);
    });
  });

  describe("createValidator", () => {
    it("should return a function that validates with default options", async () => {
      const validate = createValidator({
        baseDir: "/project",
        allowedDirs: ["src"],
        adapter: createMockAdapter(),
      });

      const result = await validate("src/file.ts");
      assertEquals(result.valid, true);
    });

    it("should allow overriding options per call", async () => {
      const validate = createValidator({
        baseDir: "/project",
        allowedDirs: ["src"],
        adapter: createMockAdapter(),
      });

      const result = await validate("lib/file.ts", { allowedDirs: ["lib"] });
      assertEquals(result.valid, true);
    });

    it("should reject invalid paths through the created validator", async () => {
      const validate = createValidator({
        baseDir: "/project",
        level: "strict",
        adapter: createMockAdapter(),
      });

      const result = await validate("/etc/passwd");
      assertEquals(result.valid, false);
      assertEquals(result.code, PathValidationError.ABSOLUTE_PATH_DENIED);
    });

    it("snapshots defaults and rejects hostile overrides", async () => {
      const allowedDirs = ["src"];
      const defaults = {
        baseDir: "/project",
        allowedDirs,
        adapter: createMockAdapter(),
      };
      const validate = createValidator(defaults);
      allowedDirs.push("secret");
      defaults.baseDir = "/outside";

      const denied = await validate("secret/file.ts");
      assertEquals(denied.code, PathValidationError.NOT_IN_ALLOWLIST);

      let getterCalls = 0;
      const overrides = {} as Record<string, unknown>;
      Object.defineProperty(overrides, "allowedDirs", {
        enumerable: true,
        get() {
          getterCalls++;
          return ["secret"];
        },
      });
      const hostile = await validate("secret/file.ts", overrides as never);
      assertEquals(hostile.code, PathValidationError.INVALID_PATH);
      assertEquals(getterCalls, 0);
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

    it("should not treat a sibling with a shared prefix as inside the base", () => {
      const result = sanitizePathForDisplay("/project-secret/nested/file.ts", "/project");
      assertEquals(result, "file.ts");
    });

    it("should normalize traversal before stripping the base", () => {
      const result = sanitizePathForDisplay("/project/src/../../secret/file.ts", "/project");
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
      const result = sanitizePathForDisplay(
        "/completely/different/path/deep/file.ts",
        "/project",
      );
      assertEquals(result, "file.ts");
    });
  });
});
