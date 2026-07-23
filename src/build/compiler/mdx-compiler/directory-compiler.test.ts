import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { compileAllMDX } from "./directory-compiler.ts";

describe(
  "build/compiler/mdx-compiler/directory-compiler",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await esbuild.stop();
    });

    it("fails the compilation when any discovered MDX file is invalid", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = `${projectDir}/compiled`;
      try {
        await Deno.mkdir(`${projectDir}/pages`);
        await Deno.writeTextFile(`${projectDir}/pages/valid.mdx`, "# Valid");
        await Deno.writeTextFile(
          `${projectDir}/pages/invalid.mdx`,
          "---\ntitle: [broken\n---\n# Invalid",
        );

        await assertRejects(
          () => compileAllMDX({ projectDir, outputDir, mode: "production" }),
          AggregateError,
          "Failed to compile 1 MDX file",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("compiles sources from configured project-relative directories", async () => {
      const projectDir = await Deno.makeTempDir();
      const outputDir = `${projectDir}/compiled`;
      try {
        await Deno.mkdir(`${projectDir}/content`);
        await Deno.writeTextFile(`${projectDir}/content/page.mdx`, "# Page");

        const results = await compileAllMDX({
          projectDir,
          outputDir,
          mode: "production",
          sourceDirectories: ["content"],
        });

        assertEquals(results.size, 1);
        assertEquals(await Deno.readTextFile(`${outputDir}/content/page.js`).then(Boolean), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  },
);
