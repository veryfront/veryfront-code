import "#veryfront/schemas/_test-setup.ts";

import {
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
    features: [],
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
        'Directory "contract-project" already exists',
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

  it("returns feature tips assembled from selected features", async () => {
    const parentDir = await makeTempDir({ prefix: "veryfront-create-tips-" });

    try {
      const result = await createProject({
        ...baseRequest(parentDir),
        name: "feature-tips",
        features: ["ai"],
      });

      assertEquals(
        result.featureTips.includes("The AG-UI endpoint is available at /api/ag-ui"),
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
