import "#veryfront/schemas/_test-setup.ts";

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { formatCLIError, VeryfrontError } from "veryfront/errors";
import { STARTER_TEMPLATE_NAMES } from "../../templates/types.ts";
import {
  createProject,
  type CreateProjectRequest,
  materializeScaffold,
  type ProjectCreationEvent,
} from "./project-creation.ts";

async function withGitIdentity(action: () => Promise<void>): Promise<void> {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const keys = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ];
  const originalDenoEnv = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  const originalProcessEnv = new Map(keys.map((key) => [key, processEnv?.[key]]));

  try {
    const env = {
      GIT_AUTHOR_NAME: "Veryfront Tests",
      GIT_AUTHOR_EMAIL: "tests@example.invalid",
      GIT_COMMITTER_NAME: "Veryfront Tests",
      GIT_COMMITTER_EMAIL: "tests@example.invalid",
    };
    for (const [key, value] of Object.entries(env)) {
      Deno.env.set(key, value);
      if (processEnv) processEnv[key] = value;
    }

    await action();
  } finally {
    for (const key of keys) {
      const denoValue = originalDenoEnv.get(key);
      if (denoValue === undefined) Deno.env.delete(key);
      else Deno.env.set(key, denoValue);

      if (processEnv) {
        const processValue = originalProcessEnv.get(key);
        if (processValue === undefined) delete processEnv[key];
        else processEnv[key] = processValue;
      }
    }
  }
}

function baseRequest(parentDir: string): CreateProjectRequest {
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
  };
}

