import "#veryfront/schemas/_test-setup.ts";

// Relocated from the colocated unit test: the local-filesystem fallback in
// resolveModuleFile reads through the process-wide local FileSystem singleton,
// so exercising it needs a real project directory on disk.

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { resolveModuleFile } from "#veryfront/transforms/mdx/esm-module-loader/resolution/file-finder.ts";

const mockAdapter = createMockAdapter();

describe("resolveModuleFile local filesystem fallback", () => {
  it("resolves project modules from disk when the adapter has no file index", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-file-finder-project-" });

    try {
      await mkdir(join(projectDir, "src", "components"), { recursive: true });
      await writeTextFile(
        join(projectDir, "src", "components", "Button.tsx"),
        `export const Button = "button-marker";`,
      );

      const result = await resolveModuleFile(
        "_vf_modules/components/Button.js",
        mockAdapter,
        projectDir,
      );

      assertExists(result, "Should resolve the project module from the local filesystem");
      assertEquals(
        result.actualFilePath,
        join(projectDir, "src", "components", "Button.tsx"),
        "resolves a project module by extension probing when the adapter has no file index",
      );
      assertEquals(
        result.sourceCode.includes("button-marker"),
        true,
        "returns the source of the probed file",
      );
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("resolves a directory index form when the adapter has no file index", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-file-finder-project-" });

    try {
      await mkdir(join(projectDir, "src", "lib"), { recursive: true });
      await writeTextFile(
        join(projectDir, "src", "lib", "index.ts"),
        `export const lib = "index-marker";`,
      );

      const result = await resolveModuleFile("_vf_modules/lib.js", mockAdapter, projectDir);

      assertExists(result, "Should resolve the directory index form");
      assertEquals(
        result.actualFilePath,
        join(projectDir, "src", "lib", "index.ts"),
        "resolves a directory index form",
      );
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
    }
  });

  it("returns null when no candidate exists on the local filesystem", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-file-finder-project-" });

    try {
      assertEquals(
        await resolveModuleFile("_vf_modules/components/Absent.js", mockAdapter, projectDir),
        null,
        "returns null when no candidate exists",
      );
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => undefined);
    }
  });
});
