import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  type CreateProjectDependencies,
  type CreateProjectRequest,
} from "#cli/shared/project-creation";
import { VeryfrontError } from "veryfront/errors";
import { createFileSystem, type FileSystem } from "veryfront/platform";
import { dirname, join } from "veryfront/platform/path";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

function baseRequest(
  parentDir: string,
  overrides: Partial<CreateProjectRequest> = {},
): CreateProjectRequest {
  return {
    name: "contract-project",
    parentDir,
    template: "minimal",
    runtime: "node",
    integrations: [],
    environmentValues: {},
    conflictPolicy: "fail",
    installDependencies: false,
    initializeGit: false,
    includePackageMetadata: true,
    ...overrides,
  };
}

function projectTest(
  name: string,
  action: (parentDir: string, context: TestContext) => Promise<void>,
): void {
  it(name, async () => {
    await withTestContext(name, async (context) => {
      const parentDir = join(context.projectDir, "parent");
      await Deno.mkdir(parentDir);
      await action(parentDir, context);
    });
  });
}

function overrideFileSystem(
  base: FileSystem,
  overrides: Partial<FileSystem>,
): FileSystem {
  return new Proxy(base, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("createProject filesystem conflicts", () => {
  projectTest("refuses a linked .gitignore before merging it", async (parentDir) => {
    const projectDir = join(parentDir, "contract-project");
    const outside = join(parentDir, "outside-gitignore");
    await Deno.mkdir(projectDir);
    await Deno.writeTextFile(outside, "keep-me\n");
    await Deno.symlink(outside, join(projectDir, ".gitignore"));

    await assertRejects(
      () => createProject(baseRequest(parentDir)),
      Error,
      'Directory "contract-project" already contains .gitignore as a file or a link',
    );

    assertEquals(await Deno.readTextFile(outside), "keep-me\n");
    assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
  });

  projectTest("refuses a .gitignore directory before writing scaffold files", async (parentDir) => {
    const projectDir = join(parentDir, "contract-project");
    await Deno.mkdir(join(projectDir, ".gitignore"), { recursive: true });

    await assertRejects(
      () => createProject(baseRequest(parentDir)),
      Error,
      'Directory "contract-project" already contains .gitignore as a file or a link',
    );

    assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
  });

  if (Deno.build.os !== "windows") {
    projectTest(
      "refuses a non-file .gitignore before writing scaffold files",
      async (parentDir) => {
        const projectDir = join(parentDir, "contract-project");
        await Deno.mkdir(projectDir, { recursive: true });
        const output = await new Deno.Command("mkfifo", {
          args: [join(projectDir, ".gitignore")],
        }).output();
        assertEquals(output.success, true, new TextDecoder().decode(output.stderr));

        await assertRejects(
          () => createProject(baseRequest(parentDir)),
          Error,
          'Directory "contract-project" already contains .gitignore as a file or a link',
        );

        assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
      },
    );

    projectTest(
      "replaces a hard-linked .gitignore without modifying the other link",
      async (parentDir) => {
        const projectDir = join(parentDir, "contract-project");
        const outside = join(parentDir, "outside-gitignore");
        await Deno.mkdir(projectDir);
        await Deno.writeTextFile(outside, "keep-me\n");
        await Deno.link(outside, join(projectDir, ".gitignore"));

        await createProject(baseRequest(parentDir));

        assertEquals(await Deno.readTextFile(outside), "keep-me\n");
        assertStringIncludes(await Deno.readTextFile(join(projectDir, ".gitignore")), "keep-me");
        assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), true);
      },
    );

    projectTest("refuses an unreplacable .gitignore before writing scaffold files", async (
      parentDir,
    ) => {
      const projectDir = join(parentDir, "contract-project");
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(join(projectDir, ".gitignore"), "keep-me\n");
      await Deno.chmod(projectDir, 0o500);

      try {
        await assertRejects(() => createProject(baseRequest(parentDir)), Error);
        assertEquals(await Deno.readTextFile(join(projectDir, ".gitignore")), "keep-me\n");
        assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
      } finally {
        await Deno.chmod(projectDir, 0o700);
      }
    });

    projectTest("refuses an unreadable .gitignore before writing scaffold files", async (
      parentDir,
    ) => {
      const projectDir = join(parentDir, "contract-project");
      const gitignorePath = join(projectDir, ".gitignore");
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(gitignorePath, "keep-me\n");
      const before = await Deno.lstat(gitignorePath);
      await Deno.chmod(gitignorePath, 0o000);

      try {
        await assertRejects(() => createProject(baseRequest(parentDir)), Error);
        const after = await Deno.lstat(gitignorePath);
        assertEquals(after.ino, before.ino);
        await Deno.chmod(gitignorePath, 0o600);
        assertEquals(await Deno.readTextFile(gitignorePath), "keep-me\n");
        assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
      } finally {
        await Deno.chmod(gitignorePath, 0o600);
      }
    });
  }

  projectTest("refuses installer files before dependency installation can replace them", async (
    parentDir,
  ) => {
    const cases = [
      { path: "package-lock.json", message: "package-lock.json" },
      {
        path: "node_modules/.package-lock.json",
        message: "node_modules/.package-lock.json, node_modules",
      },
      { path: "npm-shrinkwrap.json", message: "npm-shrinkwrap.json" },
    ];

    for (const [index, testCase] of cases.entries()) {
      const name = `contract-project-${index}`;
      const projectDir = join(parentDir, name);
      const lockfile = join(projectDir, testCase.path);
      await Deno.mkdir(dirname(lockfile), { recursive: true });
      await Deno.writeTextFile(lockfile, "keep-me\n");

      await assertRejects(
        () =>
          createProject(baseRequest(parentDir, {
            name,
            installDependencies: true,
          })),
        Error,
        `Directory "${name}" already contains ${testCase.message}. Use --force to overwrite.`,
      );

      assertEquals(await Deno.readTextFile(lockfile), "keep-me\n");
      assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
    }
  });

  projectTest(
    "refuses existing node_modules before an installer can prune it",
    async (parentDir) => {
      for (const [index, runtime] of (["node", "bun"] as const).entries()) {
        const name = `contract-project-${runtime}-${index}`;
        const projectDir = join(parentDir, name);
        const userFile = join(projectDir, "node_modules", "user-owned", "data.txt");
        await Deno.mkdir(dirname(userFile), { recursive: true });
        await Deno.writeTextFile(userFile, "keep-me\n");

        await assertRejects(
          () =>
            createProject(baseRequest(parentDir, {
              name,
              runtime,
              installDependencies: true,
            })),
          Error,
          `Directory "${name}" already contains node_modules. Use --force to overwrite.`,
        );

        assertEquals(await Deno.readTextFile(userFile), "keep-me\n");
        assertEquals(await createFileSystem().exists(join(projectDir, "README.md")), false);
      }
    },
  );

  projectTest("refuses a linked project root instead of scaffolding through it", async (
    parentDir,
    context,
  ) => {
    const outside = join(context.projectDir, "outside");
    await Deno.mkdir(outside);
    await Deno.symlink(outside, join(parentDir, "contract-project"));

    await assertRejects(
      () => createProject(baseRequest(parentDir, { conflictPolicy: "overwrite" })),
      Error,
      'Directory "contract-project" is a link the scaffold cannot write through',
    );

    assertEquals(await createFileSystem().exists(join(outside, "README.md")), false);
    assertEquals(await createFileSystem().exists(join(outside, "package.json")), false);
  });
});

