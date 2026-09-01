import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import {
  DEPLOYMENT_ERROR,
  ENVIRONMENT_NOT_FOUND,
  RELEASE_MISSING_VERSION,
  SOURCE_DIGEST_MISMATCH,
  VeryfrontError,
} from "veryfront/errors";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { fromFileUrl, relative } from "veryfront/platform/path";
import { createApiClient } from "../config.ts";
import { computeSourceDigest, writePushReceipt } from "../deployment-provenance.ts";
import {
  createHttpDeployControlPlane,
  type DeployControlPlane,
  type DeployReleaseAssetManifestBody,
  type DeployReleaseFile,
} from "./control-plane.ts";
import {
  assertProjectOwnership,
  createDeployProject,
  type DeployEvent,
  type DeployProjectRequest,
  type DeployStepName,
  resolvePushedSource,
  verifyDeployment,
  verifyReleaseSource,
  waitForEnvironmentReady,
  waitForReleaseAssetManifest,
} from "./deploy-project.ts";
import {
  commitProject,
  CONTROL_PLANE,
  createPushedProject,
  createUnlinkedPushedProject,
  ENVIRONMENT_ID,
  InMemoryDeployControlPlane,
  PROJECT_ID,
  PROJECT_SLUG,
  projectConfigText,
  readyManifest,
  withDeployEnv,
  withFetchStub,
} from "../../test-utils/deploy-test-support.ts";

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

async function expectErrorMessage(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return;
  } catch (e) {
    return (e as Error).message;
  }
}

function helperControlPlane(overrides: Partial<DeployControlPlane>): DeployControlPlane {
  return {
    controlPlane: CONTROL_PLANE,
    getProject: () => Promise.resolve({ id: PROJECT_ID, slug: PROJECT_SLUG }),
    getEnvironment: () => Promise.resolve(null),
    createRelease: () => Promise.reject(new Error("unexpected createRelease call")),
    getRelease: () => Promise.reject(new Error("unexpected getRelease call")),
    listReleaseFiles: async function* () {},
    getReleaseAssetManifest: () => Promise.resolve(null),
    createDeployment: () => Promise.reject(new Error("unexpected createDeployment call")),
    getDeployment: () => Promise.reject(new Error("unexpected getDeployment call")),
    createEnvironmentAccessToken: () =>
      Promise.reject(new Error("unexpected createEnvironmentAccessToken call")),
    ...overrides,
  };
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
  request?: Partial<DeployProjectRequest>,
) {
  return await withFetchStub(
    () => new Response("ready"),
    () =>
      createDeployment(controlPlane).execute({
        projectDir,
        environment: "production",
        mode: "apply",
        source: { kind: "already-pushed" },
        ...request,
      }, observer),
  );
}

// JWT-shaped, as the API mints it; the probe refuses anything else.
const EXCHANGED_SESSION_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJ1c2VySWQiOiJ1XzEiLCJ0b2tlblVzZSI6ImVudmlyb25tZW50X2FjY2VzcyJ9.sig";
const API_KEY_TOKEN = "vf_d157f0000000000000000000000000000000000";
const REPOSITORY_ROOT = fromFileUrl(new URL("../../../", import.meta.url));

