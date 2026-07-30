import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import {
  createProject,
  type CreateProjectRequest,
  type ProjectCreationEvent,
} from "./project-creation.ts";

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
    const binDir = await makeTempDir({ prefix: "veryfront-create-bin-" });
    const originalPath = Deno.env.get("PATH");
    const events: ProjectCreationEvent[] = [];

    try {
      const fakeNpm = join(binDir, "npm");
      await Deno.writeTextFile(fakeNpm, "#!/bin/sh\nexit 0\n");
      await Deno.chmod(fakeNpm, 0o755);
      Deno.env.set("PATH", `${binDir}${originalPath ? `:${originalPath}` : ""}`);

      const result = await createProject({
        ...baseRequest(parentDir),
        name: "install-events",
        installDependencies: true,
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
      if (originalPath === undefined) Deno.env.delete("PATH");
      else Deno.env.set("PATH", originalPath);
      await remove(parentDir, { recursive: true }).catch(() => {});
      await remove(binDir, { recursive: true }).catch(() => {});
    }
  });
});
