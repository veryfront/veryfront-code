import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, mkdir, realPath, remove, symlink } from "#veryfront/platform/compat/fs.ts";
import {
  assertIndependentAssetStageOutputs,
  canonicalizePlannedAssetPath,
} from "./output-planning.ts";

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await makeTempDir();
  try {
    await run(directory);
  } finally {
    await remove(directory, { recursive: true });
  }
}

describe("build/asset-pipeline output planning", () => {
  it("canonicalizes outputs through their nearest existing ancestor", async () => {
    await withDirectory(async (projectDir) => {
      const target = join(projectDir, "missing", "nested", "assets");
      assertEquals(
        await canonicalizePlannedAssetPath(target),
        join(await realPath(projectDir), "missing", "nested", "assets"),
      );
    });
  });

  it("accepts independent physical output trees", async () => {
    await withDirectory(async (projectDir) => {
      await assertIndependentAssetStageOutputs([
        { stage: "images", projectDir, outputDir: ".veryfront/images" },
        { stage: "css", projectDir, outputDir: ".veryfront/css" },
      ]);
    });
  });

  it("rejects lexical ancestor and descendant outputs", async () => {
    await withDirectory(async (projectDir) => {
      await assertRejects(
        () =>
          assertIndependentAssetStageOutputs([
            { stage: "images", projectDir, outputDir: ".veryfront/assets" },
            { stage: "css", projectDir, outputDir: ".veryfront/assets/css" },
          ]),
        TypeError,
        "must not overlap physically",
      );
    });
  });

  it("rejects outputs that differ only by case or Unicode normalization", async () => {
    await withDirectory(async (projectDir) => {
      await assertRejects(
        () =>
          assertIndependentAssetStageOutputs([
            { stage: "images", projectDir, outputDir: ".veryfront/Assets" },
            { stage: "css", projectDir, outputDir: ".veryfront/assets/css" },
          ]),
        TypeError,
        "must not overlap physically",
      );

      await assertRejects(
        () =>
          assertIndependentAssetStageOutputs([
            { stage: "images", projectDir, outputDir: ".veryfront/caf\u00e9" },
            { stage: "css", projectDir, outputDir: ".veryfront/cafe\u0301/css" },
          ]),
        TypeError,
        "must not overlap physically",
      );
    });
  });

  it("rejects distinct configured paths that alias the same physical tree", async () => {
    await withDirectory(async (projectDir) => {
      const physicalOutput = join(projectDir, "generated");
      await mkdir(physicalOutput);
      await symlink(physicalOutput, join(projectDir, "output-alias"));

      await assertRejects(
        () =>
          assertIndependentAssetStageOutputs([
            { stage: "images", projectDir, outputDir: "generated" },
            { stage: "css", projectDir, outputDir: "output-alias/css" },
          ]),
        TypeError,
        "must not overlap physically",
      );
    });
  });

  it("rejects an output that escapes through a symlinked ancestor", async () => {
    await withDirectory(async (rootDir) => {
      const projectDir = join(rootDir, "project");
      const outsideDir = join(rootDir, "outside");
      await Promise.all([mkdir(projectDir), mkdir(outsideDir)]);
      await symlink(outsideDir, join(projectDir, "escape"));

      await assertRejects(
        () =>
          assertIndependentAssetStageOutputs([
            { stage: "images", projectDir, outputDir: "escape/images" },
          ]),
        TypeError,
        "must remain inside its physical project",
      );
    });
  });

  it("rejects relative project boundaries and project-root outputs", async () => {
    await assertRejects(
      () =>
        assertIndependentAssetStageOutputs([
          { stage: "images", projectDir: ".", outputDir: "images" },
        ]),
      TypeError,
      "must be absolute",
    );

    await withDirectory(async (projectDir) => {
      await assertRejects(
        () =>
          assertIndependentAssetStageOutputs([
            { stage: "images", projectDir, outputDir: projectDir },
          ]),
        TypeError,
        "must be inside its project",
      );
    });
  });
});