describe("DeployProject", () => {
  it("prefers the request projectSlug over configured project references", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const outcome = await executeApply(projectDir, controlPlane, undefined, {
          projectSlug: "other-project",
        });

        assertEquals(outcome.kind, "deployed", "request-scoped deploy should complete");
        assertEquals(
          controlPlane.projectLookups[0],
          "other-project",
          "project lookup should use the request projectSlug, not the configured reference",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("rejects a request projectSlug combined with ensure-pushed source", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const error = await expectDeployError(() =>
          executeApply(projectDir, controlPlane, undefined, {
            projectSlug: "other-project",
            source: { kind: "ensure-pushed" },
          })
        );

        assertMatch(
          (error as Error).message,
          /already-pushed/,
          "request-scoped deploys must require an already-pushed source",
        );
        assertEquals(controlPlane.createdReleases, [], "no release before the rejection");
        assertEquals(controlPlane.createdDeployments, [], "no deployment before the rejection");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("refuses a config the hosted runtime can never evaluate", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `import { defineConfig } from "veryfront";\n` +
          `import extOther from "some-third-party-extension";\n\n` +
          `export default defineConfig({\n  extensions: [extOther()],\n});\n`,
      );
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const error = await expectDeployError(() => executeApply(projectDir, controlPlane));

        const message = (error as Error).message;
        assertStringIncludes(message, "veryfront.config.ts");
        assertStringIncludes(message, "some-third-party-extension");
        assertEquals(controlPlane.createdReleases, [], "no release for an undeployable config");
        assertEquals(
          controlPlane.createdDeployments,
          [],
          "no deployment for an undeployable config",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("refuses a literal config the hosted result policy always rejects", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      // Every construct here is one the hosted evaluator parses happily. It
      // refuses the record afterwards, on every request, so a deploy that let
      // this through would report success over an environment answering 500.
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `export default { cache: { dir: ".tenant-cache" } };\n`,
      );
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const error = await expectDeployError(() => executeApply(projectDir, controlPlane));

        assertStringIncludes((error as Error).message, "cache.dir");
        assertEquals(controlPlane.createdReleases, [], "no release for an undeployable config");
        assertEquals(
          controlPlane.createdDeployments,
          [],
          "no deployment for an undeployable config",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("deploys a config that only uses the hosted configuration helpers", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `import { defineConfig } from "veryfront";\n\n` +
          `export default defineConfig({ title: "Demo" });\n`,
      );
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const outcome = await executeApply(projectDir, controlPlane);

        assertEquals(outcome.kind, "deployed", "a hosted-compatible config still deploys");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("deploys a request-scoped project without inferring or persisting a local link", async () => {
    await withDeployEnv(async () => {
      const { projectDir, files } = await createUnlinkedPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.releaseFiles = files;
      try {
        const outcome = await executeApply(projectDir, controlPlane, undefined, {
          projectSlug: PROJECT_SLUG,
        });

        assertEquals(outcome.kind, "deployed", "explicit request slug should bypass inference");
        const linkExists = await Deno.stat(`${projectDir}/.veryfront/project.json`)
          .then(() => true, () => false);
        assertEquals(
          linkExists,
          false,
          "request-scoped deploys must not persist a project link",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

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

  it("normalizes relative project directories at the execution boundary", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      try {
        const deployment = createDeployProject({
          controlPlaneFactory: () => controlPlane,
        });
        const relativeProjectDir = relative(REPOSITORY_ROOT, projectDir);

        const outcome = await deployment.execute({
          projectDir: relativeProjectDir,
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
          "unexpected NUL byte",
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

  /**
   * The readiness probe cannot get past a protected environment's access gate
   * without a session credential, so a gate challenge is all it ever sees. The
   * app behind the gate can be answering 503 to every signed-in visitor and
   * this step still completes, which is correct, because the deployment is
   * already committed and verified, and wrong to report as a verified URL.
   * Deploy has to say which of the two it established.
   */
  it("warns that the environment URL was never observed serving behind its gate", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentProtected = true;
      const events: DeployEvent[] = [];
      try {
        const outcome = await withFetchStub(
          // What a signed-out caller gets: the gate, never the dead app.
          () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            }),
          () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "production",
              mode: "apply",
              source: { kind: "already-pushed" },
            }, {
              onEvent(event) {
                events.push(event);
              },
            }),
        );

        assertEquals(outcome.kind, "deployed");
        const warning = events.find((event) =>
          event.kind === "warning" && event.code === "environment-url-unverified"
        );
        assertEquals(
          warning?.kind === "warning" ? warning.code : "no warning emitted",
          "environment-url-unverified",
        );
        assertStringIncludes(
          warning?.kind === "warning" ? warning.message : "",
          "https://my-project.production.veryfront.com/",
        );
        // The remedy has to be one the caller can act on. This deploy resolved
        // VERYFRONT_API_TOKEN from the shell, which outranks the token store,
        // so "run veryfront login" alone would leave the next deploy gated the
        // same way.
        assertStringIncludes(
          warning?.kind === "warning" ? warning.message : "",
          "VERYFRONT_API_TOKEN is set in this shell",
        );
        assertEquals(
          outcome.kind === "deployed" ? outcome.result.urlVerification : undefined,
          "gated",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("verifies a protected environment with an environment access token exchanged for the API key", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentProtected = true;
      controlPlane.environmentAccessToken = EXCHANGED_SESSION_TOKEN;
      const events: DeployEvent[] = [];
      const cookies: Array<string | null> = [];
      try {
        const outcome = await withFetchStub(
          (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const cookie = request.headers.get("cookie");
            cookies.push(cookie);
            // The gate admits the minted token and the app answers behind it.
            if (cookie === `authToken=${EXCHANGED_SESSION_TOKEN}`) return new Response("ready");
            return new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            });
          },
          () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "production",
              mode: "apply",
              source: { kind: "already-pushed" },
            }, {
              onEvent(event) {
                events.push(event);
              },
            }),
        );

        assertEquals(outcome.kind, "deployed");
        // The exchange names the target, so the API can bind the token to it.
        assertEquals(controlPlane.environmentAccessTokenRequests, [
          { projectId: PROJECT_ID, environmentName: "production" },
        ]);
        assertEquals(cookies, [`authToken=${EXCHANGED_SESSION_TOKEN}`]);
        assertEquals(
          events.some((event) =>
            event.kind === "warning" && event.code === "environment-url-unverified"
          ),
          false,
        );
        assertEquals(
          outcome.kind === "deployed" ? outcome.result.urlVerification : undefined,
          "served",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    }, { VERYFRONT_API_TOKEN: API_KEY_TOKEN });
  });

  it("degrades to the gated outcome when the environment access token exchange fails", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentProtected = true;
      controlPlane.environmentAccessToken = null;
      const events: DeployEvent[] = [];
      const cookies: Array<string | null> = [];
      try {
        const outcome = await withFetchStub(
          (input, init) => {
            const request = input instanceof Request ? input : new Request(input, init);
            cookies.push(request.headers.get("cookie"));
            return new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            });
          },
          () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "production",
              mode: "apply",
              source: { kind: "already-pushed" },
            }, {
              onEvent(event) {
                events.push(event);
              },
            }),
        );

        assertEquals(outcome.kind, "deployed");
        // The raw API key must never reach the gate, exchange or no exchange.
        assertEquals(cookies, [null]);
        const warning = events.find((event) =>
          event.kind === "warning" && event.code === "environment-url-unverified"
        );
        const message = warning?.kind === "warning" ? warning.message : "";
        assertStringIncludes(
          message,
          "the Cloud API does not offer the environment access token exchange (HTTP 404)",
        );
        // Server-provided detail never reaches the operator-facing warning.
        assertEquals(message.includes("internal-host"), false);
        assertEquals(message.includes("server detail"), false);
        assertEquals(
          outcome.kind === "deployed" ? outcome.result.urlVerification : undefined,
          "gated",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("names a refused exchange by its class, not by the server's words", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentProtected = true;
      controlPlane.environmentAccessToken = null;
      controlPlane.environmentAccessTokenFailureStatus = 403;
      const events: DeployEvent[] = [];
      try {
        const outcome = await withFetchStub(
          () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            }),
          () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "production",
              mode: "apply",
              source: { kind: "already-pushed" },
            }, {
              onEvent(event) {
                events.push(event);
              },
            }),
        );

        assertEquals(outcome.kind, "deployed");
        const warning = events.find((event) =>
          event.kind === "warning" && event.code === "environment-url-unverified"
        );
        const message = warning?.kind === "warning" ? warning.message : "";
        assertStringIncludes(
          message,
          "the Cloud API refused to issue an environment access token for this API key (HTTP 403)",
        );
        assertEquals(message.includes("internal-host"), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    }, { VERYFRONT_API_TOKEN: API_KEY_TOKEN });
  });

  it("records the environment URL as served when the probe sees the app answer", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      const events: DeployEvent[] = [];
      try {
        const outcome = await executeApply(projectDir, controlPlane, {
          onEvent(event) {
            events.push(event);
          },
        });

        assertEquals(outcome.kind, "deployed");
        assertEquals(
          events.some((event) =>
            event.kind === "warning" && event.code === "environment-url-unverified"
          ),
          false,
        );
        assertEquals(
          outcome.kind === "deployed" ? outcome.result.urlVerification : undefined,
          "served",
        );
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

describe("pushed source provenance", () => {
  it("accepts dirty metadata when the pushed source digest targets the current commit", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
      const commitSha = await commitProject(projectDir);
      const sourceDigest = await computeSourceDigest([
        { path: "app.ts", content: "export const value = 1;\n" },
      ]);
      await writePushReceipt(projectDir, {
        controlPlane: "https://control.example.test/api",
        projectId: "550e8400-e29b-41d4-a716-446655440000",
        projectSlug: "my-project",
        branch: "main",
        commitSha,
        sourceDigest,
        clean: false,
        pushedAt: "2026-07-10T09:20:00.000Z",
      });
      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 2;\n");

      const result = await resolvePushedSource({
        projectDir,
        controlPlane: "https://control.example.test/api",
        projectId: "550e8400-e29b-41d4-a716-446655440000",
        projectSlug: "my-project",
        branch: "main",
      });

      assertEquals(result, { commitSha, sourceDigest });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("environment URL readiness", () => {
  // Must be JWT-shaped, or the authenticated path stops being exercised.
  const sessionToken = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1XzEifQ.test-signature";
  const apiKeyToken = "vf_d157f0000000000000000000000000000000000";

  const hostedTarget = {
    projectSlug: "my-project",
    environmentName: "production",
    url: "https://my-project.production.veryfront.com",
    protected: false,
    apiToken: sessionToken,
  };

  it("retries a transient 404 before accepting the environment URL", async () => {
    const statuses = [404, 200];
    let requests = 0;

    await withMockFetch(
      () => Promise.resolve(new Response("ready", { status: statuses[requests++] })),
      () =>
        waitForEnvironmentReady(hostedTarget, {
          pollIntervalMs: 1,
          timeoutMs: 1_000,
        }),
    );

    assertEquals(requests, 2);
  });

  it("probes the discovered page route instead of requiring the root route", async () => {
    let requestedUrl = "";

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestedUrl = request.url;
        return Promise.resolve(new Response("ready"));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          route: "/dashboard",
        }),
    );

    assertEquals(
      requestedUrl,
      "https://my-project.production.veryfront.com/dashboard",
    );
  });

  it("does not require a browser URL for projects without page routes", async () => {
    let requests = 0;

    await withMockFetch(
      () => {
        requests++;
        return Promise.resolve(new Response("not found", { status: 404 }));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          route: null,
        }),
    );

    assertEquals(requests, 0);
  });

  it("authenticates a protected Veryfront environment with the stored token", async () => {
    let cookie: string | null = null;

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        cookie = request.headers.get("cookie");
        return Promise.resolve(new Response("ready"));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
        }),
    );

    assertEquals(cookie, `authToken=${sessionToken}`);
  });

  it("sends an exchanged session token instead of the API key it was exchanged for", async () => {
    let cookie: string | null = null;

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        cookie = request.headers.get("cookie");
        return Promise.resolve(new Response("ready"));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: apiKeyToken,
          environmentAccessToken: sessionToken,
        }),
    );

    assertEquals(cookie, `authToken=${sessionToken}`);
  });

  it("reports a refused exchanged token as gated instead of failing the committed deploy", async () => {
    const readiness = await withMockFetch(
      () => Promise.resolve(new Response("forbidden", { status: 403 })),
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: apiKeyToken,
          environmentAccessToken: sessionToken,
        }, { pollIntervalMs: 1, timeoutMs: 1_000 }),
    );

    assertEquals(readiness, {
      kind: "gated",
      url: "https://my-project.production.veryfront.com/",
      status: 403,
    });
  });

  it("does not send an API key to the protected environment gate", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({ url: request.url, cookie: request.headers.get("cookie") });
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        );
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: apiKeyToken,
        }),
    );

    assertEquals(requests, [{
      url: "https://my-project.production.veryfront.com/",
      cookie: null,
    }]);
  });

  it("does not send an opaque credential that merely contains dots", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({ url: request.url, cookie: request.headers.get("cookie") });
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        );
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: "opaque.segment.value",
        }),
    );

    assertEquals(requests, [{
      url: "https://my-project.production.veryfront.com/",
      cookie: null,
    }]);
  });

  it("does not send a JWT-shaped credential whose payload carries no userId", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];
    // {"alg":"HS256"} . {"sub":"u_1"} . sig — decodes, but carries no userId.
    const withoutUserId = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1XzEifQ.test-signature";

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({ url: request.url, cookie: request.headers.get("cookie") });
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        );
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: withoutUserId,
        }),
    );

    assertEquals(requests, [{
      url: "https://my-project.production.veryfront.com/",
      cookie: null,
    }]);
  });

  it("treats a sign-in redirect as ready when the credential is an API key", async () => {
    await withMockFetch(
      () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        ),
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: apiKeyToken,
        }),
    );
  });

  it("reports a gate challenge as gated, not as the app serving", async () => {
    const readiness = await withMockFetch(
      () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        ),
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          protected: true,
          apiToken: apiKeyToken,
        }),
    );

    assertEquals(readiness, {
      kind: "gated",
      url: "https://my-project.production.veryfront.com/",
      status: 302,
    });
  });

  it("reports a served response when the probe reaches the app itself", async () => {
    const readiness = await withMockFetch(
      () => Promise.resolve(new Response("ready")),
      () => waitForEnvironmentReady(hostedTarget),
    );

    assertEquals(readiness, { kind: "served" });
  });

  it("reports an unprobed environment when there is no page route to check", async () => {
    const readiness = await withMockFetch(
      () => Promise.reject(new Error("readiness must not fetch without a route")),
      () => waitForEnvironmentReady({ ...hostedTarget, route: null }),
    );

    assertEquals(readiness, { kind: "unprobed" });
  });

  it("classifies a rejected session credential as a deployment error", async () => {
    const error = await assertRejects(() =>
      withMockFetch(
        () =>
          Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            }),
          ),
        () =>
          waitForEnvironmentReady({
            ...hostedTarget,
            protected: true,
          }),
      )
    );

    // A bare Error here surfaces to the operator as `unknown-error`.
    assertStrictEquals(error instanceof VeryfrontError, true);
    assertEquals((error as VeryfrontError).slug, DEPLOYMENT_ERROR.slug);
  });

  it("upgrades authenticated Veryfront environment probes to HTTPS", async () => {
    let requestedUrl = "";
    let cookie: string | null = null;

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestedUrl = request.url;
        cookie = request.headers.get("cookie");
        return Promise.resolve(new Response("ready"));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          url: "http://my-project.production.veryfront.com",
          protected: true,
        }),
    );

    assertEquals(requestedUrl, "https://my-project.production.veryfront.com/");
    assertEquals(cookie, `authToken=${sessionToken}`);
  });

  it("does not send credentials to a mismatched Veryfront project host", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({
          url: request.url,
          cookie: request.headers.get("cookie"),
        });
        return Promise.resolve(
          request.url === "https://other-project.production.veryfront.com/"
            ? new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            })
            : new Response("ready"),
        );
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          url: "https://other-project.production.veryfront.com",
          protected: true,
        }),
    );

    assertEquals(requests, [
      {
        url: "https://other-project.production.veryfront.com/",
        cookie: null,
      },
      {
        url: "https://my-project.production.veryfront.com/",
        cookie: `authToken=${sessionToken}`,
      },
    ]);
  });

  it("authenticates a protected veryfront.org environment directly", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({
          url: request.url,
          cookie: request.headers.get("cookie"),
        });
        return Promise.resolve(new Response("ready"));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          url: "https://my-project.production.veryfront.org",
          protected: true,
        }),
    );

    assertEquals(requests, [{
      url: "https://my-project.production.veryfront.org/",
      cookie: `authToken=${sessionToken}`,
    }]);
  });

  it("checks a protected custom domain without sending it the token", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push({
          url: request.url,
          cookie: request.headers.get("cookie"),
        });
        return Promise.resolve(
          request.url === "https://app.example.com/"
            ? new Response(null, {
              status: 302,
              headers: { location: "https://veryfront.com/sign-in" },
            })
            : new Response("ready"),
        );
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          url: "https://app.example.com",
          protected: true,
        }),
    );

    assertEquals(requests, [
      { url: "https://app.example.com/", cookie: null },
      {
        url: "https://my-project.production.veryfront.com/",
        cookie: `authToken=${sessionToken}`,
      },
    ]);
  });

  it("checks a public custom domain directly without credentials", async () => {
    let requestedUrl = "";
    let cookie: string | null = null;

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestedUrl = request.url;
        cookie = request.headers.get("cookie");
        return Promise.resolve(new Response("ready"));
      },
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          url: "https://app.example.com",
        }),
    );

    assertEquals(requestedUrl, "https://app.example.com/");
    assertEquals(cookie, null);
  });

  it("reports malformed environment URLs without polling", async () => {
    await assertRejects(
      () =>
        waitForEnvironmentReady({
          ...hostedTarget,
          url: "https://[invalid",
        }),
      Error,
      'Environment URL "https://[invalid" is invalid',
    );
  });

  it("does not crash on a malformed redirect location", async () => {
    await withMockFetch(
      () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://[" },
          }),
        ),
      () => waitForEnvironmentReady(hostedTarget),
    );
  });

  it("reports an actionable authentication error for sign-in redirects", async () => {
    await withMockFetch(
      () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        ),
      () =>
        assertRejects(
          () =>
            waitForEnvironmentReady({
              ...hostedTarget,
              protected: true,
            }),
          Error,
          "veryfront login",
        ),
    );
  });

  it("names the status when a challenge was not a sign-in redirect", async () => {
    const message = await withMockFetch(
      () => Promise.resolve(new Response(null, { status: 403 })),
      () =>
        expectErrorMessage(() => waitForEnvironmentReady({ ...hostedTarget, protected: false })),
    );

    assertMatch(message ?? "", /returned HTTP 403/);
  });

  it("reports the URL and last status when readiness times out", async () => {
    const error = await withMockFetch(
      () => Promise.resolve(new Response("not ready", { status: 404 })),
      () =>
        expectErrorMessage(
          () =>
            waitForEnvironmentReady(hostedTarget, {
              pollIntervalMs: 1,
              timeoutMs: 2,
            }),
        ),
    );

    assertEquals(
      error,
      "Environment URL https://my-project.production.veryfront.com did not become ready within 1s (last response: HTTP 404). Check the deployment and run deploy again.",
    );
  });
});

