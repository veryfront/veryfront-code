// Relocated from src/build/production-build/build/code-splitter-orchestrator.test.ts.
//
// This case cannot be a colocated unit test: runCodeSplitting imports
// createCodeSplitter directly from #veryfront/build/bundler/index.ts, takes no
// splitter or factory parameter, and is not resolved through the contracts
// registry. There is no injectable seam, and splitter.split() drives real
// esbuild over on-disk entrypoints, so the temp project tree and the chunk
// output tree are unavoidable host effects. Every hermetic assertion (the
// disabled/dryRun/empty-routes early returns) stays in the unit file.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { makeTempDir, mkdir, remove, stat, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { stop } from "veryfront/extensions/bundler";
import { runCodeSplitting } from "#veryfront/build/production-build/build/code-splitter-orchestrator.ts";

describe("build/production-build/build/code-splitter-orchestrator", () => {
  describe("runCodeSplitting", () => {
    it("splits routes into the chunk output tree", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-split-orchestrator-project-" });
      const outputDir = await makeTempDir({ prefix: "vf-split-orchestrator-out-" });

      try {
        await mkdir(join(projectDir, "app/blog"), { recursive: true });
        await writeTextFile(
          join(projectDir, "app/shared.ts"),
          "export const shared = 'shared module payload';\n",
        );
        const postFile = join(projectDir, "app/blog/post.tsx");
        await writeTextFile(
          postFile,
          [
            `import { shared } from "../shared.ts";`,
            `export default function Post() { return shared + " post"; }`,
          ].join("\n"),
        );
        const aboutFile = join(projectDir, "app/about.tsx");
        await writeTextFile(
          aboutFile,
          [
            `import { shared } from "./shared.ts";`,
            `export default function About() { return shared + " about"; }`,
          ].join("\n"),
        );

        const result = await runCodeSplitting(
          projectDir,
          outputDir,
          [
            { path: "/blog/post", file: postFile, slug: "blog/post" },
            { path: "/about", file: aboutFile, slug: "about" },
          ],
          true,
          false,
        );

        assertEquals(result.manifest !== null, true, "the splitter manifest is returned");
        const entryStat = await stat(join(outputDir, "_veryfront/chunks/blog-post.js"));
        assertEquals(
          entryStat.isFile,
          true,
          "nested slugs are flattened with dashes under _veryfront/chunks",
        );
        const siblingStat = await stat(join(outputDir, "_veryfront/chunks/about.js"));
        assertEquals(
          siblingStat.isFile,
          true,
          "every requested route is compiled under the chunk output tree",
        );
        assertEquals(result.chunks, 3, "chunk count is entries plus shared chunks");
      } finally {
        await stop();
        await remove(projectDir, { recursive: true });
        await remove(outputDir, { recursive: true });
      }
    });
  });
});
