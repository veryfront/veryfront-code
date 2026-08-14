import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { BUILD_FAILED, VeryfrontError } from "#veryfront/errors";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { SSRDependencyValidator } from "./ssr-dependency-validator.ts";

describe("SSRDependencyValidator", () => {
  it("preserves terminal HTTP fetch failures from local dependencies", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-ssr-dependency-validator-" });
    const dependencyPath = join(projectDir, "markdown-renderer.tsx");
    const fetchError = BUILD_FAILED.create({
      detail: "Failed to fetch https://esm.sh/marked: AbortError",
      context: { phase: "http-module-fetch" },
    });
    const validator = new SSRDependencyValidator(
      () => Promise.reject(fetchError),
      () => Promise.resolve(""),
      denoAdapter,
      projectDir,
    );

    try {
      await writeTextFile(dependencyPath, "export const marked = true;");

      const error = await assertRejects(
        () =>
          validator.processLocalImports(
            [{ absolutePath: dependencyPath, specifier: "./markdown-renderer.tsx" }],
            join(projectDir, "page.tsx"),
            0,
            createFileSystem(),
            createDependencyHashCache(),
          ),
        VeryfrontError,
        "Failed to fetch https://esm.sh/marked: AbortError",
      );

      assertEquals(error, fetchError);
      assertEquals(validator.missingDependencies, []);
    } finally {
      await remove(projectDir, { recursive: true });
    }
  });
});