describe("project ownership", () => {
  it("accepts a project-scoped response without redundant ownership metadata", () => {
    assertProjectOwnership("Environment", { id: "env-1" }, "project-1");
  });

  it("rejects ownership metadata for another project", async () => {
    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          assertProjectOwnership(
            "Environment",
            { id: "env-1", projectId: "project-2" },
            "project-1",
          )
        ),
      Error,
      "does not belong to resolved project project-1",
    );
  });
});

describe("release source verification", () => {
  const canonicalRelease = {
    id: "release-1",
    name: "github-main-90719c01",
    version: "0.0.41",
    projectId: "project-1",
  };
  const commitSha = "90719c01c1dded95a6b6df46b0fb17ea37d3ace8";

  it("waits for a well-formed release source digest to match the pushed commit", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit B\n" },
    ]);
    let sourceReads = 0;
    const controlPlane = helperControlPlane({
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {
        sourceReads++;
        yield { path: "app.ts", content: sourceReads === 1 ? "commit A\n" : "commit B\n" };
      },
    });

    const result = await verifyReleaseSource(controlPlane, "project-1", {
      projectId: "project-1",
      releaseId: "release-1",
      commitSha,
      sourceDigest: expectedDigest,
    }, { attempts: 2, delayMs: 0 });

    assertEquals(result.sourceDigest, expectedDigest, "digest converges on retry");
    assertEquals(sourceReads, 2, "source read once per attempt");
  });

  it("fails closed after exhausting well-formed release source digest mismatches", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit A\n" },
    ]);
    const staleDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit B\n" },
    ]);
    let sourceReads = 0;
    const controlPlane = helperControlPlane({
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {
        sourceReads++;
        yield { path: "app.ts", content: "commit B\n" };
      },
    });

    await assertRejects(
      () =>
        verifyReleaseSource(controlPlane, "project-1", {
          projectId: "project-1",
          releaseId: "release-1",
          commitSha,
          sourceDigest: expectedDigest,
        }, { attempts: 2, delayMs: 0 }),
      Error,
      `expected source digest ${expectedDigest}; last observed ${staleDigest}`,
    );
    assertEquals(sourceReads, 2, "stops at configured attempts");
  });

  it("caps release source verification at the fixed polling budget", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit A\n" },
    ]);
    let sourceReads = 0;
    const controlPlane = helperControlPlane({
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {
        sourceReads++;
        yield { path: "app.ts", content: "commit B\n" };
      },
    });

    await assertRejects(
      () =>
        verifyReleaseSource(controlPlane, "project-1", {
          projectId: "project-1",
          releaseId: "release-1",
          commitSha,
          sourceDigest: expectedDigest,
        }, { attempts: 21, delayMs: 0 }),
      Error,
      "does not match pushed commit",
    );
    assertEquals(sourceReads, 20, "attempts are capped at the fixed budget");
  });

  it("does not retry source API failures", async () => {
    const expectedDigest = await computeSourceDigest([]);
    let sourceReads = 0;
    const controlPlane = helperControlPlane({
      getRelease: () => Promise.resolve(canonicalRelease),
      // deno-lint-ignore require-yield
      listReleaseFiles: async function* () {
        sourceReads++;
        throw new Error("release source unavailable");
      },
    });

    await assertRejects(
      () =>
        verifyReleaseSource(controlPlane, "project-1", {
          projectId: "project-1",
          releaseId: "release-1",
          commitSha,
          sourceDigest: expectedDigest,
        }, { attempts: 20, delayMs: 0 }),
      Error,
      "release source unavailable",
    );
    assertEquals(sourceReads, 1, "API failures are not retried");
  });

  it("rejects invalid release metadata before reading source versions", async () => {
    const expectedDigest = await computeSourceDigest([]);

    for (
      const testCase of [
        {
          name: "release identity",
          release: { ...canonicalRelease, id: "other-release" },
          error: "expected release-1",
        },
        {
          name: "project ownership",
          release: { ...canonicalRelease, projectId: "other-project" },
          error: "does not belong to resolved project",
        },
        {
          name: "release name",
          release: { ...canonicalRelease, name: "other-release-name" },
          error: "no longer matches the created release name",
        },
        {
          name: "release version",
          release: { ...canonicalRelease, version: null },
          error: "has no version",
        },
      ]
    ) {
      let sourceReads = 0;
      const controlPlane = helperControlPlane({
        getRelease: () => Promise.resolve(testCase.release),
        // deno-lint-ignore require-yield
        listReleaseFiles: async function* () {
          sourceReads++;
        },
      });

      await assertRejects(
        () =>
          verifyReleaseSource(controlPlane, "project-1", {
            projectId: "project-1",
            releaseId: "release-1",
            releaseName: "github-main-90719c01",
            commitSha,
            sourceDigest: expectedDigest,
          }, { attempts: 20, delayMs: 0 }),
        Error,
        testCase.error,
        testCase.name,
      );
      assertEquals(sourceReads, 0, testCase.name);
    }
  });
});

