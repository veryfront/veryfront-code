// These checks create real directories and symbolic links because physical
// containment cannot be proven through the hermetic unit-test filesystem.
// Keep the pure path-resolution cases beside the CLI command.
import "#veryfront/schemas/_test-setup.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, remove, symlink } from "#veryfront/platform/compat/fs.ts";
import { runtime } from "#cli/runtime-adapter";
import { join } from "veryfront/platform/path";
import { assertConfiguredBuildOutputPhysicallyContained } from "../../../../../cli/commands/build/command.ts";

describe("configured build output physical containment", () => {
  it("rejects an absent output below an intermediate symlink", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-build-output-" });
    const projectDir = join(tempDir, "project");
    const externalDir = join(tempDir, "external");
    await mkdir(projectDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    await symlink(externalDir, join(projectDir, "link"));

    try {
      const adapter = await runtime.get();
      await assertRejects(
        () =>
          assertConfiguredBuildOutputPhysicallyContained(adapter, projectDir, {
            build: { outDir: "link/release" },
          }),
        Error,
        "physically inside the project",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("rejects an output symlink whose target remains inside the project", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-build-output-" });
    const projectDir = join(tempDir, "project");
    const artifactsDir = join(projectDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    await symlink(artifactsDir, join(projectDir, "output"));

    try {
      const adapter = await runtime.get();
      await assertRejects(
        () =>
          assertConfiguredBuildOutputPhysicallyContained(adapter, projectDir, {
            build: { outDir: "output" },
          }),
        Error,
        "must not traverse symbolic links",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("accepts an absent output below the physical project directory", async () => {
    const tempDir = await makeTempDir({ prefix: "veryfront-build-output-" });
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    try {
      const adapter = await runtime.get();
      await assertConfiguredBuildOutputPhysicallyContained(adapter, projectDir, {
        build: { outDir: "nested/release" },
      });
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });
});
