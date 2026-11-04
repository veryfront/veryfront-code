import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { ensureEsbuildBinary, getVFSBasePath } from "./binary.ts";

describe("ensureEsbuildBinary runtime guards", () => {
  it("is a no-op under Node where Deno is absent", async () => {
    await ensureEsbuildBinary();
  });
});

describe("compiled esbuild VFS root", () => {
  it("preserves the compiled project prefix before the extension", () => {
    assertEquals(
      getVFSBasePath(
        "/tmp/deno-compile-candidate/project/extensions/ext-bundler-esbuild/src/binary.ts",
        "/tmp",
      ),
      "/tmp/deno-compile-candidate/project",
    );
  });
  it("resolves the extension's dependency root outside compiled layouts", () => {
    assertEquals(
      getVFSBasePath("/workspace/project/extensions/ext-bundler-esbuild/src/binary.ts", "/tmp"),
      "/workspace/project",
    );
  });

  it("preserves fallback behavior for other module layouts", () => {
    assertEquals(
      getVFSBasePath("/tmp/deno-compile-candidate/other/file.ts", "/tmp"),
      "/tmp/deno-compile-candidate",
    );
    assertEquals(
      getVFSBasePath("/workspace/project/src/other/file.ts", "/tmp"),
      "/workspace/project",
    );
    assertEquals(getVFSBasePath("/unknown/file.ts", "/tmp"), "/tmp/deno-compile-veryfront");
  });

  it("keeps direct-root compile layouts", () => {
    assertEquals(
      getVFSBasePath(
        "/tmp/deno-compile-candidate/extensions/ext-bundler-esbuild/src/binary.ts",
        "/tmp",
      ),
      "/tmp/deno-compile-candidate",
    );
  });
});
