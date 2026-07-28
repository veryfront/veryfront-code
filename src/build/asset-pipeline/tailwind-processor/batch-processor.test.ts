import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { processTailwindCSSInDirectory } from "./batch-processor.ts";

describe("build/asset-pipeline/tailwind-processor/batch-processor", () => {
  it("fails when the configured source directory does not exist", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await assertRejects(
        () =>
          processTailwindCSSInDirectory(
            projectDir,
            "missing-styles",
            ".veryfront/css",
          ),
        Error,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("publishes an empty output directory when no Tailwind files exist", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/styles`);
      await Deno.writeTextFile(`${projectDir}/styles/global.css`, "body { color: red; }");

      const result = await processTailwindCSSInDirectory(
        projectDir,
        "styles",
        ".veryfront/css",
      );

      assertEquals(result, []);
      const outputEntries = [];
      for await (const entry of Deno.readDir(`${projectDir}/.veryfront/css`)) {
        outputEntries.push(entry.name);
      }
      assertEquals(outputEntries, []);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("compiles detected files and publishes the directory atomically", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/styles`);
      await Deno.mkdir(`${projectDir}/app`);
      await Deno.writeTextFile(
        `${projectDir}/styles/global.css`,
        '@import "tailwindcss";',
      );
      await Deno.writeTextFile(
        `${projectDir}/app/page.tsx`,
        '<main className="p-4">Hello</main>',
      );

      const result = await processTailwindCSSInDirectory(
        projectDir,
        "styles",
        ".veryfront/css",
      );

      assertEquals(result.length, 1);
      const output = await Deno.readTextFile(
        `${projectDir}/.veryfront/css/global.css`,
      );
      assertEquals(output, result[0]!.css);
      assertStringIncludes(output, ".p-4");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
