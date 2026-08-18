import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { BUILD_FAILED, VeryfrontError } from "#veryfront/errors";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  cachedCodeUsesResolvedDependencies,
  SSRDependencyValidator,
} from "./ssr-dependency-validator.ts";

describe("SSRDependencyValidator", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("rejects a cached parent that imports an outdated dependency output", async () => {
    const resolvedDependencies = {
      localImportPaths: new Map([
        ["./message.ts", "/cache/message.v2.js"],
        ["/project/message.ts", "/cache/message.v2.js"],
      ]),
      crossProjectPaths: new Map<string, string>(),
    };

    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        'import { message } from "file:///cache/message.v1.js";',
        resolvedDependencies,
      ),
      false,
    );
    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        'import { message } from "file:///cache/message.v2.js";',
        resolvedDependencies,
      ),
      true,
    );
  });

  it("preserves terminal HTTP fetch failures from local dependencies", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-ssr-dependency-validator-" });
    const projectDir = join(tempDir, "project");
    const dependencyPath = join(tempDir, "markdown-renderer.tsx");
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

      assertStrictEquals(error, fetchError);
      assertEquals(validator.missingDependencies, []);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("waits for sibling transforms before propagating a terminal HTTP fetch failure", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-ssr-dependency-validator-" });
    const projectDir = join(tempDir, "project");
    const terminalPath = join(tempDir, "terminal.ts");
    const siblingPath = join(tempDir, "sibling.ts");
    const siblingStarted = Promise.withResolvers<void>();
    const releaseSibling = Promise.withResolvers<void>();
    const fetchError = BUILD_FAILED.create({
      detail: "Failed to fetch https://esm.sh/marked: AbortError",
      context: { phase: "http-module-fetch" },
    });
    const validator = new SSRDependencyValidator(
      async (filePath) => {
        if (filePath === terminalPath) {
          await siblingStarted.promise;
          throw fetchError;
        }
        siblingStarted.resolve();
        await releaseSibling.promise;
        throw new Error("Sibling transform failed");
      },
      () => Promise.resolve(""),
      denoAdapter,
      projectDir,
    );

    try {
      await writeTextFile(terminalPath, "export const terminal = true;");
      await writeTextFile(siblingPath, "export const sibling = true;");

      let loadSettled = false;
      const load = validator.processLocalImports(
        [
          { absolutePath: terminalPath, specifier: "./terminal.ts" },
          { absolutePath: siblingPath, specifier: "./sibling.ts" },
        ],
        join(projectDir, "page.tsx"),
        0,
        createFileSystem(),
        createDependencyHashCache(),
      );
      void load.catch(() => {
        loadSettled = true;
      });

      await siblingStarted.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(loadSettled, false);

      releaseSibling.resolve();
      const error = await assertRejects(() => load, VeryfrontError);
      assertStrictEquals(error, fetchError);
    } finally {
      releaseSibling.resolve();
      await remove(tempDir, { recursive: true });
    }
  });

  it("preserves terminal HTTP fetch failures from cross-project imports", async () => {
    const projectDir = "/project";
    const fetchError = BUILD_FAILED.create({
      detail: "Failed to fetch https://esm.sh/marked: AbortError",
      context: { phase: "http-module-fetch" },
    });
    const validator = new SSRDependencyValidator(
      () => Promise.resolve({ tempPath: "/tmp/unused.mjs", contentHash: "unused" }),
      () => Promise.reject(fetchError),
      denoAdapter,
      projectDir,
    );

    const error = await assertRejects(
      () =>
        validator.ensureDependenciesExist(
          `import "acme-ui@1.2.3/@/components/Button.tsx";`,
          "/project/page.tsx",
        ),
      VeryfrontError,
      "Failed to fetch https://esm.sh/marked: AbortError",
    );

    assertStrictEquals(error, fetchError);
    assertEquals(validator.missingDependencies, []);
  });

  it("waits for sibling cross-project transforms before propagating a terminal HTTP fetch failure", async () => {
    const projectDir = "/project";
    const siblingStarted = Promise.withResolvers<void>();
    const releaseSibling = Promise.withResolvers<void>();
    const fetchError = BUILD_FAILED.create({
      detail: "Failed to fetch https://esm.sh/marked: AbortError",
      context: { phase: "http-module-fetch" },
    });
    const validator = new SSRDependencyValidator(
      () => Promise.resolve({ tempPath: "/tmp/unused.mjs", contentHash: "unused" }),
      async (crossProjectImport) => {
        if (crossProjectImport.specifier === "terminal-ui@1.0.0/@/broken.tsx") {
          await siblingStarted.promise;
          throw fetchError;
        }
        siblingStarted.resolve();
        await releaseSibling.promise;
        throw new Error("Sibling transform failed");
      },
      denoAdapter,
      projectDir,
    );

    try {
      let loadSettled = false;
      const load = validator.ensureDependenciesExist(
        `
          import "terminal-ui@1.0.0/@/broken.tsx";
          import "sibling-ui@1.0.0/@/also-broken.tsx";
        `,
        "/project/page.tsx",
      );
      void load.catch(() => {
        loadSettled = true;
      });

      await siblingStarted.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(loadSettled, false);

      releaseSibling.resolve();
      const error = await assertRejects(() => load, VeryfrontError);
      assertStrictEquals(error, fetchError);
      assertEquals(validator.missingDependencies.length, 1);
      assertEquals(
        validator.missingDependencies[0]?.specifier,
        "sibling-ui@1.0.0/@/also-broken.tsx",
      );
    } finally {
      releaseSibling.resolve();
    }
  });
});
