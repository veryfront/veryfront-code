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
