import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { computeSourceDigest, writePushReceipt } from "../deployment-provenance.ts";
import type {
  DeployControlPlane,
  DeployDeployment,
  DeployEnvironment,
  DeployProjectRecord,
  DeployRelease,
  DeployReleaseFile,
} from "./control-plane.ts";
import { createDeployProject, type DeployEvent, type DeployStepName } from "./deploy-project.ts";

const CONTROL_PLANE = "https://control.example.test/api";
const PROJECT_ID = "project-1";
const PROJECT_SLUG = "my-project";
const ENVIRONMENT_ID = "environment-1";

async function runGit(projectDir: string, ...args: string[]) {
  const result = await new Deno.Command("git", {
    args,
    cwd: projectDir,
    clearEnv: true,
    env: Object.fromEntries(
      Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
    ),
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
}

async function commitProject(projectDir: string) {
  await runGit(projectDir, "init", "--quiet");
  await runGit(projectDir, "config", "user.email", "test@veryfront.com");
  await runGit(projectDir, "config", "user.name", "Veryfront Test");
  await runGit(projectDir, "add", ".");
  await runGit(projectDir, "commit", "--quiet", "-m", "initial");
  const result = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: projectDir,
    clearEnv: true,
    env: Object.fromEntries(
      Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
    ),
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(result.stdout).trim();
}

function projectConfigText(): string {
  return JSON.stringify({ projectSlug: PROJECT_SLUG, apiUrl: CONTROL_PLANE }, null, 2) + "\n";
}

async function createPushedProject(): Promise<{ projectDir: string; commitSha: string }> {
  const projectDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${projectDir}/veryfront.json`, projectConfigText());
  await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
  const commitSha = await commitProject(projectDir);
  const sourceDigest = await computeSourceDigest([
    { path: "app.ts", content: "export const value = 1;\n" },
    { path: "veryfront.json", content: projectConfigText() },
  ]);
  await writePushReceipt(projectDir, {
    controlPlane: CONTROL_PLANE,
    projectId: PROJECT_ID,
    projectSlug: PROJECT_SLUG,
    branch: "main",
    commitSha,
    sourceDigest,
    clean: true,
  });
  return { projectDir, commitSha };
}

async function withDeployEnv<T>(fn: () => Promise<T>): Promise<T> {
  const keys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const saved = keys.map((key) => Deno.env.get(key));
  try {
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", CONTROL_PLANE);
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();
    return await fn();
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
  }
}

class InMemoryDeployControlPlane implements DeployControlPlane {
  readonly controlPlane = CONTROL_PLANE;
  readonly createdReleases: DeployRelease[] = [];
  readonly createdDeployments: DeployDeployment[] = [];
  deploymentReadCount = 0;

  private release: DeployRelease | null = null;
  private deployment: DeployDeployment | null = null;

  async getProject(_reference: string): Promise<DeployProjectRecord> {
    return { id: PROJECT_ID, slug: PROJECT_SLUG };
  }

  async getEnvironment(_reference: string, name: string): Promise<DeployEnvironment | null> {
    return {
      id: ENVIRONMENT_ID,
      name,
      protected: false,
      projectId: PROJECT_ID,
      deployment: this.deploymentReadCount > 0 && this.deployment && this.release
        ? {
          id: this.deployment.id,
          release: { id: this.release.id, name: this.release.name },
        }
        : null,
      domains: ["https://my-project.production.veryfront.com"],
    };
  }

  async createRelease(
    _reference: string,
    input: { name?: string; branch: string },
  ): Promise<DeployRelease> {
    const release = {
      id: "release-1",
      name: input.name ?? input.branch,
      version: "2026.07.30-1",
      projectId: PROJECT_ID,
    };
    this.release = release;
    this.createdReleases.push(release);
    return release;
  }

  async getRelease(_reference: string, releaseId: string): Promise<DeployRelease> {
    return this.release ?? {
      id: releaseId,
      name: "main",
      version: "2026.07.30-1",
      projectId: PROJECT_ID,
    };
  }

  async *listReleaseFiles(
    _reference: string,
    _releaseId: string,
  ): AsyncIterable<DeployReleaseFile> {
    yield { path: "app.ts", content: "export const value = 1;\n" };
    yield { path: "veryfront.json", content: projectConfigText() };
  }

  getReleaseAssetManifest() {
    return Promise.resolve({
      state: "ready" as const,
      manifest: {
        modules: {},
        routes: {},
      },
    });
  }

  async createDeployment(
    _reference: string,
    input: { releaseId: string; environmentId: string },
  ): Promise<DeployDeployment> {
    const deployment = {
      id: "deployment-1",
      releaseId: input.releaseId,
      environmentId: input.environmentId,
      routingConvergence: { status: "converged" as const, acknowledged: 1, recipients: 1 },
    };
    this.deployment = deployment;
    this.createdDeployments.push(deployment);
    return deployment;
  }

  async getDeployment(_reference: string, deploymentId: string): Promise<DeployDeployment> {
    this.deploymentReadCount++;
    return this.deployment ?? {
      id: deploymentId,
      releaseId: "release-1",
      environmentId: ENVIRONMENT_ID,
    };
  }
}

describe("DeployProject", () => {
  it("returns a dry-run plan without release or deployment mutation", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const deployment = createDeployProject({
          controlPlaneFactory: () => controlPlane,
        });

        const outcome = await deployment.execute({
          projectDir,
          environment: "production",
          mode: "dry-run",
          source: { kind: "already-pushed" },
        });

        assertEquals(outcome.kind, "dry-run");
        assertEquals(controlPlane.createdReleases, []);
        assertEquals(controlPlane.createdDeployments, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("emits verified deployment steps in canonical order", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      const events: DeployEvent[] = [];
      try {
        const deployment = createDeployProject({
          polling: {
            assetManifestPollIntervalMs: 100,
            assetManifestTimeoutMs: 100,
            environmentPollIntervalMs: 1,
            environmentTimeoutMs: 1_000,
          },
          controlPlaneFactory: () => controlPlane,
        });

        const outcome = await deployment.execute({
          projectDir,
          environment: "production",
          mode: "apply",
          source: { kind: "already-pushed" },
        }, {
          onEvent(event) {
            events.push(event);
          },
        });

        const completedSteps = events
          .filter((event): event is Extract<DeployEvent, { kind: "step" }> =>
            event.kind === "step" && event.phase === "completed"
          )
          .map((event) => event.step);
        const expectedSteps: DeployStepName[] = [
          "resolve-config",
          "resolve-target",
          "verify-source",
          "create-release",
          "verify-release-source",
          "wait-release-assets",
          "create-deployment",
          "verify-deployment",
          "wait-environment-url",
        ];

        assertEquals(outcome.kind, "deployed");
        assertEquals(completedSteps, expectedSteps);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});
