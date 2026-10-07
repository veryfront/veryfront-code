import { assertEquals, assertRejects } from "#std/assert";
import { dirname, join } from "#std/path.ts";
import { describe, it } from "#std/testing/bdd";
import { prepareFrameworkSources } from "./prepare-framework-sources.ts";
import { ROOT_BUNDLED_EXTENSION_SOURCES } from "../../src/extensions/root-bundled-sources.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

describe("prepareFrameworkSources", () => {
  it("fails if an explicitly selected distribution lacks required bundled sources", async () => {
    const root = await makeTempDir();
    try {
      const srcRoot = join(root, "src");
      await Deno.mkdir(srcRoot);
      await assertRejects(
        () =>
          prepareFrameworkSources({
            srcRoot,
            outputDir: join(root, "dist"),
            frameworkRoot: root,
          }),
        Deno.errors.NotFound,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("excludes tests and test helpers from binary framework sources", async () => {
    const temporaryRoot = await makeTempDir();
    const sourceRoot = join(temporaryRoot, "src");
    const outputRoot = join(temporaryRoot, "dist");

    try {
      await Deno.mkdir(sourceRoot, { recursive: true });
      for (const entry of Object.values(ROOT_BUNDLED_EXTENSION_SOURCES)) {
        const path = join(temporaryRoot, entry);
        await Deno.mkdir(dirname(path), {
          recursive: true,
        });
        await Deno.writeTextFile(
          path,
          "export default () => ({ name: 'fixture' });\n",
        );
      }
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
        frameworkRoot: temporaryRoot,
      });

      assertEquals(
        result.fileCount,
        1 + Object.keys(ROOT_BUNDLED_EXTENSION_SOURCES).length,
      );
      for (const entry of Object.values(ROOT_BUNDLED_EXTENSION_SOURCES)) {
        assertEquals(
          await Deno.readTextFile(
            join(outputRoot, "root-bundled", entry + ".src"),
          ),
          "export default () => ({ name: 'fixture' });\n",
        );
      }
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
