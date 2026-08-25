import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { BUILD_FAILED, VeryfrontError } from "#veryfront/errors";
import { createDependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
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
      "a parent importing the outdated dependency output must not be reused",
    );
    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        'import { message } from "file:///cache/message.v2.js";',
        resolvedDependencies,
      ),
      true,
      "a parent importing the resolved dependency output must be reused",
    );
  });

  it("rejects a cached parent that mixes fresh and stale dependency outputs", async () => {
    const resolvedDependencies = {
      localImportPaths: new Map([
        ["./a.ts", "/cache/a.v2.js"],
        ["./b.ts", "/cache/b.v2.js"],
      ]),
      crossProjectPaths: new Map<string, string>(),
    };

    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        [
          'import a from "file:///cache/a.v2.js";',
          'import b from "file:///cache/b.v1.js";',
        ].join("\n"),
        resolvedDependencies,
      ),
      false,
      "a parent importing one stale child output must not be reused",
    );
    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        [
          'import a from "file:///cache/a.v2.js";',
          'import b from "file:///cache/b.v2.js";',
        ].join("\n"),
        resolvedDependencies,
      ),
      true,
      "a parent importing every resolved child output must be reused",
    );
  });

  it("rejects a cached parent that imports a stale cross-project dependency output", async () => {
    const resolvedDependencies = {
      localImportPaths: new Map([["./a.ts", "/cache/a.v2.js"]]),
      crossProjectPaths: new Map([["@other/pkg", "/cache/cross.v2.js"]]),
    };

    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        [
          'import a from "file:///cache/a.v2.js";',
          'import cross from "file:///cache/cross.v1.js";',
        ].join("\n"),
        resolvedDependencies,
      ),
      false,
      "a parent importing a stale cross-project output must not be reused",
    );
    assertEquals(
      await cachedCodeUsesResolvedDependencies(
        [
          'import a from "file:///cache/a.v2.js";',
          'import cross from "file:///cache/cross.v2.js";',
        ].join("\n"),
        resolvedDependencies,
      ),
      true,
      "a parent importing the resolved cross-project output must be reused",
    );
  });

  it("reads in-project dependencies through the runtime adapter filesystem", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-ssr-dependency-validator-" });
    const projectDir = join(tempDir, "project");
    const dependencyPath = join(projectDir, "child.tsx");
    const adapterReads: string[] = [];
    const transformedSources: Array<string | undefined> = [];
    // denoAdapter is a class instance, so delegate through the prototype chain
    // instead of spreading, which would drop every method it inherits.
    const adapterFs = Object.create(denoAdapter.fs) as typeof denoAdapter.fs;
    adapterFs.readFile = (path: string) => {
      adapterReads.push(path);
      return Promise.resolve('export const child = "from-adapter";');
    };
    // In-project reads bind containment to the read through the adapter's
    // snapshot capability when it has one, so route that through the adapter
    // double as well instead of letting it reach the real disk. The native
    // adapter publishes the capability as a non-writable property, so the
    // override must be defined rather than assigned.
    Object.defineProperty(adapterFs, "readFileSnapshotWithinLimit", {
      value: (path: string) => {
        adapterReads.push(path);
        return Promise.resolve(
          new TextEncoder().encode('export const child = "from-adapter";'),
        );
      },
      configurable: true,
      enumerable: true,
    });
    const adapter = Object.create(denoAdapter, {
      fs: { value: adapterFs },
    }) as typeof denoAdapter;
    const validator = new SSRDependencyValidator(
      (_filePath, source) => {
        transformedSources.push(source);
        return Promise.resolve({ tempPath: "/tmp/child.js", contentHash: "child-hash" });
      },
      () => Promise.resolve(""),
      adapter,
      projectDir,
    );

    try {
      await mkdir(projectDir, { recursive: true });
      await writeTextFile(dependencyPath, 'export const child = "from-disk";');

      const importPaths = await validator.processLocalImports(
        [{ absolutePath: dependencyPath, specifier: "./child.tsx" }],
        join(projectDir, "page.tsx"),
        0,
        createFileSystem(),
        createDependencyHashCache(),
      );

      assertEquals(
        adapterReads,
        [dependencyPath],
        "in-project dependencies must be read through the adapter filesystem",
      );
      assertEquals(
        transformedSources,
        ['export const child = "from-adapter";'],
        "the adapter filesystem content must be transformed, not the on-disk bytes",
      );
      assertEquals(
        importPaths.get("./child.tsx"),
        "/tmp/child.js",
        "the transformed dependency output must be mapped for the specifier",
      );
      assertEquals(
        validator.missingDependencies,
        [],
        "an in-project dependency read through the adapter must not be reported missing",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  // Regression: import containment approves a canonical pathname, but the
  // later read followed whatever the path named by then, so a symlink placed
  // at the approved path after validation escaped the project. The read must
  // be bound to containment: the adapter's no-follow snapshot capability
  // refuses the replaced path instead of following it.
  it("refuses to read an approved project path replaced by a symlink", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-ssr-dependency-validator-toctou-" });
    try {
      const projectDir = join(tempDir, "project");
      const externalDir = join(tempDir, "external");
      await mkdir(projectDir, { recursive: true });
      await mkdir(externalDir, { recursive: true });
      await writeTextFile(join(externalDir, "secret.ts"), `export const leaked = "secret";`);
      const approvedPath = join(projectDir, "child.ts");
      // The path was approved while it named a regular file; by read time an
      // attacker has replaced it with a link to an out-of-project target.
      await Deno.symlink(join(externalDir, "secret.ts"), approvedPath);

      const transformedSources: Array<string | undefined> = [];
      const validator = new SSRDependencyValidator(
        (_filePath, source) => {
          transformedSources.push(source);
          return Promise.resolve({ tempPath: "/tmp/child.js", contentHash: "child-hash" });
        },
        () => Promise.resolve(""),
        denoAdapter,
        projectDir,
      );

      await validator.processLocalImports(
        [{ absolutePath: approvedPath, specifier: "./child.ts" }],
        join(projectDir, "page.ts"),
        0,
        createFileSystem(),
        createDependencyHashCache(),
      );

      assertEquals(transformedSources, [], "the replaced path must not be transformed");
      assertEquals(
        validator.missingDependencies.length,
        1,
        "the bound read must refuse the retargeted symlink",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
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
