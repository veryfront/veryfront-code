import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  DEPLOYMENT_ERROR,
  ENVIRONMENT_NOT_FOUND,
  RELEASE_MISSING_VERSION,
  SOURCE_DIGEST_MISMATCH,
  VeryfrontError,
} from "veryfront/errors";
import type { ReleaseAssetManifestResponse } from "veryfront/release-assets";
import { computeSourceDigest, writePushReceipt } from "../deployment-provenance.ts";
import type {
  DeployControlPlane,
  DeployDeployment,
  DeployEnvironment,
  DeployProjectRecord,
  DeployRelease,
  DeployReleaseFile,
} from "./control-plane.ts";
import {
  createDeployProject,
  type DeployEvent,
  type DeployStepName,
  waitForReleaseAssetManifest,
} from "./deploy-project.ts";

const CONTROL_PLANE = "https://control.example.test/api";
const PROJECT_ID = "project-1";
const PROJECT_SLUG = "my-project";
const ENVIRONMENT_ID = "environment-1";
const APP_ROUTE_CONTENT = "export default function Page() { return <main>Hello</main>; }\n";

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
  await Deno.mkdir(`${projectDir}/app`, { recursive: true });
  await Deno.writeTextFile(`${projectDir}/veryfront.json`, projectConfigText());
  await Deno.writeTextFile(`${projectDir}/app/page.tsx`, APP_ROUTE_CONTENT);
  const commitSha = await commitProject(projectDir);
  const sourceDigest = await computeSourceDigest([
    { path: "app/page.tsx", content: APP_ROUTE_CONTENT },
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

async function withFetchStub<T>(
  handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(handler(input, init))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function expectDeployError(
  fn: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected deployment to reject");
}

function readyManifest(routes: Record<string, { modules: string[]; css: string[] }> = {
  "/": { modules: ["app/page.js"], css: [] },
}): ReleaseAssetManifestResponse {
  return {
    state: "ready",
    manifest_version: 1,
    manifest: {
      schemaVersion: 2,
      projectId: PROJECT_ID,
      releaseId: "release-1",
      releaseVersion: 1,
      manifestVersion: 1,
      builderVersion: "test",
      sourceContentHash: "b".repeat(64),
      createdAt: "2026-07-30T00:00:00.000Z",
      assetBasePath: "/_vf/assets",
      modules: {
        "app/page.js": {
          contentHash: "a".repeat(64),
          size: 12,
          contentType: "text/javascript",
        },
      },
      css: [],
      routes,
      dependencyMode: "source",
      dependencies: {},
    },
  };
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
  getProjectError: unknown;
  environment: DeployEnvironment | null | undefined;
  releaseVersion: string | null = "2026.07.30-1";
  releaseProjectId = PROJECT_ID;
  releaseFiles: DeployReleaseFile[] = [
    { path: "app/page.tsx", content: APP_ROUTE_CONTENT },
    { path: "veryfront.json", content: projectConfigText() },
  ];
  manifestResponses: unknown[] = [readyManifest()];
  deploymentRoutingConvergence:
    | DeployDeployment["routingConvergence"]
    | undefined = { status: "converged", acknowledged: 1, recipients: 1 };
  deploymentReadCount = 0;

  private release: DeployRelease | null = null;
  private deployment: DeployDeployment | null = null;

  async getProject(_reference: string): Promise<DeployProjectRecord> {
    if (this.getProjectError) throw this.getProjectError;
    return { id: PROJECT_ID, slug: PROJECT_SLUG };
  }

  async getEnvironment(_reference: string, name: string): Promise<DeployEnvironment | null> {
    if (this.environment !== undefined) return this.environment;
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
      version: this.releaseVersion,
      projectId: this.releaseProjectId,
    };
    this.release = release;
    this.createdReleases.push(release);
    return release;
  }

  async getRelease(_reference: string, releaseId: string): Promise<DeployRelease> {
    return this.release ?? {
      id: releaseId,
      name: "main",
      version: this.releaseVersion,
      projectId: this.releaseProjectId,
    };
  }

  async *listReleaseFiles(
    _reference: string,
    _releaseId: string,
  ): AsyncIterable<DeployReleaseFile> {
    for (const file of this.releaseFiles) yield file;
  }

  getReleaseAssetManifest() {
    return Promise.resolve(
      this.manifestResponses.length > 1
        ? this.manifestResponses.shift() ?? null
        : this.manifestResponses[0] ?? null,
    );
  }

  async createDeployment(
    _reference: string,
    input: { releaseId: string; environmentId: string },
  ): Promise<DeployDeployment> {
    const deployment = {
      id: "deployment-1",
      releaseId: input.releaseId,
      environmentId: input.environmentId,
      routingConvergence: this.deploymentRoutingConvergence,
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

function createDeployment(controlPlane: InMemoryDeployControlPlane) {
  return createDeployProject({
    polling: {
      assetManifestPollIntervalMs: 100,
      assetManifestTimeoutMs: 100,
      environmentPollIntervalMs: 1,
      environmentTimeoutMs: 1_000,
    },
    controlPlaneFactory: () => controlPlane,
  });
}

async function executeApply(
  projectDir: string,
  controlPlane: InMemoryDeployControlPlane,
  observer?: { onEvent(event: DeployEvent): void | Promise<void> },
) {
  return await withFetchStub(
    () => new Response("ready"),
    () =>
      createDeployment(controlPlane).execute({
        projectDir,
        environment: "production",
        mode: "apply",
        source: { kind: "already-pushed" },
      }, observer),
  );
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
      const readinessRequests: string[] = [];
      try {
        const outcome = await withFetchStub((input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          readinessRequests.push(request.url);
          return new Response("ready");
        }, () =>
          createDeployment(controlPlane).execute({
            projectDir,
            environment: "production",
            mode: "apply",
            source: { kind: "already-pushed" },
          }, {
            onEvent(event) {
              events.push(event);
            },
          }));

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
        assertEquals(readinessRequests, ["https://my-project.production.veryfront.com/"]);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("preserves VeryfrontError instances from project resolution", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      const original = DEPLOYMENT_ERROR.create({
        detail: "Project lookup failed with structured context",
        context: { requestId: "req-1" },
      });
      controlPlane.getProjectError = original;
      try {
        const error = await expectDeployError(() =>
          createDeployment(controlPlane).execute({
            projectDir,
            environment: "production",
            mode: "dry-run",
            source: { kind: "already-pushed" },
          })
        );

        assertStrictEquals(error, original);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("throws the environment-not-found registry error for missing environments", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environment = null;
      try {
        const error = await expectDeployError(() =>
          createDeployment(controlPlane).execute({
            projectDir,
            environment: "preview",
            mode: "dry-run",
            source: { kind: "already-pushed" },
          })
        );

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, ENVIRONMENT_NOT_FOUND.create().slug);
        assertEquals((error as VeryfrontError).status, 404);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects a release that is created without a version", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.releaseVersion = null;
      try {
        const error = await expectDeployError(() => executeApply(projectDir, controlPlane));

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, RELEASE_MISSING_VERSION.create().slug);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects source digest mismatches before deployment mutation", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.releaseFiles = [
        { path: "app/page.tsx", content: "export default function Page() { return null; }\n" },
        { path: "veryfront.json", content: projectConfigText() },
      ];
      try {
        const error = await expectDeployError(() => executeApply(projectDir, controlPlane));

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, SOURCE_DIGEST_MISMATCH.create().slug);
        assertEquals(controlPlane.createdDeployments, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects environment ownership mismatches before release mutation", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environment = {
        id: ENVIRONMENT_ID,
        name: "production",
        protected: false,
        projectId: "another-project",
        deployment: null,
        domains: ["https://my-project.production.veryfront.com"],
      };
      try {
        const error = await expectDeployError(() => executeApply(projectDir, controlPlane));

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, DEPLOYMENT_ERROR.create().slug);
        assertEquals(controlPlane.createdReleases, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects failed release asset manifests before deployment mutation", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.manifestResponses = [{
        state: "failed",
        manifest_version: 1,
        manifest: null,
      }];
      try {
        await assertRejects(
          () => executeApply(projectDir, controlPlane),
          Error,
          "Release asset build failed",
        );
        assertEquals(controlPlane.createdDeployments, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects incomplete release asset manifests before deployment mutation", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.manifestResponses = [{
        state: "queued",
        manifest_version: 1,
        manifest: null,
      }];
      try {
        await assertRejects(
          () => executeApply(projectDir, controlPlane),
          Error,
          "Release assets were not ready",
        );
        assertEquals(controlPlane.createdDeployments, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects ready manifests that do not cover the page route", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.manifestResponses = [readyManifest({})];
      try {
        await assertRejects(
          () => executeApply(projectDir, controlPlane),
          Error,
          "Missing routes: /",
        );
        assertEquals(controlPlane.createdDeployments, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("propagates non-not-found route directory inspection errors before deployment mutation", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.config.ts`,
          'export default { directories: { app: "app\\0" } };\n',
        );

        await assertRejects(
          () => executeApply(projectDir, controlPlane),
          TypeError,
        );
        assertEquals(controlPlane.createdReleases, []);
        assertEquals(controlPlane.createdDeployments, []);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("emits routing convergence warnings after deployment verification", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      const events: DeployEvent[] = [];
      controlPlane.deploymentRoutingConvergence = { status: "pending" };
      try {
        const outcome = await executeApply(projectDir, controlPlane, {
          onEvent(event) {
            events.push(event);
          },
        });

        assertEquals(outcome.kind, "deployed");
        const warning = events.find((event) => event.kind === "warning");
        assertEquals(warning, {
          kind: "warning",
          code: "routing-convergence-unconfirmed",
          message:
            "Deployment deployment-1 committed, but data-plane routing convergence was not confirmed; bounded cache expiry remains the recovery path",
        });
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("awaits async observer events before starting the next deployment step", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      const order: string[] = [];
      try {
        await executeApply(projectDir, controlPlane, {
          async onEvent(event) {
            if (event.kind !== "step") return;
            if (event.step === "create-release" && event.phase === "completed") {
              await new Promise((resolve) => setTimeout(resolve, 10));
              order.push("create-release:completed:after-delay");
              return;
            }
            if (event.step === "verify-release-source" && event.phase === "started") {
              order.push("verify-release-source:started");
            }
          },
        });

        assertEquals(order, [
          "create-release:completed:after-delay",
          "verify-release-source:started",
        ]);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("surfaces readiness failures for the discovered page route", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      const requestedUrls: string[] = [];
      try {
        const error = await expectDeployError(() =>
          withFetchStub((input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            requestedUrls.push(request.url);
            return new Response("missing", { status: 404 });
          }, () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "production",
              mode: "apply",
              source: { kind: "already-pushed" },
            }))
        );

        assertMatch(String((error as Error).message), /did not become ready/);
        assertEquals(
          requestedUrls.every((url) => url === "https://my-project.production.veryfront.com/"),
          true,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});

describe("waitForReleaseAssetManifest", () => {
  function controlPlaneReturning(...responses: unknown[]): DeployControlPlane {
    const controlPlane = new InMemoryDeployControlPlane();
    controlPlane.manifestResponses = responses;
    return controlPlane;
  }

  const polling = {
    expectedRoutes: ["/"],
    pollIntervalMs: 100,
    timeoutMs: 100,
  };

  it("parses a valid ready response for the requested release", async () => {
    const result = await waitForReleaseAssetManifest(
      controlPlaneReturning(readyManifest()),
      PROJECT_SLUG,
      "release-1",
      polling,
    );

    assertEquals(result.state, "ready");
    assertEquals(result.manifest.releaseId, "release-1");
  });

  it("rejects legacy ready manifests", async () => {
    const current = readyManifest();
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning({
            ...current,
            manifest: { ...current.manifest, schemaVersion: 1 },
          }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "invalid or mismatched ready manifest",
    );
  });

  it("rejects ready manifests for another release", async () => {
    const current = readyManifest();
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning({
            ...current,
            manifest: { ...current.manifest, releaseId: "release-other" },
          }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "invalid or mismatched ready manifest",
    );
  });

  it("rejects accessor-backed states without executing accessors", async () => {
    let accessorCalls = 0;
    const hostileResponse: Record<string, unknown> = {};
    Object.defineProperty(hostileResponse, "state", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "ready";
      },
    });

    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning(hostileResponse),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "invalid state response",
    );
    assertEquals(accessorCalls, 0);
  });

  it("rejects oversized manifest states", async () => {
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning({ state: "q".repeat(65) }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "invalid state response",
    );
  });

  it("fails closed for partial manifests", async () => {
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning({ state: "partial" }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "unsupported partial manifest",
    );
  });

  it("fails closed for superseded manifests", async () => {
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning({ state: "superseded" }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "Release asset build failed",
    );
  });

  it("fails closed for unsupported manifest states", async () => {
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          controlPlaneReturning({ state: "unexpected" }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "unsupported state response",
    );
  });
});
