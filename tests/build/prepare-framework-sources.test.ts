import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#std/path.ts";
import { prepareFrameworkSources } from "../../scripts/build/prepare-framework-sources.ts";

describe("prepareFrameworkSources", () => {
  it("embeds every runtime source directory without tests or machine metadata", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-framework-sources-" });
    const srcRoot = join(root, "src");
    const outputDir = join(root, "dist", "framework-src");

    try {
      await Deno.mkdir(join(srcRoot, "react"), { recursive: true });
      await Deno.mkdir(join(srcRoot, "errors"), { recursive: true });
      await Deno.mkdir(join(srcRoot, "errors", "__tests__"), { recursive: true });
      await Deno.mkdir(join(srcRoot, "errors", "__fixtures__"), { recursive: true });
      await Deno.writeTextFile(join(srcRoot, "react", "index.ts"), "export const react = 1;\n");
      await Deno.writeTextFile(join(srcRoot, "errors", "index.ts"), "export const error = 1;\n");
      await Deno.writeTextFile(join(srcRoot, "errors", "index.test.ts"), "throw new Error();\n");
      await Deno.writeTextFile(
        join(srcRoot, "errors", "index.test-helpers.ts"),
        "throw new Error();\n",
      );
      await Deno.writeTextFile(
        join(srcRoot, "errors", "__tests__", "setup.ts"),
        "throw new Error();\n",
      );
      await Deno.writeTextFile(
        join(srcRoot, "errors", "__fixtures__", "example.ts"),
        "throw new Error();\n",
      );
      await Deno.writeTextFile(join(srcRoot, "errors", "README.md"), "ignored\n");

      const result = await prepareFrameworkSources({ srcRoot, outputDir });

      assertEquals(result.fileCount, 2);
      assertEquals(
        await Deno.readTextFile(join(outputDir, "react", "index.ts.src")),
        "export const react = 1;\n",
      );
      assertEquals(
        await Deno.readTextFile(join(outputDir, "errors", "index.ts.src")),
        "export const error = 1;\n",
      );
      await assertMissing(join(outputDir, "errors", "index.test.ts.src"));
      await assertMissing(join(outputDir, "errors", "index.test-helpers.ts.src"));
      await assertMissing(join(outputDir, "errors", "__tests__", "setup.ts.src"));
      await assertMissing(join(outputDir, "errors", "__fixtures__", "example.ts.src"));
      await assertMissing(join(outputDir, ".compile-metadata.json"));
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

async function assertMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
    throw new Error(`Expected ${path} to be absent`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
