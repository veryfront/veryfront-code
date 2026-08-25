import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEPLOYMENT_ERROR,
  ENVIRONMENT_NOT_FOUND,
  RELEASE_MISSING_VERSION,
  SOURCE_DIGEST_MISMATCH,
  VeryfrontError,
} from "veryfront/errors";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { computeSourceDigest, writePushReceipt } from "../deployment-provenance.ts";
import type { DeployControlPlane } from "./control-plane.ts";
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
  const hostedTarget = {
    projectSlug: "my-project",
    environmentName: "production",
    url: "https://my-project.production.veryfront.com",
    protected: false,
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

  it("does not send the API token to a protected Veryfront environment", async () => {
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

    assertEquals(cookie, null);
  });

  it("upgrades protected Veryfront environment probes to HTTPS", async () => {
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
    assertEquals(cookie, null);
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
        cookie: null,
      },
    ]);
  });

  it("does not send the API token to a protected veryfront.org environment", async () => {
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
      cookie: null,
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
        cookie: null,
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

  it("accepts the sign-in challenge for a protected environment", async () => {
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
        }),
    );
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
