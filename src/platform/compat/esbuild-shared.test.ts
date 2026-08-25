import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ESBUILD_VERSION,
  ESBUILD_WASM_URL,
  getEsbuildBinaryName,
  getVFSBasePath,
  mapEsbuildArch,
} from "./esbuild-shared.ts";

describe("platform/compat/esbuild-shared", () => {
  describe("ESBUILD_VERSION", () => {
    it("should be a semver string", () => {
      assertEquals(typeof ESBUILD_VERSION, "string");
      assertEquals(/^\d+\.\d+\.\d+/.test(ESBUILD_VERSION), true);
    });

    it("keeps the default WASM artifact on the authoritative esbuild version", () => {
      assertEquals(
        ESBUILD_WASM_URL,
        `https://deno.land/x/esbuild@v${ESBUILD_VERSION}/esbuild.wasm`,
      );
    });
  });

  describe("getEsbuildBinaryName", () => {
    it("should return a string containing the OS name", () => {
      const name = getEsbuildBinaryName();
      assertEquals(typeof name, "string");
      assertEquals(name.startsWith("@esbuild/"), true);
      assertEquals(name.includes(Deno.build.os), true);
    });

    it("maps every Deno arch to the esbuild package arch regardless of host", () => {
      for (
        const [input, expected] of [
          ["x86_64", "x64"],
          ["aarch64", "arm64"],
          ["riscv64", "riscv64"],
        ] as const
      ) {
        assertEquals(
          mapEsbuildArch(input),
          expected,
          `${input} maps to the esbuild package arch ${expected}`,
        );
      }
      assertEquals(
        getEsbuildBinaryName(),
        `@esbuild/${Deno.build.os}-${mapEsbuildArch(Deno.build.arch)}`,
        "binary name is os plus mapped arch",
      );
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