describe("deployment verification", () => {
  const projectId = "550e8400-e29b-41d4-a716-446655440000";
  const environmentId = "660e8400-e29b-41d4-a716-446655440000";
  const releaseId = "770e8400-e29b-41d4-a716-446655440000";
  const deploymentId = "880e8400-e29b-41d4-a716-446655440000";
  const commitSha = "90719c01c1dded95a6b6df46b0fb17ea37d3ace8";
  const canonicalRelease = {
    id: releaseId,
    name: "github-main-90719c01",
    version: "0.0.41",
    projectId,
  };
  const canonicalDeployment = { id: deploymentId, releaseId, environmentId };

  function environmentPointingAt(deployment: { id: string; releaseId: string }) {
    return {
      id: environmentId,
      name: "production",
      protected: true,
      projectId,
      deployment: {
        id: deployment.id,
        release: { id: deployment.releaseId, name: "github-main-90719c01" },
      },
      domains: [],
    };
  }

  it("returns evidence only after the environment pointer advances", async () => {
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: "export const value = 1;\n" },
    ]);
    let environmentReads = 0;
    const controlPlane = helperControlPlane({
      getDeployment: () => Promise.resolve(canonicalDeployment),
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {
        yield { path: "app.ts", content: "export const value = 1;\n" };
      },
      getEnvironment: () => {
        environmentReads++;
        return Promise.resolve(
          environmentReads === 1
            ? environmentPointingAt({ id: "old-deployment", releaseId: "old-release" })
            : environmentPointingAt({ id: deploymentId, releaseId }),
        );
      },
    });

    const result = await verifyDeployment(controlPlane, "my-project", {
      projectId,
      projectSlug: "my-project",
      environmentId,
      environmentName: "production",
      releaseId,
      deploymentId,
      commitSha,
      sourceDigest,
    }, { attempts: 2, delayMs: 0 });

    assertEquals(result, {
      projectId,
      projectSlug: "my-project",
      environmentId,
      environmentName: "production",
      releaseId,
      releaseVersion: "0.0.41",
      deploymentId,
      commitSha,
      sourceDigest,
    });
    assertEquals(environmentReads, 2, "verification waits for the pointer to advance");
  });

  it("fails when production never advances to the created deployment", async () => {
    const sourceDigest = await computeSourceDigest([]);
    const controlPlane = helperControlPlane({
      getDeployment: () => Promise.resolve(canonicalDeployment),
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {},
      getEnvironment: () =>
        Promise.resolve(
          environmentPointingAt({ id: "old-deployment", releaseId: "old-release" }),
        ),
    });

    await assertRejects(
      () =>
        verifyDeployment(controlPlane, "my-project", {
          projectId,
          projectSlug: "my-project",
          environmentId,
          environmentName: "production",
          releaseId,
          deploymentId,
          commitSha,
          sourceDigest,
        }, { attempts: 2, delayMs: 0 }),
      Error,
      "still points to deployment old-deployment",
    );
  });

  it("fails when the release snapshot differs from the pushed commit", async () => {
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit A\n" },
    ]);
    const controlPlane = helperControlPlane({
      getDeployment: () => Promise.resolve(canonicalDeployment),
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {
        yield { path: "app.ts", content: "commit B\n" };
      },
      getEnvironment: () => Promise.resolve(environmentPointingAt({ id: deploymentId, releaseId })),
    });

    await assertRejects(
      () =>
        verifyDeployment(controlPlane, "my-project", {
          projectId,
          projectSlug: "my-project",
          environmentId,
          environmentName: "production",
          releaseId,
          deploymentId,
          commitSha,
          sourceDigest,
        }, {
          attempts: 1,
          delayMs: 0,
          releaseSource: { attempts: 1, delayMs: 0 },
        }),
      Error,
      "does not match pushed commit",
    );
  });

  it("keeps release-source convergence independent from environment convergence", async () => {
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit B\n" },
    ]);
    let sourceReads = 0;
    const controlPlane = helperControlPlane({
      getDeployment: () => Promise.resolve(canonicalDeployment),
      getRelease: () => Promise.resolve(canonicalRelease),
      listReleaseFiles: async function* () {
        sourceReads++;
        yield { path: "app.ts", content: sourceReads === 1 ? "commit A\n" : "commit B\n" };
      },
      getEnvironment: () => Promise.resolve(environmentPointingAt({ id: deploymentId, releaseId })),
    });

    const result = await verifyDeployment(controlPlane, "my-project", {
      projectId,
      projectSlug: "my-project",
      environmentId,
      environmentName: "production",
      releaseId,
      deploymentId,
      commitSha,
      sourceDigest,
    }, {
      attempts: 1,
      delayMs: 0,
      releaseSource: { attempts: 2, delayMs: 0 },
    });

    assertEquals(result.sourceDigest, sourceDigest, "source retries independently");
    assertEquals(sourceReads, 2, "source read retried while environment already converged");
  });
});

