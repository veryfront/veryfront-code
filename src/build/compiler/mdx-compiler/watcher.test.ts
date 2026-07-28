import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { processMDXWatchEvent, watchMDX } from "./watcher.ts";

describe("build/compiler/mdx-compiler/watcher", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("removes stale compiled output when changed MDX becomes invalid", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/compiled`;
    const sourcePath = `${projectDir}/pages/index.mdx`;
    const outputPath = `${outputDir}/pages/index.js`;
    await Deno.mkdir(`${projectDir}/pages`);
    await Deno.writeTextFile(sourcePath, "# Valid");

    try {
      const options = {
        projectDir,
        outputDir,
        mode: "development" as const,
      };
      await processMDXWatchEvent(
        { kind: "create", paths: [sourcePath] },
        options,
      );
      assertEquals((await Deno.stat(outputPath)).isFile, true);

      await Deno.writeTextFile(
        sourcePath,
        "---\ntitle: [unterminated\n---\n# Broken",
      );
      await processMDXWatchEvent(
        { kind: "modify", paths: [sourcePath] },
        options,
      );
      await assertRejects(() => Deno.stat(outputPath), Deno.errors.NotFound);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("removes compiled output after its source is deleted", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/compiled`;
    const sourcePath = `${projectDir}/pages/index.mdx`;
    const outputPath = `${outputDir}/pages/index.js`;
    await Deno.mkdir(`${projectDir}/pages`);
    await Deno.writeTextFile(sourcePath, "# Valid");

    try {
      const options = {
        projectDir,
        outputDir,
        mode: "development" as const,
      };
      await processMDXWatchEvent(
        { kind: "create", paths: [sourcePath] },
        options,
      );
      await Deno.remove(sourcePath);
      await processMDXWatchEvent(
        { kind: "delete", paths: [sourcePath] },
        options,
      );

      await assertRejects(() => Deno.stat(outputPath), Deno.errors.NotFound);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("honors an already-aborted watch signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop watching"));

    await assertRejects(() =>
      watchMDX({
        projectDir: "/tmp",
        outputDir: "/tmp/compiled",
        mode: "development",
        signal: controller.signal,
      })
    );
  });
});