describe("createProject", () => {
  it("returns the structured creation result for a minimal named project", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-contract-" });

    try {
      const result = await createProject(baseRequest(parentDir));

      assertEquals(result.projectDir, join(parentDir, "contract-project"));
      assertEquals(result.projectName, "contract-project");
      assertEquals(result.packageManager, "npm");
      assertEquals(result.dependencyInstallation, "skipped");
      assertEquals(result.gitInitialization, "skipped");
      assertEquals(result.createdPaths.includes("app/page.tsx"), true);
      assertEquals(result.createdPaths.includes("package.json"), true);
      assertEquals(result.createdPaths.includes(".gitignore"), true);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("fails or overwrites an existing project directory from the conflict policy", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-conflict-" });
    const request = baseRequest(parentDir);

    try {
      const result = await createProject(request);

      await assertRejects(
        () => createProject({ ...request, conflictPolicy: "fail" }),
        Error,
        'Directory "contract-project" already contains',
      );

      const overwritten = await createProject({
        ...request,
        conflictPolicy: "overwrite",
      });
      assertEquals(overwritten.projectDir, result.projectDir);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("rejects invalid project names before writing inside or outside parentDir", async () => {
    const cases = [
      {
        name: "",
        message: "Project name cannot be empty",
        forbiddenPath: ["parent", "app"],
      },
      {
        name: "   ",
        message: "Project name cannot be empty",
        forbiddenPath: ["parent", "   "],
      },
      {
        name: "nested/project",
        message: 'Project name cannot contain "/" or "\\"',
        forbiddenPath: ["parent", "nested"],
      },
      {
        name: "nested\\project",
        message: 'Project name cannot contain "/" or "\\"',
        forbiddenPath: ["parent", "nested\\project"],
      },
      {
        name: ".",
        message: 'Project name cannot be "." or ".."',
        forbiddenPath: ["parent", "app"],
      },
      {
        name: "..",
        message: 'Project name cannot be "." or ".."',
        forbiddenPath: ["app"],
      },
      {
        name: "../vf-escape-probe",
        message: 'Project name cannot contain "/" or "\\"',
        forbiddenPath: ["vf-escape-probe"],
      },
    ];

    for (const testCase of cases) {
      const rootDir = await makeTempDir({ prefix: "veryfront-create-invalid-name-" });
      const parentDir = join(rootDir, "parent");

      try {
        await assertRejects(
          () =>
            createProject({
              ...baseRequest(parentDir),
              name: testCase.name,
              conflictPolicy: "overwrite",
            }),
          Error,
          testCase.message,
        );

        assertEquals(await exists(join(rootDir, ...testCase.forbiddenPath)), false);
      } finally {
        await remove(rootDir, { recursive: true }).catch(() => {});
      }
    }
  });

  it("rejects an unknown template without creating the target directory", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-invalid-template-" });
    const projectDir = join(parentDir, "invalid-template");

    try {
      await assertRejects(
        () =>
          createProject({
            ...baseRequest(parentDir),
            name: "invalid-template",
            template: "missing-template" as CreateProjectRequest["template"],
          }),
        Error,
        'Unknown template "missing-template"',
      );

      assertEquals(await exists(projectDir), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("reports an unknown template as a typed error that lists the valid templates", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-unknown-template-" });

    try {
      const error = await assertRejects(
        () =>
          createProject({
            ...baseRequest(parentDir),
            name: "unknown-template",
            template: "blog" as CreateProjectRequest["template"],
          }),
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "template-not-found");
      assertEquals(error.exitCode, 2);

      const rendered = formatCLIError(error, { color: false, verbose: false });
      assertStringIncludes(rendered, "[template-not-found]");
      assertEquals(
        rendered.includes("[unknown-error]"),
        false,
        "an unknown --template value must not degrade to the unclassified error",
      );
      assertStringIncludes(rendered, 'Unknown template "blog"');
      for (const name of STARTER_TEMPLATE_NAMES) {
        assertStringIncludes(rendered, name);
      }
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("omits package metadata when package metadata is disabled", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-metadata-" });

    try {
      const metadataFree = await createProject({
        ...baseRequest(parentDir),
        name: "metadata-free",
        includePackageMetadata: false,
      });

      assertEquals(metadataFree.createdPaths.includes("package.json"), false);
      assertEquals(await exists(join(parentDir, "metadata-free", "package.json")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("writes resolved environment files for integration environment variables", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-env-" });
    const calls: string[][] = [];

    try {
      const result = await createProject({
        ...baseRequest(parentDir),
        name: "github-env",
        integrations: ["github"],
        environmentValues: {
          GITHUB_CLIENT_ID: "client-id",
          GITHUB_CLIENT_SECRET: "client-secret",
        },
      }, {
        resolveEnvironmentFiles: (variables, values) => {
          calls.push(variables.map((variable) => variable.name));
          assertEquals(values.GITHUB_CLIENT_ID, "client-id");
          assertEquals(values.GITHUB_CLIENT_SECRET, "client-secret");
          return Promise.resolve({
            envContent: "GITHUB_CLIENT_ID=client-id\nGITHUB_CLIENT_SECRET=client-secret\n",
            envExampleContent:
              "GITHUB_CLIENT_ID=your-client-id\nGITHUB_CLIENT_SECRET=your-secret\n",
          });
        },
      });

      assertEquals(calls, [["APP_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]]);
      assertEquals(result.createdPaths.includes(".env"), true);
      assertEquals(result.createdPaths.includes(".env.example"), true);

      const envContent = await Deno.readTextFile(join(parentDir, "github-env", ".env"));
      const envExampleContent = await Deno.readTextFile(
        join(parentDir, "github-env", ".env.example"),
      );
      assertStringIncludes(envContent, "GITHUB_CLIENT_ID=client-id");
      assertStringIncludes(envExampleContent, "GITHUB_CLIENT_SECRET=your-secret");
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("uses the canonical directory-backed integration base files", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-integration-base-" });
    const projectDir = join(parentDir, "github-base");

    try {
      const result = await createProject({
        ...baseRequest(parentDir),
        name: "github-base",
        integrations: ["github"],
      });

      assertEquals(result.createdPaths.includes("lib/token-store.ts"), true);
      assertEquals(result.createdPaths.includes("lib/oauth.ts"), true);

      const [tokenStore, oauth, initRoute, callbackRoute, statusRoute] = await Promise.all([
        Deno.readTextFile(join(projectDir, "lib/token-store.ts")),
        Deno.readTextFile(join(projectDir, "lib/oauth.ts")),
        Deno.readTextFile(join(projectDir, "app/api/auth/github/route.ts")),
        Deno.readTextFile(join(projectDir, "app/api/auth/github/callback/route.ts")),
        Deno.readTextFile(join(projectDir, "app/api/integrations/status/route.ts")),
      ]);
      assertStringIncludes(tokenStore, "createDefaultTokenStore");
      assertStringIncludes(tokenStore, "getDefaultTokenStore");
      assertStringIncludes(oauth, "postTokenRequest");
      assertStringIncludes(
        initRoute,
        'import { tokenStore } from "../../../../lib/token-store.ts";',
      );
      assertStringIncludes(
        callbackRoute,
        'import { tokenStore } from "../../../../../lib/token-store.ts";',
      );
      assertStringIncludes(
        statusRoute,
        'import { requireUserIdFromRequest } from "../../../../lib/user-id.ts";',
      );
      assertStringIncludes(statusRoute, "const userId = await requireUserIdFromRequest(req);");
      assertStringIncludes(statusRoute, 'return Response.json({ error: "Unauthorized" }');
      assertEquals(statusRoute.includes('"current-user"'), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("returns the setup tips assembled from selected integrations", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-tips-" });

    try {
      const result = await createProject({
        ...baseRequest(parentDir),
        name: "setup-tips",
        integrations: ["github"],
      });

      assertEquals(
        result.setupTips.includes("Visit /setup for guided OAuth app setup"),
        true,
      );
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("emits dependency installation observer events and installed status", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-install-" });
    const events: ProjectCreationEvent[] = [];
    const projectDir = join(parentDir, "install-events");

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(join(projectDir, "package.json"), "{}\n");

      const result = await createProject({
        ...baseRequest(parentDir),
        name: "install-events",
        conflictPolicy: "overwrite",
        installDependencies: true,
        includePackageMetadata: false,
      }, {
        observer: {
          onEvent(event) {
            events.push(event);
          },
        },
      });

      assertEquals(result.dependencyInstallation, "installed");
      assertEquals(events, [
        { kind: "dependency-installation-started", packageManager: "npm" },
        {
          kind: "dependency-installation-finished",
          packageManager: "npm",
          status: "installed",
        },
      ]);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("emits dependency installation observer events and failed status", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-install-failed-" });
    const events: ProjectCreationEvent[] = [];
    const projectDir = join(parentDir, "install-failed");

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(join(projectDir, "package.json"), "{");

      const result = await createProject({
        ...baseRequest(parentDir),
        name: "install-failed",
        conflictPolicy: "overwrite",
        installDependencies: true,
        includePackageMetadata: false,
      }, {
        observer: {
          onEvent(event) {
            events.push(event);
          },
        },
      });

      assertEquals(result.dependencyInstallation, "failed");
      assertEquals(events, [
        { kind: "dependency-installation-started", packageManager: "npm" },
        {
          kind: "dependency-installation-finished",
          packageManager: "npm",
          status: "failed",
        },
      ]);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("returns initialized Git state when Git initialization succeeds", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-git-ok-" });

    try {
      await withGitIdentity(async () => {
        const result = await createProject({
          ...baseRequest(parentDir),
          name: "git-initialized",
          initializeGit: true,
        });

        assertEquals(result.gitInitialization, "initialized");
        assertEquals(await exists(join(parentDir, "git-initialized", ".git")), true);
      });
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("returns failed Git state when Git initialization fails", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-git-failed-" });
    const projectDir = join(parentDir, "git-failed");

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(join(projectDir, ".git"), "not a git directory\n");

      const result = await createProject({
        ...baseRequest(parentDir),
        name: "git-failed",
        conflictPolicy: "overwrite",
        initializeGit: true,
      });

      assertEquals(result.gitInitialization, "failed");
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("maps runtime to deterministic package manager preferences", async () => {
    const cases: Array<{
      runtime: CreateProjectRequest["runtime"];
      packageManager: string;
      createdPath: string;
    }> = [
      { runtime: "node", packageManager: "npm", createdPath: "package.json" },
      { runtime: "bun", packageManager: "bun", createdPath: "package.json" },
      { runtime: "deno", packageManager: "deno", createdPath: "deno.json" },
    ];

    for (const testCase of cases) {
      const parentDir = await makeTempDir({
        prefix: `veryfront-create-runtime-${testCase.runtime}-`,
      });

      try {
        const result = await createProject({
          ...baseRequest(parentDir),
          name: `${testCase.runtime}-project`,
          runtime: testCase.runtime,
        });

        assertEquals(result.packageManager, testCase.packageManager);
        assertEquals(result.createdPaths.includes(testCase.createdPath), true);
        if (testCase.runtime === "deno") {
          assertEquals(await exists(join(parentDir, "deno-project", "deno.json")), true);
        }
      } finally {
        await remove(parentDir, { recursive: true }).catch(() => {});
      }
    }
  });
});

describe("cli/project-creation MDX extension declaration", () => {
  // Raised in review on #3783: `firstPartyExtensions` came only from the
  // template config, so any path that put an `.mdx` file into a project the
  // config knew nothing about scaffolded MDX routes with no extension
  // declared, and every one of them failed at runtime.
  //
  // The `mdx` feature was that path, and it is gone (#3797). The rule it
  // motivated is not: `withMdxExtension` derives the declaration from the
  // assembled file set, so a template that ships `.mdx` is covered whether or
  // not its config remembers to say so. `minimal` is the case that exists
  // today -- it ships `app/about/page.mdx`.
  it("declares ext-content-mdx for a template that ships an .mdx file", async () => {
    const scaffold = await materializeScaffold({
      template: "minimal",
      projectName: "mdx-file-probe",
    });

    assertEquals(
      scaffold.files.some((file) => file.path.endsWith(".mdx")),
      true,
      "this test is only meaningful while the template still ships an .mdx file",
    );

    const packageJson = JSON.parse(
      scaffold.files.find((file) => file.path === "package.json")?.content ?? "{}",
    );
    const declared = Object.keys(packageJson.dependencies ?? {});
    assertEquals(
      declared.includes("@veryfront/ext-content-mdx"),
      true,
      `expected @veryfront/ext-content-mdx to be declared, got ${declared.join(", ")}`,
    );
  });

  it("does not declare ext-content-mdx for a template with no mdx files", async () => {
    const scaffold = await materializeScaffold({
      template: "ai-agent",
      projectName: "no-mdx-probe",
    });

    const mdxFiles = scaffold.files.filter((file) => file.path.endsWith(".mdx"));
    assertEquals(mdxFiles.length, 0, "ai-agent alone should ship no .mdx");

    const packageJson = JSON.parse(
      scaffold.files.find((file) => file.path === "package.json")?.content ?? "{}",
    );
    const declared = Object.keys(packageJson.dependencies ?? {});
    assertEquals(declared.includes("@veryfront/ext-content-mdx"), false);
  });
});

describe("createProject into the current directory", () => {
  /** The request `veryfront init` builds when no project name is given. */
  function cwdRequest(parentDir: string): CreateProjectRequest {
    return { ...baseRequest(parentDir), name: undefined };
  }

  it("refuses to overwrite files the scaffold would write when the policy is fail", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-cwd-conflict-" });
    const readme = join(parentDir, "README.md");
    const packageJson = join(parentDir, "package.json");

    try {
      await Deno.writeTextFile(readme, "mine\n");
      await Deno.writeTextFile(packageJson, '{"name":"mine"}\n');

      await assertRejects(
        () => createProject(cwdRequest(parentDir)),
        Error,
        "README.md",
      );

      assertEquals(await Deno.readTextFile(readme), "mine\n");
      assertEquals(await Deno.readTextFile(packageJson), '{"name":"mine"}\n');
      assertEquals(await exists(join(parentDir, "app")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("names every file that would be overwritten", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-cwd-conflicts-" });

    try {
      await Deno.writeTextFile(join(parentDir, "README.md"), "mine\n");
      await Deno.writeTextFile(join(parentDir, "package.json"), "{}\n");

      const error = await createProject(cwdRequest(parentDir)).then(
        () => null,
        (caught: unknown) => caught,
      );

      assert(error instanceof Error, "expected the conflict to reject");
      assertStringIncludes(error.message, "README.md");
      assertStringIncludes(error.message, "package.json");
      assertStringIncludes(error.message, "--force");
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("scaffolds into an empty directory, and beside unrelated files", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-cwd-empty-" });

    try {
      await Deno.writeTextFile(join(parentDir, "notes.txt"), "unrelated\n");
      // .gitignore is merged rather than replaced, so it is never a conflict.
      await Deno.writeTextFile(join(parentDir, ".gitignore"), "dist\n");

      const result = await createProject(cwdRequest(parentDir));

      assertEquals(result.projectDir, parentDir);
      assertEquals(await exists(join(parentDir, "app", "page.tsx")), true);
      assertEquals(await Deno.readTextFile(join(parentDir, "notes.txt")), "unrelated\n");
      assertStringIncludes(await Deno.readTextFile(join(parentDir, ".gitignore")), "dist");
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("names every path a fresh scaffold writes, so the conflict list cannot drift", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-cwd-drift-" });
    // Deno plus an integration is the widest scaffold there is: template files,
    // package.json, deno.json, .env and .env.example all get written.
    const request: CreateProjectRequest = {
      ...cwdRequest(parentDir),
      runtime: "deno",
      integrations: ["github"],
    };

    try {
      const written = await createProject(request);

      // Run again over what the first run just wrote. Every one of those paths
      // has to come back named, which is what stops the conflict list drifting
      // when a new write lands in createProject and nobody mirrors it into
      // scaffoldWritePaths. .gitignore is merged, so it stays off the list.
      const error = await createProject(request).then(
        () => null,
        (caught: unknown) => caught,
      );

      assert(error instanceof Error, "expected the second run to reject");
      for (const path of written.createdPaths) {
        if (path === ".gitignore") continue;
        assertStringIncludes(error.message, path);
      }
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("overwrites when the policy says so", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-cwd-overwrite-" });
    const readme = join(parentDir, "README.md");

    try {
      await Deno.writeTextFile(readme, "mine\n");

      await createProject({ ...cwdRequest(parentDir), conflictPolicy: "overwrite" });

      assertEquals((await Deno.readTextFile(readme)) === "mine\n", false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });
});

describe("createProject into an existing named directory", () => {
  it("scaffolds into an existing empty directory", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-empty-named-" });

    try {
      // `mkdir app && veryfront init app`, or a freshly cloned empty repo.
      await Deno.mkdir(join(parentDir, "contract-project"));

      const result = await createProject(baseRequest(parentDir));

      assertEquals(result.projectDir, join(parentDir, "contract-project"));
      assertEquals(await exists(join(parentDir, "contract-project", "app", "page.tsx")), true);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("scaffolds beside files the template does not write", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-beside-named-" });
    const projectDir = join(parentDir, "contract-project");

    try {
      await Deno.mkdir(join(projectDir, ".git"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "LICENSE"), "MIT\n");

      await createProject(baseRequest(parentDir));

      assertEquals(await exists(join(projectDir, "app", "page.tsx")), true);
      assertEquals(await Deno.readTextFile(join(projectDir, "LICENSE")), "MIT\n");
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("names the files it would overwrite, not just the directory", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-conflict-named-" });
    const projectDir = join(parentDir, "contract-project");

    try {
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(join(projectDir, "README.md"), "mine\n");

      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains README.md',
      );

      assertEquals(await Deno.readTextFile(join(projectDir, "README.md")), "mine\n");
      assertEquals(await exists(join(projectDir, "app")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });
});

describe("createProject when a path cannot be written through", () => {
  it("refuses a file where the scaffold needs a directory, before writing anything", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-blocked-file-" });
    const projectDir = join(parentDir, "contract-project");

    try {
      await Deno.mkdir(projectDir);
      // `app/page.tsx` cannot resolve through a regular `app`, so the conflict
      // check sees nothing and the scaffold used to write README.md and
      // AGENTS.md before failing on the directory it could not create.
      await Deno.writeTextFile(join(projectDir, "app"), "mine\n");

      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains app as a file or a link',
      );

      assertEquals(await Deno.readTextFile(join(projectDir, "app")), "mine\n");
      assertEquals(await exists(join(projectDir, "README.md")), false);
      assertEquals(await exists(join(projectDir, "AGENTS.md")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a link where the scaffold needs a directory, and writes nothing through it", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-blocked-link-" });
    const projectDir = join(parentDir, "contract-project");
    const outside = join(parentDir, "outside");

    try {
      await Deno.mkdir(projectDir);
      await Deno.mkdir(outside);
      await Deno.symlink(outside, join(projectDir, "app"));

      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains app as a file or a link',
      );

      // The scaffold would otherwise report success and leave page.tsx,
      // layout.tsx and about/page.mdx outside the project it named.
      assertEquals(await exists(join(outside, "page.tsx")), false);
      assertEquals(await exists(join(outside, "layout.tsx")), false);
      assertEquals(await exists(join(projectDir, "README.md")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a blocked directory in the current-directory path too", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-blocked-cwd-" });
    const outside = await makeTempDir({ prefix: "veryfront-create-blocked-target-" });

    try {
      await Deno.symlink(outside, join(parentDir, "app"));

      await assertRejects(
        () => createProject({ ...baseRequest(parentDir), name: undefined }),
        Error,
        "Directory already contains app as a file or a link",
      );

      assertEquals(await exists(join(outside, "page.tsx")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
      await remove(outside, { recursive: true }).catch(() => {});
    }
  });

  it("refuses under --force as well, because force overwrites files it does not redirect writes", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-blocked-force-" });
    const projectDir = join(parentDir, "contract-project");
    const outside = join(parentDir, "outside");

    try {
      await Deno.mkdir(projectDir);
      await Deno.mkdir(outside);
      await Deno.symlink(outside, join(projectDir, "app"));

      await assertRejects(
        () => createProject({ ...baseRequest(parentDir), conflictPolicy: "overwrite" }),
        Error,
        'Directory "contract-project" already contains app as a file or a link',
      );

      assertEquals(await exists(join(outside, "page.tsx")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a block nested below a directory that is genuinely there", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-blocked-nested-" });
    const projectDir = join(parentDir, "contract-project");

    try {
      // `app/` is a real directory, so only the second segment is in the way.
      // Checking the first segment alone would let the scaffold write
      // app/page.tsx and app/layout.tsx before failing on app/about.
      await Deno.mkdir(join(projectDir, "app"), { recursive: true });
      await Deno.writeTextFile(join(projectDir, "app", "about"), "mine\n");

      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains app/about as a file or a link',
      );

      assertEquals(await Deno.readTextFile(join(projectDir, "app", "about")), "mine\n");
      assertEquals(await exists(join(projectDir, "app", "page.tsx")), false);
      assertEquals(await exists(join(projectDir, "README.md")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a link at a scaffold path itself, dangling or not", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-leaf-link-" });
    const projectDir = join(parentDir, "contract-project");
    const outside = join(parentDir, "outside.md");

    try {
      await Deno.mkdir(projectDir);
      // A dangling link resolves to nothing, so `findExistingPaths` reports it
      // absent and the write follows it out of the project.
      await Deno.symlink(outside, join(projectDir, "README.md"));

      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains README.md as a file or a link',
      );

      assertEquals(await exists(outside), false);
      assertEquals(await exists(join(projectDir, "AGENTS.md")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a link at a scaffold path under --force as well", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-leaf-force-" });
    const projectDir = join(parentDir, "contract-project");
    const outside = join(parentDir, "outside.md");

    try {
      await Deno.mkdir(projectDir);
      await Deno.symlink(outside, join(projectDir, "README.md"));

      await assertRejects(
        () => createProject({ ...baseRequest(parentDir), conflictPolicy: "overwrite" }),
        Error,
        'Directory "contract-project" already contains README.md as a file or a link',
      );

      assertEquals(await exists(outside), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a linked .gitignore before merging it", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-gitignore-link-" });
    const projectDir = join(parentDir, "contract-project");
    const outside = join(parentDir, "outside-gitignore");

    try {
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(outside, "keep-me\n");
      await Deno.symlink(outside, join(projectDir, ".gitignore"));

      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains .gitignore as a file or a link',
      );

      assertEquals(await Deno.readTextFile(outside), "keep-me\n");
      assertEquals(await exists(join(projectDir, "README.md")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("still reports a real file at a scaffold path as an overwritable conflict", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-leaf-file-" });
    const projectDir = join(parentDir, "contract-project");

    try {
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(join(projectDir, "README.md"), "mine\n");

      // A real file resolves fine, so it stays a conflict pointing at --force
      // rather than the refusal above.
      await assertRejects(
        () => createProject(baseRequest(parentDir)),
        Error,
        'Directory "contract-project" already contains README.md. Use --force to overwrite.',
      );
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("refuses a linked project root instead of scaffolding through it", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-linked-root-" });
    const outside = await makeTempDir({ prefix: "veryfront-create-outside-" });

    try {
      await Deno.symlink(outside, join(parentDir, "contract-project"));

      await assertRejects(
        () => createProject({ ...baseRequest(parentDir), conflictPolicy: "overwrite" }),
        Error,
        'Directory "contract-project" is a link the scaffold cannot write through',
      );

      // Nothing reached the link target, which is outside the parent entirely.
      assertEquals(await exists(join(outside, "README.md")), false);
      assertEquals(await exists(join(outside, "package.json")), false);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
      await remove(outside, { recursive: true }).catch(() => {});
    }
  });

  it("scaffolds normally when the directories it needs are absent or already directories", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-blocked-clear-" });
    const projectDir = join(parentDir, "contract-project");

    try {
      // A real `app/` directory is not in the way, it is exactly what the
      // scaffold is about to create.
      await Deno.mkdir(join(projectDir, "app"), { recursive: true });

      await createProject(baseRequest(parentDir));

      assertEquals(await exists(join(projectDir, "app", "page.tsx")), true);
      assertEquals(await exists(join(projectDir, "README.md")), true);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });
});

describe("createProject error classification", () => {
  it("rejects a bad project name as a usage error", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-name-class-" });

    try {
      const error = await assertRejects(() =>
        createProject({ ...baseRequest(parentDir), name: "nested/name" })
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
      assertEquals(error.exitCode, 2);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });

  it("rejects files it would overwrite as already-exists", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-exists-class-" });

    try {
      await Deno.writeTextFile(join(parentDir, "README.md"), "mine\n");

      const error = await assertRejects(() =>
        createProject({ ...baseRequest(parentDir), name: undefined })
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "already-exists");
      assertEquals(error.exitCode, 1);
      assertEquals(error.detail?.includes("--force"), true);
    } finally {
      await remove(parentDir, { recursive: true }).catch(() => {});
    }
  });
});