describe("release asset manifest", () => {
  function manifestControlPlane(response: DeployReleaseAssetManifestBody): DeployControlPlane {
    return helperControlPlane({
      getReleaseAssetManifest: () => Promise.resolve(response),
    });
  }

  const polling = {
    expectedRoutes: ["/"],
    pollIntervalMs: 100,
    timeoutMs: 100,
  };

  it("parses a valid ready response for the requested release", async () => {
    const result = await waitForReleaseAssetManifest(
      manifestControlPlane(readyManifest()),
      PROJECT_SLUG,
      "release-1",
      polling,
    );

    assertEquals(result.state, "ready");
    assertEquals(result.manifest.releaseId, "release-1");
  });

  it("continues polling through a missing manifest and building state", async () => {
    using time = new FakeTime();
    const responses = [null, { state: "building" }, readyManifest()];
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        const response = responses[Math.min(reads, responses.length - 1)]!;
        reads++;
        return Promise.resolve(response);
      },
    });

    const pending = waitForReleaseAssetManifest(
      controlPlane,
      PROJECT_SLUG,
      "release-1",
      { ...polling, timeoutMs: 500 },
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);

    const result = await pending;
    assertEquals(result.state, "ready");
    assertEquals(reads, 3);
  });

  it("reports the last state after the polling deadline", async () => {
    using time = new FakeTime();
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        reads++;
        return Promise.resolve({ state: "building" });
      },
    });

    const rejection = assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          ...polling,
          timeoutMs: 250,
        }),
      Error,
      "last state: building",
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);
    await time.tickAsync(50);

    await rejection;
    assertEquals(reads, 3);
  });

  it("names the refused dispatch when no manifest row is ever created", async () => {
    // A manifest row appears the moment the project runtime begins the build.
    // If none ever appears, the control plane's signed `task:release-asset-build`
    // dispatch never reached the builder, which is a different failure from a
    // build that is merely slow. Saying only `last state: missing` sends the
    // operator to inspect a build that never started.
    using time = new FakeTime();
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        reads++;
        return Promise.resolve(null);
      },
    });

    const rejection = assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          ...polling,
          timeoutMs: 250,
        }),
      Error,
      "never reached the builder",
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);
    await time.tickAsync(50);

    const error = await rejection as Error;
    assertStringIncludes(error.message, "last state: missing");
    assertStringIncludes(error.message, "/api/control-plane/runs/");
    assertStringIncludes(error.message, "middleware.ts");
    assertEquals(reads, 3);
  });

  it("does not name the refused dispatch once any manifest read has failed", async () => {
    // A read that failed leaves the build state unknown for that window: the
    // manifest may well have existed and simply not been readable. Later reads
    // returning no row cannot restore the stronger claim, so the evidence that
    // rules it out has to be monotonic rather than only the last failure.
    using time = new FakeTime();
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        reads++;
        if (reads === 1) {
          return Promise.reject(Object.assign(new Error("service unavailable"), { status: 503 }));
        }
        return Promise.resolve(null);
      },
    });

    const rejection = assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          ...polling,
          timeoutMs: 250,
        }),
      Error,
      "Check the release asset build and run deploy again.",
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);
    await time.tickAsync(50);

    const error = await rejection as Error;
    assertStringIncludes(error.message, "last state: missing");
    assertEquals(error.message.includes("never reached the builder"), false);
    // The last read succeeded, so the last-failure text is correctly absent
    // even though the run as a whole saw a failure.
    assertEquals(error.message.includes("last control-plane failure"), false);
    assertEquals(reads, 3);
  });

  it("reports missing when a manifest disappears after building", async () => {
    using time = new FakeTime();
    const responses = [{ state: "building" }, null];
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        const response = responses[Math.min(reads, responses.length - 1)]!;
        reads++;
        return Promise.resolve(response);
      },
    });

    const rejection = assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          ...polling,
          timeoutMs: 250,
        }),
      Error,
      "last state: missing",
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);
    await time.tickAsync(50);

    await rejection;
    assertEquals(reads, 3);
  });

  it("recovers from transient control-plane failures within the polling deadline", async () => {
    using time = new FakeTime();
    const unavailable = Object.assign(new Error("service unavailable"), { status: 503 });
    const connectionReset = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const responses: Array<DeployReleaseAssetManifestBody | Error> = [
      unavailable,
      connectionReset,
      { state: "building" },
      readyManifest(),
    ];
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        const response = responses[Math.min(reads, responses.length - 1)]!;
        reads++;
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      },
    });

    const pending = waitForReleaseAssetManifest(
      controlPlane,
      PROJECT_SLUG,
      "release-1",
      { ...polling, timeoutMs: 500 },
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);
    await time.tickAsync(100);

    const result = await pending;
    assertEquals(result.state, "ready");
    assertEquals(reads, 4);
  });

  it("bounds transient control-plane retries by the original polling deadline", async () => {
    using time = new FakeTime();
    let reads = 0;
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => {
        reads++;
        return Promise.reject(Object.assign(new Error("service unavailable"), { status: 503 }));
      },
    });

    const rejection = assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          ...polling,
          timeoutMs: 250,
        }),
      Error,
      "last control-plane failure: HTTP 503",
    );
    await time.tickAsync(0);
    await time.tickAsync(100);
    await time.tickAsync(100);
    await time.tickAsync(50);

    await rejection;
    assertEquals(reads, 3);
  });

  it("enforces the polling deadline through the production HTTP adapter", async () => {
    using time = new FakeTime();
    let reads = 0;
    const signals: AbortSignal[] = [];

    await withMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        reads++;
        const signal = observeFetchRequestInit(init).signal;
        if (!signal) return Promise.reject(new Error("asset manifest read has no deadline signal"));
        signals.push(signal);

        if (reads === 1) {
          return Promise.resolve(
            new Response("{}", { status: 503, statusText: "Service Unavailable" }),
          );
        }

        return new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }) as typeof fetch,
      async () => {
        const config = {
          apiUrl: "https://control.example.test/api",
          apiToken: "<TOKEN>",
          projectSlug: PROJECT_SLUG,
        };
        const controlPlane = createHttpDeployControlPlane(config, createApiClient(config));
        const rejection = assertRejects(
          () =>
            waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
              ...polling,
              timeoutMs: 250,
            }),
          Error,
          "last control-plane failure: HTTP 503",
        );

        await time.tickAsync(0);
        assertEquals(reads, 1);
        await time.tickAsync(100);
        assertEquals(reads, 2);
        await time.tickAsync(150);

        await rejection;
        assertEquals(reads, 2);
        assertEquals(signals.length, 2);
        assertEquals(signals[0]?.aborted, false);
        assertEquals(signals[1]?.aborted, true);
      },
    );
  });

  it("does not retry authentication, validation, or cancellation failures", async () => {
    for (
      const error of [
        Object.assign(new Error("unauthorized"), { status: 401 }),
        Object.assign(new Error("invalid request"), { status: 422 }),
        new DOMException("cancelled", "AbortError"),
      ]
    ) {
      let reads = 0;
      const controlPlane = helperControlPlane({
        getReleaseAssetManifest: () => {
          reads++;
          return Promise.reject(error);
        },
      });

      await assertRejects(
        () => waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", polling),
        error.constructor as ErrorConstructor,
        error.message,
      );
      assertEquals(reads, 1, `${error.name} must fail without another polling attempt`);
    }
  });

  it("rejects legacy ready manifests", async () => {
    const current = readyManifest();
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          manifestControlPlane({
            ...current,
            manifest: { ...current.manifest!, schemaVersion: 1 },
          }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      // A legacy manifest is a framework version skew, so the message must say so:
      // "rebuild the assets" would rebuild against the same mismatched builder.
      "declare manifest schema version 1, but this framework reads version 2",
    );
  });

  it("rejects ready manifests for another release", async () => {
    const current = readyManifest();
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          manifestControlPlane({
            ...current,
            manifest: { ...current.manifest!, releaseId: "release-other" },
          }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "identifies a different release than the one requested",
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
          manifestControlPlane(hostileResponse),
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
          manifestControlPlane({ state: "q".repeat(65) }),
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
          manifestControlPlane({ state: "partial" }),
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
          manifestControlPlane({ state: "superseded" }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "Release assets for release-1 were superseded",
    );
  });

  it("fails closed for unsupported manifest states", async () => {
    await assertRejects(
      () =>
        waitForReleaseAssetManifest(
          manifestControlPlane({ state: "unexpected" }),
          PROJECT_SLUG,
          "release-1",
          polling,
        ),
      Error,
      "unsupported state response: unexpected",
    );
  });

  it("rejects ready empty manifests before deployment", async () => {
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () => Promise.resolve(readyManifest({})),
    });

    await assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          expectedRoutes: ["/", "/about"],
          pollIntervalMs: 100,
          timeoutMs: 100,
        }),
      Error,
      "Missing routes: /, /about",
    );
  });

  it("rejects ready manifests with empty route module coverage", async () => {
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () =>
        Promise.resolve(readyManifest({ "/": { modules: [], css: [] } })),
    });

    await assertRejects(
      () =>
        waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
          expectedRoutes: ["/"],
          pollIntervalMs: 100,
          timeoutMs: 100,
        }),
      Error,
      "Missing routes: /",
    );
  });

  it("accepts empty manifests when no page routes are expected", async () => {
    const base = readyManifest({});
    const controlPlane = helperControlPlane({
      getReleaseAssetManifest: () =>
        Promise.resolve({ ...base, manifest: { ...base.manifest!, modules: {} } }),
    });

    const result = await waitForReleaseAssetManifest(controlPlane, PROJECT_SLUG, "release-1", {
      expectedRoutes: [],
      pollIntervalMs: 100,
      timeoutMs: 100,
    });

    assertEquals(result.state, "ready", "module-less apps deploy without page routes");
  });
});

