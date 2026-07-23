import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import { SSRDependencyValidator } from "./ssr-dependency-validator.ts";
import { CACHE_ERROR, IMPORT_RESOLUTION_ERROR } from "#veryfront/errors";

describe(
  "modules/react-loader/ssr-module-loader/ssr-dependency-validator",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it("does not read project-relative dependencies outside the project root", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-ssr-dependency-boundary-" });
      const projectDir = join(root, "project");
      const outsidePath = join(root, "outside.ts");
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(outsidePath, "export const secret = 'outside';");
      let transformedSource: string | undefined;

      try {
        const validator = new SSRDependencyValidator(
          (filePath) => filePath,
          (_filePath, source) => {
            transformedSource = source;
            return Promise.resolve();
          },
          () => Promise.resolve("/tmp/cross-project.mjs"),
          denoAdapter,
          projectDir,
        );

        await validator.processLocalImports(
          [{ specifier: "../outside.ts", absolutePath: outsidePath }],
          join(projectDir, "page.ts"),
          0,
          createFileSystem(),
          createDependencyHashCache(),
        );

        assertEquals(transformedSource, undefined);
        assertEquals(validator.missingDependencies.length, 1);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("propagates dependency transform failures", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-ssr-dependency-transform-" });
      const dependencyPath = join(projectDir, "dependency.ts");
      await Deno.writeTextFile(dependencyPath, "export const value = 1;");

      try {
        const validator = new SSRDependencyValidator(
          (filePath) => filePath,
          () => {
            throw IMPORT_RESOLUTION_ERROR.create({ detail: "Dependency transform failed" });
          },
          () => Promise.resolve("/tmp/cross-project.mjs"),
          denoAdapter,
          projectDir,
        );

        await assertRejects(
          () =>
            validator.processLocalImports(
              [{ specifier: "./dependency.ts", absolutePath: dependencyPath }],
              join(projectDir, "page.ts"),
              0,
              createFileSystem(),
              createDependencyHashCache(),
            ),
          Error,
          "Dependency transform failed",
        );
        assertEquals(validator.missingDependencies.length, 0);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("propagates cross-project infrastructure failures", async () => {
      const validator = new SSRDependencyValidator(
        (filePath) => filePath,
        () => Promise.resolve(),
        () => {
          throw CACHE_ERROR.create({ detail: "Cross-project cache failed" });
        },
        denoAdapter,
        "/project",
      );

      await assertRejects(
        () =>
          validator.ensureDependenciesExist(
            'import "acme-ui@1.2.3/@/components/Button.tsx";',
            "/project/page.ts",
          ),
        Error,
        "Cross-project cache failed",
      );
      assertEquals(validator.missingDependencies.length, 0);
    });
  },
);
