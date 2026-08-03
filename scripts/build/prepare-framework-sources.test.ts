import { assertEquals } from "#std/assert";
import { join } from "#std/path.ts";
import { describe, it } from "#std/testing/bdd";
import { prepareFrameworkSources } from "./prepare-framework-sources.ts";

describe("prepareFrameworkSources", () => {
  it("excludes tests and test helpers from binary framework sources", async () => {
    const temporaryRoot = await Deno.makeTempDir();
    const sourceRoot = join(temporaryRoot, "src");
    const outputRoot = join(temporaryRoot, "dist");

    try {
      await Deno.mkdir(sourceRoot, { recursive: true });
      await Promise.all([
        Deno.writeTextFile(
          join(sourceRoot, "runtime.ts"),
          "export const runtime = true;\n",
        ),
        Deno.writeTextFile(
          join(sourceRoot, "runtime.test.ts"),
          "throw new Error('test');\n",
        ),
        Deno.writeTextFile(
          join(sourceRoot, "react-root.test-helpers.ts"),
          "throw new Error('test helper');\n",
        ),
      ]);

      const result = await prepareFrameworkSources({
        srcRoot: sourceRoot,
        outputDir: outputRoot,
      });

      assertEquals(result.fileCount, 1);
      assertEquals(
        await Deno.readTextFile(join(outputRoot, "runtime.ts.src")),
        "export const runtime = true;\n",
      );
      assertEquals(
        await exists(join(outputRoot, "runtime.test.ts.src")),
        false,
      );
      assertEquals(
        await exists(join(outputRoot, "react-root.test-helpers.ts.src")),
        false,
      );
    } finally {
      await Deno.remove(temporaryRoot, { recursive: true });
    }
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