describe("deployment routing convergence", () => {
  it("does not warn when routing convergence is fully acknowledged", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.deploymentRoutingConvergence = {
        status: "converged",
        acknowledged: 2,
        recipients: 2,
      };
      const warnings: string[] = [];
      try {
        const outcome = await executeApply(projectDir, controlPlane, {
          onEvent(event) {
            if (event.kind === "warning") warnings.push(event.code);
          },
        });

        assertEquals(outcome.kind, "deployed");
        assertEquals(warnings, [], "acknowledged convergence must not warn");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("keeps compatibility with API versions that omit routing convergence", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.deploymentRoutingConvergence = undefined;
      const warnings: string[] = [];
      try {
        const outcome = await executeApply(projectDir, controlPlane, {
          onEvent(event) {
            if (event.kind === "warning") warnings.push(event.code);
          },
        });

        assertEquals(outcome.kind, "deployed");
        assertEquals(warnings, [], "missing convergence data must not warn");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});

describe("unroutable hosted environment names", () => {
  /**
   * Live infrastructure only routes `{slug}.{preview|staging|production}.veryfront.com`.
   * Any other label either has no wildcard certificate at all (TLS handshake failure)
   * or resolves to a proxy that answers
   * `404 {"error":"No project configured for domain: ..."}` — both of which the
   * readiness poller treats as transient and retries until the timeout expires.
   */
  function hostedNotFound() {
    return new Response(
      JSON.stringify({ error: "No project configured for domain", status: 404 }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  /** Matches on the parsed host, so a control-plane URL can never be mistaken for one. */
  function isHostedEnvironmentRequest(input: string | URL | Request): boolean {
    const url = input instanceof Request ? input.url : String(input);
    try {
      return new URL(url).hostname.endsWith(".veryfront.com");
    } catch {
      return false;
    }
  }

  it("rejects a user-created environment name before creating a release", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentDomains = [];
      try {
        const error = await expectDeployError(() =>
          withFetchStub(
            (input) => isHostedEnvironmentRequest(input) ? hostedNotFound() : new Response("ready"),
            () =>
              createDeployment(controlPlane).execute({
                projectDir,
                environment: "development",
                mode: "apply",
                source: { kind: "already-pushed" },
              }),
          )
        );

        const message = (error as Error).message;
        assertStringIncludes(message, "development");
        assertStringIncludes(message, "preview");
        assertStringIncludes(message, "staging");
        assertStringIncludes(message, "production");
        assertEquals(
          controlPlane.createdReleases,
          [],
          "an unroutable environment must be rejected before any release is created",
        );
        assertEquals(
          controlPlane.createdDeployments,
          [],
          "an unroutable environment must be rejected before any deployment is created",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("does not spend the readiness timeout on a guaranteed failure", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentDomains = [];
      let probes = 0;
      try {
        await expectDeployError(() =>
          withFetchStub(
            (input) => {
              if (isHostedEnvironmentRequest(input)) {
                probes++;
                return hostedNotFound();
              }
              return new Response("ready");
            },
            () =>
              createDeployment(controlPlane).execute({
                projectDir,
                environment: "qa",
                mode: "apply",
                source: { kind: "already-pushed" },
              }),
          )
        );

        assertEquals(probes, 0, "no readiness probe may be sent to an unroutable host");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("omits the canonical companion probe for a protected custom-domain environment", async () => {
    const probed: string[] = [];

    await withMockFetch(
      (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        probed.push(request.url);
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://veryfront.com/sign-in" },
          }),
        );
      },
      () =>
        waitForEnvironmentReady({
          projectSlug: "my-project",
          environmentName: "development",
          url: "https://dev.example.com",
          protected: true,
          apiToken: "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1XzEifQ.test-signature",
        }, { pollIntervalMs: 1, timeoutMs: 1_000 }),
    );

    assertEquals(
      probed,
      ["https://dev.example.com/"],
      "the custom domain answered; no unroutable canonical host may be probed",
    );
  });

  /**
   * An API-only, agent-only or otherwise page-less project. `readinessRoute` is
   * null for it, so `buildEnvironmentReadinessProbes` yields nothing and the
   * deploy never asks the platform for a hosted address — which is why the name
   * check must not apply to it.
   */
  const SERVER_ONLY_CONTENT = "export const handler = () => new Response('ok');\n";

  async function createPushedPagelessProject(): Promise<{
    projectDir: string;
    files: DeployReleaseFile[];
  }> {
    const projectDir = await Deno.makeTempDir();
    await Deno.mkdir(`${projectDir}/server`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, projectConfigText());
    await Deno.writeTextFile(`${projectDir}/server/handler.ts`, SERVER_ONLY_CONTENT);
    const commitSha = await commitProject(projectDir);
    const files: DeployReleaseFile[] = [
      { path: "server/handler.ts", content: SERVER_ONLY_CONTENT },
      { path: "veryfront.json", content: projectConfigText() },
    ];
    await writePushReceipt(projectDir, {
      controlPlane: CONTROL_PLANE,
      projectId: PROJECT_ID,
      projectSlug: PROJECT_SLUG,
      branch: "main",
      commitSha,
      sourceDigest: await computeSourceDigest(files),
      clean: true,
    });
    return { projectDir, files };
  }

  it("still deploys a page-less project to an environment with no hosted address", async () => {
    await withDeployEnv(async () => {
      const { projectDir, files } = await createPushedPagelessProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentDomains = [];
      controlPlane.releaseFiles = files;
      controlPlane.manifestResponses = [readyManifest({})];
      let probes = 0;
      try {
        const outcome = await withFetchStub(
          (input) => {
            if (isHostedEnvironmentRequest(input)) {
              probes++;
              return hostedNotFound();
            }
            return new Response("ready");
          },
          () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "development",
              mode: "apply",
              source: { kind: "already-pushed" },
            }),
        );

        assertEquals(
          outcome.kind,
          "deployed",
          "a deploy that never probes a hosted address does not depend on the environment name",
        );
        assertEquals(probes, 0, "a page-less deploy sends no readiness probe");
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  it("still deploys an unroutable environment name that has a custom domain", async () => {
    await withDeployEnv(async () => {
      const { projectDir } = await createPushedProject();
      const controlPlane = new InMemoryDeployControlPlane();
      controlPlane.environmentDomains = ["https://dev.example.com"];
      try {
        const outcome = await withFetchStub(
          () => new Response("ready"),
          () =>
            createDeployment(controlPlane).execute({
              projectDir,
              environment: "development",
              mode: "apply",
              source: { kind: "already-pushed" },
            }),
        );

        assertEquals(
          outcome.kind,
          "deployed",
          "a custom domain makes the environment name irrelevant to routing",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});
