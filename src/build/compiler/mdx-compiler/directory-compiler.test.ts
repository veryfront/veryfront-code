import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { compileAllMDX } from "./directory-compiler.ts";

function hasCompilerArtifact(parentDir: string, outputName: string): boolean {
  return [...Deno.readDirSync(parentDir)].some((entry) =>
    entry.name.includes(`.${outputName}.veryfront-stage-`) ||
    entry.name.includes(`.${outputName}.veryfront-backup-`) ||
    entry.name === `.${outputName}.veryfront-build.lock`
  );
}

describe("build/compiler/mdx-compiler/directory-compiler", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("publishes all compiled files together and removes stale output", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/.veryfront/compiled`;
    await Deno.mkdir(`${projectDir}/pages/blog`, { recursive: true });
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Home");
    await Deno.writeTextFile(`${projectDir}/pages/blog/post.mdx`, "# Post");
    await Deno.writeTextFile(`${outputDir}/stale.js`, "stale");

    try {
      const results = await compileAllMDX({
        projectDir,
        outputDir,
        mode: "production",
      });

      assertEquals(results.size, 2);
      assertEquals(await Deno.readTextFile(`${outputDir}/pages/index.js`) !== "", true);
      assertEquals(await Deno.readTextFile(`${outputDir}/pages/blog/post.js`) !== "", true);
      await assertRejects(
        () => Deno.stat(`${outputDir}/stale.js`),
        Deno.errors.NotFound,
      );
      for (const result of results.values()) {
        assertEquals(result.outputPath.startsWith(outputDir), true);
        assertEquals(result.outputPath.includes("veryfront-stage"), false);
      }
      assertEquals(hasCompilerArtifact(`${projectDir}/.veryfront`, "compiled"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves the previous output when any source fails", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/.veryfront/compiled`;
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/good.mdx`, "# Good");
    await Deno.writeTextFile(
      `${projectDir}/pages/broken.mdx`,
      "---\ntitle: [unterminated\n---\n# Broken",
    );
    await Deno.writeTextFile(`${outputDir}/previous.js`, "previous");

    try {
      const error = await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir,
            mode: "production",
          }),
        AggregateError,
        "Failed to compile 1 MDX file",
      );

      assertEquals((error as AggregateError).errors.length, 1);
      assertEquals(await Deno.readTextFile(`${outputDir}/previous.js`), "previous");
      await assertRejects(
        () => Deno.stat(`${outputDir}/pages/good.js`),
        Deno.errors.NotFound,
      );
      assertEquals(hasCompilerArtifact(`${projectDir}/.veryfront`, "compiled"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a configured source location that is not a directory", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/compiled`;
    await Deno.writeTextFile(`${projectDir}/pages`, "not a directory");

    try {
      await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir,
            mode: "development",
          }),
        TypeError,
        "not a directory",
      );
      await assertRejects(() => Deno.stat(outputDir), Deno.errors.NotFound);
      assertEquals(hasCompilerArtifact(projectDir, "compiled"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
