import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ESBUILD_VERSION, getEsbuildBinaryName, getVFSBasePath } from "./esbuild-shared.ts";

describe("platform/compat/esbuild-shared", () => {
  describe("ESBUILD_VERSION", () => {
    it("should be a semver string", () => {
      assertEquals(typeof ESBUILD_VERSION, "string");
      assertEquals(/^\d+\.\d+\.\d+/.test(ESBUILD_VERSION), true);
    });
  });

  describe("getEsbuildBinaryName", () => {
    it("should return a string containing the OS name", () => {
      const name = getEsbuildBinaryName();
      assertEquals(typeof name, "string");
      assertEquals(name.startsWith("@esbuild/"), true);
      assertEquals(name.includes(Deno.build.os), true);
    });

    it("should map x86_64 to x64", () => {
      const name = getEsbuildBinaryName();
      if (Deno.build.arch === "x86_64") {
        assertEquals(name.endsWith("-x64"), true);
      }
    });

    it("should map aarch64 to arm64", () => {
      const name = getEsbuildBinaryName();
      if (Deno.build.arch === "aarch64") {
        assertEquals(name.endsWith("-arm64"), true);
      }
    });
  });

  describe("getVFSBasePath", () => {
    it("should return deno-compile base when path matches deno-compile pattern", () => {
      const result = getVFSBasePath(
        "/tmp/deno-compile-abc123/node_modules/esbuild/bin/esbuild",
        "/tmp",
      );
      assertEquals(result, "/tmp/deno-compile-abc123");
    });

    it("should return parent of src when path contains src directory", () => {
      const result = getVFSBasePath(
        "/home/user/project/src/platform/compat/esbuild.ts",
        "/tmp",
      );
      assertEquals(result, "/home/user/project");
    });

    it("should use last src index when multiple src directories exist", () => {
      const result = getVFSBasePath(
        "/home/user/src/project/src/platform/compat/esbuild.ts",
        "/tmp",
      );
      assertEquals(result, "/home/user/src/project");
    });

    it("should fallback to temp dir when no patterns match", () => {
      const result = getVFSBasePath("/some/random/path/file.ts", "/tmp");
      assertEquals(result, "/tmp/deno-compile-veryfront");
    });

    it("should fallback when src is at index 0", () => {
      const result = getVFSBasePath("src/platform/compat/esbuild.ts", "/tmp");
      assertEquals(result, "/tmp/deno-compile-veryfront");
    });

    it("should prefer deno-compile match over src match", () => {
      const result = getVFSBasePath(
        "/tmp/deno-compile-xyz/src/platform/compat/esbuild.ts",
        "/tmp",
      );
      assertEquals(result, "/tmp/deno-compile-xyz");
    });
  });
});
