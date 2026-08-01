import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { compileAllMDX } from "./directory-compiler.ts";

function hasCompilerArtifact(parentDir: string, outputName: string): boolean {
  return [...Deno.readDirSync(parentDir)].some((entry) =>
    entry.name.includes(`.${outputName}.veryfront-stage-`) ||
    entry.name.includes(`.${outputName}.veryfront-backup-`) ||
    entry.name === `.${outputName}.veryfront-build.lock`
  );
}

function createMutationTrackingFileSystem(): {
  readonly fs: FileSystem;
  readonly mutationCalls: string[];
} {
  const delegate = createFileSystem();
  const mutationCalls: string[] = [];
  const mutators = new Set<PropertyKey>([
    "writeTextFile",
    "writeFile",
    "createFileBytesExclusive",
    "rename",
    "mkdir",
    "remove",
    "makeTempDir",
    "chmod",
  ]);
  const fs = new Proxy(delegate, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (!mutators.has(property)) return value.bind(target);
      return (...args: unknown[]) => {
        mutationCalls.push(String(property));
        return Reflect.apply(value, target, args);
      };
    },
  }) as FileSystem;
  return { fs, mutationCalls };
}

describe("build/compiler/mdx-compiler/directory-compiler", () => {
  afterAll(async () => {
    await esbuild.stop();
  });

  it("rejects replacing the project before publication can mutate source files", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-mdx-output-boundary-" });
    const projectDir = `${root}/project`;
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Home");
    await Deno.writeTextFile(`${projectDir}/sentinel.txt`, "source-owned");
    const { fs, mutationCalls } = createMutationTrackingFileSystem();

    try {
      await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir: projectDir,
            mode: "production",
          }, { fs }),
        Error,
        "must not contain or replace the project",
      );
      assertEquals(
        await Deno.readTextFile(`${projectDir}/sentinel.txt`),
        "source-owned",
      );
      assertEquals(hasCompilerArtifact(root, "project"), false);
      assertEquals(mutationCalls, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("treats names beginning with two dots as ordinary path segments", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-mdx-dot-segment-" });
    const outputDir = `${root}/output`;
    const projectDir = `${outputDir}/..project`;
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Home");
    const { fs, mutationCalls } = createMutationTrackingFileSystem();

    try {
      await assertRejects(
        () => compileAllMDX({ projectDir, outputDir, mode: "production" }, { fs }),
        Error,
        "must not contain or replace the project",
      );
      assertEquals(await Deno.readTextFile(`${projectDir}/pages/index.mdx`), "# Home");

      await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir: `${projectDir}/pages/..compiled`,
            mode: "production",
          }, { fs }),
        Error,
        "must not overlap a source directory",
      );
      assertEquals(await Deno.readTextFile(`${projectDir}/pages/index.mdx`), "# Home");
      assertEquals(mutationCalls, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const sourceDirectory of ["pages", "layouts", "providers"] as const) {
    it(`rejects output inside the ${sourceDirectory} source directory`, async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-mdx-source-boundary-" });
      const projectDir = `${root}/project`;
      const sourceDir = `${projectDir}/${sourceDirectory}`;
      const outputDir = `${sourceDir}/compiled`;
      await Deno.mkdir(sourceDir, { recursive: true });
      await Deno.writeTextFile(`${sourceDir}/sentinel.mdx`, "# Source");
      const { fs, mutationCalls } = createMutationTrackingFileSystem();

      try {
        await assertRejects(
          () =>
            compileAllMDX({
              projectDir,
              outputDir,
              mode: "production",
            }, { fs }),
          Error,
          "must not overlap a source directory",
        );
        assertEquals(await Deno.readTextFile(`${sourceDir}/sentinel.mdx`), "# Source");
        await assertRejects(() => Deno.stat(outputDir), Deno.errors.NotFound);
        assertEquals(mutationCalls, []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it(`rejects a case-only ${sourceDirectory} output alias`, async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-mdx-case-boundary-" });
      const projectDir = `${root}/project`;
      const caseAlias = sourceDirectory[0]!.toUpperCase() + sourceDirectory.slice(1);
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/sentinel.txt`, "source-owned");
      const { fs, mutationCalls } = createMutationTrackingFileSystem();

      try {
        await assertRejects(
          () =>
            compileAllMDX({
              projectDir,
              outputDir: `${projectDir}/${caseAlias}/compiled`,
              mode: "production",
            }, { fs }),
          Error,
          "must not overlap a source directory",
        );
        assertEquals(await Deno.readTextFile(`${projectDir}/sentinel.txt`), "source-owned");
        assertEquals(mutationCalls, []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it(`rejects an output path that physically aliases ${sourceDirectory}`, async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-mdx-physical-boundary-" });
      const projectDir = `${root}/project`;
      const sourceDir = `${projectDir}/${sourceDirectory}`;
      const aliasDir = `${root}/${sourceDirectory}-alias`;
      await Deno.mkdir(sourceDir, { recursive: true });
      await Deno.writeTextFile(`${sourceDir}/sentinel.mdx`, "# Source");
      await Deno.symlink(sourceDir, aliasDir);
      const { fs, mutationCalls } = createMutationTrackingFileSystem();

      try {
        await assertRejects(
          () =>
            compileAllMDX({
              projectDir,
              outputDir: `${aliasDir}/compiled`,
              mode: "production",
            }, { fs }),
          Error,
          "must not overlap a source directory",
        );
        assertEquals(await Deno.readTextFile(`${sourceDir}/sentinel.mdx`), "# Source");
        await assertRejects(
          () => Deno.stat(`${sourceDir}/compiled`),
          Deno.errors.NotFound,
        );
        assertEquals(mutationCalls, []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it(`rejects a dangling ${sourceDirectory} source symlink before publication`, async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-mdx-dangling-source-" });
      const projectDir = `${root}/project`;
      const missingTarget = `${root}/${sourceDirectory}-target`;
      const sourceDir = `${projectDir}/${sourceDirectory}`;
      const outputDir = `${missingTarget}/compiled`;
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/sentinel.txt`, "source-owned");
      await Deno.symlink(missingTarget, sourceDir);
      const { fs, mutationCalls } = createMutationTrackingFileSystem();

      try {
        await assertRejects(
          () =>
            compileAllMDX({
              projectDir,
              outputDir,
              mode: "production",
            }, { fs }),
          Error,
          "must not contain dangling symbolic links",
        );
        assertEquals(await Deno.readTextFile(`${projectDir}/sentinel.txt`), "source-owned");
        assertEquals((await Deno.lstat(sourceDir)).isSymlink, true);
        await assertRejects(() => Deno.stat(missingTarget), Deno.errors.NotFound);
        assertEquals(mutationCalls, []);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }

  it("propagates filesystem-loop failures before publication mutates output", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-mdx-output-loop-" });
    const projectDir = `${root}/project`;
    const loopA = `${root}/loop-a`;
    const loopB = `${root}/loop-b`;
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Home");
    await Deno.symlink(loopB, loopA);
    await Deno.symlink(loopA, loopB);
    const { fs, mutationCalls } = createMutationTrackingFileSystem();

    try {
      await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir: `${loopA}/compiled`,
            mode: "production",
          }, { fs }),
        Deno.errors.FilesystemLoop,
      );
      assertEquals(await Deno.readTextFile(`${projectDir}/pages/index.mdx`), "# Home");
      assertEquals(mutationCalls, []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("propagates a noncanonical ENOENT-shaped source failure before publication", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-mdx-output-shaped-enoent-" });
    const projectDir = `${root}/project`;
    const sourceDir = `${projectDir}/pages`;
    const outputDir = `${projectDir}/.veryfront/compiled`;
    const shapedFailure = { code: "ENOENT", detail: "not a native filesystem error" };
    const lstatDescriptor = Object.getOwnPropertyDescriptor(Deno, "lstat")!;
    const originalLstat = Deno.lstat.bind(Deno);
    await Deno.mkdir(sourceDir, { recursive: true });
    await Deno.writeTextFile(`${sourceDir}/index.mdx`, "# Home");
    const canonicalSourceDir = await Deno.realPath(sourceDir);
    const { fs, mutationCalls } = createMutationTrackingFileSystem();

    Object.defineProperty(Deno, "lstat", {
      ...lstatDescriptor,
      value: (path: string | URL) =>
        String(path) === canonicalSourceDir ? Promise.reject(shapedFailure) : originalLstat(path),
    });

    try {
      const rejection = await compileAllMDX({
        projectDir,
        outputDir,
        mode: "production",
      }, { fs }).then(
        () => undefined,
        (error) => error,
      );

      assertStrictEquals(rejection, shapedFailure);
      assertEquals(await Deno.readTextFile(`${sourceDir}/index.mdx`), "# Home");
      await assertRejects(() => Deno.stat(outputDir), Deno.errors.NotFound);
      assertEquals(mutationCalls, []);
    } finally {
      Object.defineProperty(Deno, "lstat", lstatDescriptor);
      await Deno.remove(root, { recursive: true });
    }
  });

  it("publishes all compiled files together and removes stale output", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/.veryfront/compiled`;
    await Deno.mkdir(`${projectDir}/pages/blog`, { recursive: true });
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/index.mdx`, "# Home");
    await Deno.writeTextFile(`${projectDir}/pages/blog/post.mdx`, "# Post");
    await Deno.writeTextFile(`${outputDir}/stale.js`, "stale");

    try {
      const results = await compileAllMDX({
        projectDir,
        outputDir,
        mode: "production",
      });

      assertEquals(results.size, 2);
      assertEquals(await Deno.readTextFile(`${outputDir}/pages/index.js`) !== "", true);
      assertEquals(await Deno.readTextFile(`${outputDir}/pages/blog/post.js`) !== "", true);
      await assertRejects(
        () => Deno.stat(`${outputDir}/stale.js`),
        Deno.errors.NotFound,
      );
      for (const result of results.values()) {
        assertEquals(result.outputPath.startsWith(outputDir), true);
        assertEquals(result.outputPath.includes("veryfront-stage"), false);
      }
      assertEquals(hasCompilerArtifact(`${projectDir}/.veryfront`, "compiled"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves the previous output when any source fails", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/.veryfront/compiled`;
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/good.mdx`, "# Good");
    await Deno.writeTextFile(
      `${projectDir}/pages/broken.mdx`,
      "---\ntitle: [unterminated\n---\n# Broken",
    );
    await Deno.writeTextFile(`${outputDir}/previous.js`, "previous");

    try {
      const error = await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir,
            mode: "production",
          }),
        AggregateError,
        "Failed to compile 1 MDX file",
      );

      assertEquals((error as AggregateError).errors.length, 1);
      assertEquals(await Deno.readTextFile(`${outputDir}/previous.js`), "previous");
      await assertRejects(
        () => Deno.stat(`${outputDir}/pages/good.js`),
        Deno.errors.NotFound,
      );
      assertEquals(hasCompilerArtifact(`${projectDir}/.veryfront`, "compiled"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not resurrect a deleted owned stage while creating nested output", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/.veryfront/compiled`;
    await Deno.mkdir(`${projectDir}/pages/blog`, { recursive: true });
    await Deno.mkdir(outputDir, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/pages/blog/post.mdx`, "# Post");
    await Deno.writeTextFile(`${outputDir}/sentinel.txt`, "known good");

    const delegate = createFileSystem();
    let stagePath: string | undefined;
    let removedStage = false;
    const fs = new Proxy(delegate, {
      get(target, property) {
        if (property === "mkdir") {
          return async (path: string, options?: { recursive?: boolean }): Promise<void> => {
            if (stagePath === undefined && path.includes(".compiled.veryfront-stage-")) {
              stagePath = path;
            } else if (
              !removedStage && stagePath !== undefined &&
              path.startsWith(`${stagePath}/`)
            ) {
              removedStage = true;
              await target.remove(stagePath, { recursive: true });
            }
            await target.mkdir(path, options);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as FileSystem;
    try {
      await assertRejects(() =>
        compileAllMDX({
          projectDir,
          outputDir,
          mode: "production",
        }, { fs })
      );
      assertEquals(removedStage, true);
      await assertRejects(() => Deno.stat(stagePath!), Deno.errors.NotFound);
      assertEquals(await Deno.readTextFile(`${outputDir}/sentinel.txt`), "known good");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a configured source location that is not a directory", async () => {
    const projectDir = await Deno.makeTempDir();
    const outputDir = `${projectDir}/compiled`;
    await Deno.writeTextFile(`${projectDir}/pages`, "not a directory");

    try {
      await assertRejects(
        () =>
          compileAllMDX({
            projectDir,
            outputDir,
            mode: "development",
          }),
        TypeError,
        "not a directory",
      );
      await assertRejects(() => Deno.stat(outputDir), Deno.errors.NotFound);
      assertEquals(hasCompilerArtifact(projectDir, "compiled"), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