describe("createProject error classification", () => {
  projectTest("rejects a bad project name as a usage error", async (parentDir) => {
    const error = await assertRejects(() =>
      createProject(baseRequest(parentDir, { name: "nested/name" }))
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
    assertEquals(error.exitCode, 2);
  });

  projectTest("rejects files it would overwrite as already-exists", async (parentDir) => {
    await Deno.writeTextFile(join(parentDir, "README.md"), "mine\n");

    const error = await assertRejects(() =>
      createProject(baseRequest(parentDir, { name: undefined }))
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "already-exists");
    assertEquals(error.exitCode, 1);
    assertEquals(error.detail?.includes("--force"), true);
  });

  projectTest("classifies missing atomic rename support as not-supported", async (parentDir) => {
    const fileSystem = overrideFileSystem(createFileSystem(), { rename: undefined });

    const error = await assertRejects(() =>
      createProject(
        baseRequest(parentDir),
        { fileSystem } satisfies CreateProjectDependencies,
      )
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "not-supported");
    assertEquals(error.detail?.includes("atomic .gitignore replacement"), true);
  });
});

describe("createProject filesystem failure handling", () => {
  projectTest(
    "propagates lstat failures instead of treating paths as absent",
    async (parentDir) => {
      const expected = new Error("lstat capability failed");
      const fileSystem = overrideFileSystem(createFileSystem(), {
        lstat: () => Promise.reject(expected),
      });

      const error = await assertRejects(() =>
        createProject(
          baseRequest(parentDir),
          { fileSystem } satisfies CreateProjectDependencies,
        )
      );

      assertEquals(error, expected);
    },
  );

  projectTest(
    "propagates nested preflight failures when scaffolding the current directory",
    async (parentDir) => {
      const expected = new Error("nested lstat capability failed");
      const nativeFileSystem = createFileSystem();
      if (!nativeFileSystem.lstat) throw new Error("runtime filesystem must provide lstat");
      const nativeLstat = nativeFileSystem.lstat.bind(nativeFileSystem);
      const failingPath = join(parentDir, ".gitignore");
      const fileSystem = overrideFileSystem(nativeFileSystem, {
        lstat: (path) =>
          path === failingPath ? Promise.reject(expected) : nativeLstat(path),
      });

      const error = await assertRejects(() =>
        createProject(
          baseRequest(parentDir, { name: undefined }),
          { fileSystem } satisfies CreateProjectDependencies,
        )
      );

      assertEquals(error, expected);
    },
  );

  projectTest("routes package metadata through the injected filesystem", async (parentDir) => {
    const expected = new Error("package metadata write failed");
    const nativeFileSystem = createFileSystem();
    const fileSystem = overrideFileSystem(nativeFileSystem, {
      writeTextFile: (path, data) =>
        path.endsWith("package.json")
          ? Promise.reject(expected)
          : nativeFileSystem.writeTextFile(path, data),
    });

    const error = await assertRejects(() =>
      createProject(
        baseRequest(parentDir),
        { fileSystem } satisfies CreateProjectDependencies,
      )
    );

    assertEquals(error, expected);
  });

  projectTest("routes Deno metadata through the injected filesystem", async (parentDir) => {
    const expected = new Error("Deno metadata write failed");
    const nativeFileSystem = createFileSystem();
    const fileSystem = overrideFileSystem(nativeFileSystem, {
      writeTextFile: (path, data) =>
        path.endsWith("deno.json")
          ? Promise.reject(expected)
          : nativeFileSystem.writeTextFile(path, data),
    });

    const error = await assertRejects(() =>
      createProject(
        baseRequest(parentDir, { runtime: "deno" }),
        { fileSystem } satisfies CreateProjectDependencies,
      )
    );

    assertEquals(error, expected);
  });

  projectTest("removes a partial temporary .gitignore after a write failure", async (parentDir) => {
    const nativeFileSystem = createFileSystem();
    const expected = new Error("partial temporary write");
    let temporaryPath: string | undefined;
    const fileSystem = overrideFileSystem(nativeFileSystem, {
      writeTextFile: async (path, data) => {
        if (!path.includes(".gitignore.veryfront-")) {
          await nativeFileSystem.writeTextFile(path, data);
          return;
        }
        temporaryPath = path;
        await nativeFileSystem.writeTextFile(path, "partial");
        throw expected;
      },
    });

    const error = await assertRejects(() =>
      createProject(
        baseRequest(parentDir),
        { fileSystem } satisfies CreateProjectDependencies,
      )
    );

    assertEquals(error, expected);
    if (temporaryPath === undefined) {
      throw new Error("Expected the temporary path to be captured");
    }
    assertEquals(await nativeFileSystem.exists(temporaryPath), false);
  });
});
