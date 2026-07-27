import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for deploy command
 * @module cli/commands/deploy.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  resetInteractiveMode,
  setAutoConfirm,
  setNonInteractive,
} from "../../shared/interactive.ts";
import {
  assertProjectOwnership,
  createDeployment,
  createRelease,
  DeployArgsSchema,
  getDeployment,
  getDeploymentRoutingConvergenceWarning,
  getEnvironmentByName,
  getProject,
  getRelease,
  getReleaseSourceDigest,
  parseDeployArgs,
  requiresExplicitDeployConfirmation,
  verifyDeployment,
  verifyReleaseSource,
  waitForEnvironmentReady,
  waitForReleaseAssetManifest,
} from "./index.ts";
import type { ApiClient } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { computeSourceDigest } from "../../shared/deployment-provenance.ts";

type MockClientOverrides = Partial<{
  get: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
}>;

function createMockClient(overrides: MockClientOverrides = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = overrides.get ? await overrides.get(path, params) : { data: [] };
      return result as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = overrides.post ? await overrides.post(path, body) : {};
      return result as T;
    },
    put: <T>(): Promise<T> => Promise.resolve({} as T),
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: <T>(): Promise<T> => Promise.resolve({} as T),
  };
}

async function expectErrorMessage(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return;
  } catch (e) {
    return (e as Error).message;
  }
}

describe("environment URL readiness", () => {
  const hostedTarget = {
    projectSlug: "my-project",
    environmentName: "production",
    url: "https://my-project.production.veryfront.com",
    protected: false,
    apiToken: "test-token",
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

    assertEquals(cookie, "authToken=test-token");
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
    assertEquals(cookie, "authToken=test-token");
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
        cookie: "authToken=test-token",
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
      cookie: "authToken=test-token",
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
        cookie: "authToken=test-token",
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

describe("DeployArgsSchema", () => {
  it("should use default values", () => {
    const result = DeployArgsSchema.safeParse({});
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "main");
    assertEquals(result.data.env, "production");
  });

  it("should accept custom branch and env", () => {
    const result = DeployArgsSchema.safeParse({ branch: "develop", env: "staging" });
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "develop");
    assertEquals(result.data.env, "staging");
  });

  it("should accept optional release name", () => {
    const result = DeployArgsSchema.safeParse({ releaseName: "v1.0.0" });
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.releaseName, "v1.0.0");
  });
});

describe("deploy confirmation policy", () => {
  afterEach(() => resetInteractiveMode());

  it("requires --force or --yes in non-interactive environments", () => {
    setNonInteractive(true);
    assertEquals(requiresExplicitDeployConfirmation(false), true);
  });

  it("accepts explicit --yes auto-confirmation", () => {
    setAutoConfirm(true);
    assertEquals(requiresExplicitDeployConfirmation(false), false);
  });

  it("accepts the command-specific force flag", () => {
    setNonInteractive(true);
    assertEquals(requiresExplicitDeployConfirmation(true), false);
  });
});

describe("parseDeployArgs", () => {
  it("should use defaults when no args provided", () => {
    const args = { _: ["deploy"] } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "main");
    assertEquals(result.data.env, "production");
  });

  it("should parse --branch flag", () => {
    const args = { _: ["deploy"], branch: "develop" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "develop");
  });

  it("should parse -b flag as branch", () => {
    const args = { _: ["deploy"], b: "feature" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.branch, "feature");
  });

  it("should parse --env flag", () => {
    const args = { _: ["deploy"], env: "staging" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.env, "staging");
  });

  it("should parse --release-name flag", () => {
    const args = { _: ["deploy"], "release-name": "v2.0.0" } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.releaseName, "v2.0.0");
  });

  it("should parse --dry-run and --force flags", () => {
    const args = { _: ["deploy"], "dry-run": true, force: true } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.dryRun, true);
    assertEquals(result.data.force, true);
  });

  it("should parse -f flag as force", () => {
    const args = { _: ["deploy"], f: true } as ParsedArgs;
    const result = parseDeployArgs(args);
    assertEquals(result.success, true);
    if (!result.success) return;

    assertEquals(result.data.force, true);
  });
});

describe("getEnvironmentByName", () => {
  it("should find environment by name", async () => {
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          data: [
            { id: "env-1", name: "production", protected: true },
            { id: "env-2", name: "staging", protected: false },
          ],
        }),
    });

    const env = await getEnvironmentByName(mockClient, "my-project", "staging");
    assertEquals(env, { id: "env-2", name: "staging", protected: false });
  });

  it("should return null when environment not found", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve({ data: [] }),
    });

    const env = await getEnvironmentByName(mockClient, "my-project", "nonexistent");
    assertEquals(env, null);
  });
});

describe("createRelease", () => {
  it("should create release without options", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          id: "rel-123",
          version: "1.0.0",
          name: "auto-generated",
        });
      },
    });

    const release = await createRelease(mockClient, "my-project");
    assertEquals(capturedUrl, "/projects/my-project/releases");
    assertEquals(capturedBody, {});
    assertEquals(release.id, "rel-123");
  });

  it("should create release with custom name", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({ id: "rel-123" });
      },
    });

    await createRelease(mockClient, "my-project", { name: "v2.0.0" });
    assertEquals(capturedBody, { name: "v2.0.0" });
  });

  it("should create release from specific branch", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({ id: "rel-123" });
      },
    });

    await createRelease(mockClient, "my-project", { branch: "develop" });
    assertEquals(capturedBody, { branch_reference: "develop" });
  });

  it("should create release with name and branch", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({ id: "rel-123" });
      },
    });

    await createRelease(mockClient, "my-project", { name: "v2.0.0", branch: "develop" });
    assertEquals(capturedBody, { name: "v2.0.0", branch_reference: "develop" });
  });
});

describe("getEnvironmentByName - error handling", () => {
  it("should handle API error gracefully", async () => {
    const mockClient = createMockClient({
      get: () => Promise.reject(new Error("Network error")),
    });

    const message = await expectErrorMessage(() =>
      getEnvironmentByName(mockClient, "my-project", "production")
    );
    assertEquals(message, "Network error");
  });

  it("should handle paginated empty results", async () => {
    let callCount = 0;
    const mockClient = createMockClient({
      get: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ id: "env-1", name: "staging", protected: false }],
            page_info: { next: "cursor-2" },
          });
        }
        return Promise.resolve({ data: [], page_info: {} });
      },
    });

    const env = await getEnvironmentByName(mockClient, "my-project", "production");
    assertEquals(env, null);
    assertEquals(callCount, 2);
  });
});

describe("DeployArgsSchema - invalid inputs", () => {
  it("should reject empty branch name", () => {
    const result = DeployArgsSchema.safeParse({ branch: "" });
    assertEquals(result.success, false);
  });

  it("should reject empty env name", () => {
    const result = DeployArgsSchema.safeParse({ env: "" });
    assertEquals(result.success, false);
  });

  it("should reject empty release name", () => {
    const result = DeployArgsSchema.safeParse({ releaseName: "" });
    assertEquals(result.success, false);
  });
});

describe("createRelease - error handling", () => {
  it("should propagate API errors", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Release creation failed")),
    });

    const message = await expectErrorMessage(() => createRelease(mockClient, "my-project"));
    assertEquals(message, "Release creation failed");
  });

  it("should propagate errors for invalid branch", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Branch not found")),
    });

    const message = await expectErrorMessage(() =>
      createRelease(mockClient, "my-project", { branch: "nonexistent" })
    );
    assertEquals(message, "Branch not found");
  });
});

describe("createDeployment", () => {
  it("should create deployment with release and environment", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          id: "deploy-123",
          release_id: "rel-456",
          environment_id: "env-789",
          routing_convergence: { status: "converged", acknowledged: 2, recipients: 2 },
        });
      },
    });

    const deployment = await createDeployment(mockClient, "my-project", "rel-456", "env-789");
    assertEquals(capturedUrl, "/projects/my-project/deployments");
    assertEquals(capturedBody, { release_id: "rel-456", environment_id: "env-789" });
    assertEquals(deployment.id, "deploy-123");
    assertEquals(deployment.routing_convergence, {
      status: "converged",
      acknowledged: 2,
      recipients: 2,
    });
  });

  it("normalizes legacy nested release and environment references", async () => {
    const mockClient = createMockClient({
      post: () =>
        Promise.resolve({
          id: "deploy-123",
          release: { id: "rel-456" },
          environment: { id: "env-789" },
        }),
    });

    const deployment = await createDeployment(mockClient, "my-project", "rel-456", "env-789");
    assertEquals(deployment.release_id, "rel-456");
    assertEquals(deployment.environment_id, "env-789");
  });
});

describe("deployment routing convergence", () => {
  it("accepts an acknowledgement from every routing recipient", () => {
    const warning = getDeploymentRoutingConvergenceWarning({
      id: "deploy-123",
      release_id: "rel-456",
      environment_id: "env-789",
      routing_convergence: { status: "converged", acknowledged: 2, recipients: 2 },
    });

    assertEquals(warning, null);
  });

  it("distinguishes a committed deployment from unconfirmed data-plane convergence", () => {
    const deployment = {
      id: "deploy-123",
      release_id: "rel-456",
      environment_id: "env-789",
      routing_convergence: { status: "pending" as const },
    };

    assertEquals(
      getDeploymentRoutingConvergenceWarning(deployment),
      "Deployment deploy-123 committed, but data-plane routing convergence was not confirmed; bounded cache expiry remains the recovery path",
    );
  });

  it("keeps compatibility with API versions that omit routing convergence", () => {
    assertEquals(
      getDeploymentRoutingConvergenceWarning({
        id: "deploy-123",
        release_id: "rel-456",
        environment_id: "env-789",
      }),
      null,
    );
  });
});

describe("createDeployment - error handling", () => {
  it("should propagate API errors for protected environment", async () => {
    const mockClient = createMockClient({
      post: () =>
        Promise.reject(new Error("Cannot deploy to protected environment without approval")),
    });

    const message = await expectErrorMessage(() =>
      createDeployment(mockClient, "my-project", "rel-123", "protected-env")
    );
    assertEquals(message, "Cannot deploy to protected environment without approval");
  });

  it("should propagate API errors for invalid release", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Release not found")),
    });

    const message = await expectErrorMessage(() =>
      createDeployment(mockClient, "my-project", "invalid-rel", "env-123")
    );
    assertEquals(message, "Release not found");
  });

  it("should propagate API errors for invalid environment", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Environment not found")),
    });

    const message = await expectErrorMessage(() =>
      createDeployment(mockClient, "my-project", "rel-123", "invalid-env")
    );
    assertEquals(message, "Environment not found");
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
            { id: "env-1", project_id: "project-2" },
            "project-1",
          )
        ),
      Error,
      "does not belong to resolved project project-1",
    );
  });
});

describe("release source verification", () => {
  it("hashes the body from the API's legacy version data envelope", async () => {
    const body = "export const value = 1;\n";
    const expectedDigest = await computeSourceDigest([{ path: "app.ts", content: body }]);
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          data: [{
            path: "app.ts",
            data: JSON.stringify({ body, path: "app.ts", language: "typescript" }),
          }],
          page_info: {},
        }),
    });

    assertEquals(
      await getReleaseSourceDigest(mockClient, "project-1", "release-1"),
      expectedDigest,
    );
  });

  it("rejects a release whose source differs from the pushed commit", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit A\n" },
    ]);
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith("/versions")) {
          return Promise.resolve({
            data: [{
              path: "app.ts",
              data: JSON.stringify({ body: "commit B\n", path: "app.ts" }),
            }],
            page_info: {},
          });
        }
        return Promise.resolve({
          id: "release-1",
          name: "github-main-90719c01",
          version: "0.0.41",
          project_id: "project-1",
        });
      },
    });

    await assertRejects(
      () =>
        verifyReleaseSource(mockClient, "project-1", {
          projectId: "project-1",
          releaseId: "release-1",
          commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
          sourceDigest: expectedDigest,
        }, { attempts: 1, delayMs: 0 }),
      Error,
      "does not match pushed commit",
    );
  });

  it("waits for a well-formed release source digest to match the pushed commit", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit B\n" },
    ]);
    let sourceReads = 0;
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith("/versions")) {
          sourceReads++;
          return Promise.resolve({
            data: [{
              path: "app.ts",
              data: JSON.stringify({
                body: sourceReads === 1 ? "commit A\n" : "commit B\n",
                path: "app.ts",
              }),
            }],
            page_info: {},
          });
        }
        return Promise.resolve({
          id: "release-1",
          name: "github-main-90719c01",
          version: "0.0.41",
          project_id: "project-1",
        });
      },
    });

    const result = await verifyReleaseSource(mockClient, "project-1", {
      projectId: "project-1",
      releaseId: "release-1",
      commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
      sourceDigest: expectedDigest,
    }, { attempts: 2, delayMs: 0 });

    assertEquals(result.sourceDigest, expectedDigest);
    assertEquals(sourceReads, 2);
  });

  it("fails closed after exhausting well-formed release source digest mismatches", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit A\n" },
    ]);
    const staleDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit B\n" },
    ]);
    let sourceReads = 0;
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith("/versions")) {
          sourceReads++;
          return Promise.resolve({
            data: [{
              path: "app.ts",
              data: JSON.stringify({ body: "commit B\n", path: "app.ts" }),
            }],
            page_info: {},
          });
        }
        return Promise.resolve({
          id: "release-1",
          name: "github-main-90719c01",
          version: "0.0.41",
          project_id: "project-1",
        });
      },
    });

    await assertRejects(
      () =>
        verifyReleaseSource(mockClient, "project-1", {
          projectId: "project-1",
          releaseId: "release-1",
          commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
          sourceDigest: expectedDigest,
        }, { attempts: 2, delayMs: 0 }),
      Error,
      `expected source digest ${expectedDigest}; last observed ${staleDigest}`,
    );
    assertEquals(sourceReads, 2);
  });

  it("caps release source verification at the fixed polling budget", async () => {
    const expectedDigest = await computeSourceDigest([
      { path: "app.ts", content: "commit A\n" },
    ]);
    let sourceReads = 0;
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith("/versions")) {
          sourceReads++;
          return Promise.resolve({
            data: [{
              path: "app.ts",
              data: JSON.stringify({ body: "commit B\n", path: "app.ts" }),
            }],
            page_info: {},
          });
        }
        return Promise.resolve({
          id: "release-1",
          name: "github-main-90719c01",
          version: "0.0.41",
          project_id: "project-1",
        });
      },
    });

    await assertRejects(
      () =>
        verifyReleaseSource(mockClient, "project-1", {
          projectId: "project-1",
          releaseId: "release-1",
          commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
          sourceDigest: expectedDigest,
        }, { attempts: 21, delayMs: 0 }),
      Error,
      "does not match pushed commit",
    );
    assertEquals(sourceReads, 20);
  });

  it("does not retry malformed source data or API failures", async () => {
    const expectedDigest = await computeSourceDigest([]);

    for (
      const testCase of [
        {
          name: "malformed source data",
          error: "has invalid version data",
          versions: () =>
            Promise.resolve({
              data: [{ path: "app.ts", data: "not-json" }],
              page_info: {},
            }),
        },
        {
          name: "source API failure",
          error: "release source unavailable",
          versions: () => Promise.reject(new Error("release source unavailable")),
        },
      ]
    ) {
      let sourceReads = 0;
      const mockClient = createMockClient({
        get: (path) => {
          if (path.endsWith("/versions")) {
            sourceReads++;
            return testCase.versions();
          }
          return Promise.resolve({
            id: "release-1",
            name: "github-main-90719c01",
            version: "0.0.41",
            project_id: "project-1",
          });
        },
      });

      await assertRejects(
        () =>
          verifyReleaseSource(mockClient, "project-1", {
            projectId: "project-1",
            releaseId: "release-1",
            commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
            sourceDigest: expectedDigest,
          }, { attempts: 20, delayMs: 0 }),
        Error,
        testCase.error,
        testCase.name,
      );
      assertEquals(sourceReads, 1, testCase.name);
    }
  });

  it("rejects invalid release metadata before reading source versions", async () => {
    const expectedDigest = await computeSourceDigest([]);

    for (
      const testCase of [
        {
          name: "release identity",
          release: {
            id: "other-release",
            name: "github-main-90719c01",
            version: "0.0.41",
            project_id: "project-1",
          },
          error: "expected release-1",
        },
        {
          name: "project ownership",
          release: {
            id: "release-1",
            name: "github-main-90719c01",
            version: "0.0.41",
            project_id: "other-project",
          },
          error: "does not belong to resolved project",
        },
        {
          name: "release name",
          release: {
            id: "release-1",
            name: "other-release-name",
            version: "0.0.41",
            project_id: "project-1",
          },
          error: "no longer matches the created release name",
        },
        {
          name: "release version",
          release: {
            id: "release-1",
            name: "github-main-90719c01",
            project_id: "project-1",
          },
          error: "has no version",
        },
      ]
    ) {
      let sourceReads = 0;
      const mockClient = createMockClient({
        get: (path) => {
          if (path.endsWith("/versions")) {
            sourceReads++;
            return Promise.resolve({ data: [], page_info: {} });
          }
          return Promise.resolve(testCase.release);
        },
      });

      await assertRejects(
        () =>
          verifyReleaseSource(mockClient, "project-1", {
            projectId: "project-1",
            releaseId: "release-1",
            releaseName: "github-main-90719c01",
            commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
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

  it("loads canonical project, release, and deployment records", async () => {
    const requests: string[] = [];
    const mockClient = createMockClient({
      get: (path) => {
        requests.push(path);
        if (path === "/projects/my-project") {
          return Promise.resolve({ id: projectId, slug: "my-project" });
        }
        if (path.endsWith(`/releases/${releaseId}`)) {
          return Promise.resolve({
            id: releaseId,
            name: "github-main-90719c01",
            version: "0.0.41",
            project_id: projectId,
          });
        }
        return Promise.resolve({
          id: deploymentId,
          release_id: releaseId,
          environment_id: environmentId,
        });
      },
    });

    assertEquals(await getProject(mockClient, "my-project"), {
      id: projectId,
      slug: "my-project",
    });
    assertEquals((await getRelease(mockClient, "my-project", releaseId)).version, "0.0.41");
    assertEquals(
      (await getDeployment(mockClient, "my-project", deploymentId)).environment_id,
      environmentId,
    );
    assertEquals(requests, [
      "/projects/my-project",
      `/projects/my-project/releases/${releaseId}`,
      `/projects/my-project/deployments/${deploymentId}`,
    ]);
  });

  it("returns evidence only after the environment pointer advances", async () => {
    let environmentReads = 0;
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: "export const value = 1;\n" },
    ]);
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith(`/deployments/${deploymentId}`)) {
          return Promise.resolve({
            id: deploymentId,
            release_id: releaseId,
            environment_id: environmentId,
          });
        }
        if (path.endsWith(`/releases/${releaseId}`)) {
          return Promise.resolve({
            id: releaseId,
            name: "github-main-90719c01",
            version: "0.0.41",
          });
        }
        if (path.endsWith(`/releases/${releaseId}/versions`)) {
          return Promise.resolve({
            data: [{ path: "app.ts", content: "export const value = 1;\n" }],
            page_info: {},
          });
        }
        environmentReads++;
        return Promise.resolve({
          data: [{
            id: environmentId,
            name: "production",
            protected: true,
            deployment: environmentReads === 1
              ? {
                id: "old-deployment",
                release: { id: "old-release", name: "previous" },
              }
              : {
                id: deploymentId,
                release: { id: releaseId, name: "github-main-90719c01" },
              },
          }],
        });
      },
    });

    const result = await verifyDeployment(mockClient, "my-project", {
      projectId,
      projectSlug: "my-project",
      environmentId,
      environmentName: "production",
      releaseId,
      deploymentId,
      commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
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
      commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
      sourceDigest,
    });
    assertEquals(environmentReads, 2);
  });

  it("fails when production never advances to the created deployment", async () => {
    const sourceDigest = await computeSourceDigest([]);
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith(`/deployments/${deploymentId}`)) {
          return Promise.resolve({
            id: deploymentId,
            release_id: releaseId,
            environment_id: environmentId,
          });
        }
        if (path.endsWith(`/releases/${releaseId}`)) {
          return Promise.resolve({
            id: releaseId,
            name: "github-main-90719c01",
            version: "0.0.41",
            project_id: projectId,
          });
        }
        if (path.endsWith(`/releases/${releaseId}/versions`)) {
          return Promise.resolve({ data: [], page_info: {} });
        }
        return Promise.resolve({
          data: [{
            id: environmentId,
            name: "production",
            project_id: projectId,
            protected: true,
            deployment: {
              id: "old-deployment",
              release: { id: "old-release", name: "previous" },
            },
          }],
        });
      },
    });

    await assertRejects(
      () =>
        verifyDeployment(mockClient, "my-project", {
          projectId,
          projectSlug: "my-project",
          environmentId,
          environmentName: "production",
          releaseId,
          deploymentId,
          commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
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
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith(`/deployments/${deploymentId}`)) {
          return Promise.resolve({
            id: deploymentId,
            release: { id: releaseId },
            environment: { id: environmentId },
          });
        }
        if (path.endsWith(`/releases/${releaseId}`)) {
          return Promise.resolve({
            id: releaseId,
            name: "github-main-90719c01",
            version: "0.0.41",
            project: projectId,
          });
        }
        if (path.endsWith(`/releases/${releaseId}/versions`)) {
          return Promise.resolve({
            data: [{
              path: "app.ts",
              data: JSON.stringify({ body: "commit B\n", path: "app.ts" }),
            }],
            page_info: {},
          });
        }
        return Promise.resolve({ data: [] });
      },
    });

    await assertRejects(
      () =>
        verifyDeployment(mockClient, "my-project", {
          projectId,
          projectSlug: "my-project",
          environmentId,
          environmentName: "production",
          releaseId,
          deploymentId,
          commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
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
    const mockClient = createMockClient({
      get: (path) => {
        if (path.endsWith(`/deployments/${deploymentId}`)) {
          return Promise.resolve({
            id: deploymentId,
            release: { id: releaseId },
            environment: { id: environmentId },
          });
        }
        if (path.endsWith(`/releases/${releaseId}`)) {
          return Promise.resolve({
            id: releaseId,
            name: "github-main-90719c01",
            version: "0.0.41",
            project: projectId,
          });
        }
        if (path.endsWith(`/releases/${releaseId}/versions`)) {
          sourceReads++;
          return Promise.resolve({
            data: [{
              path: "app.ts",
              data: JSON.stringify({
                body: sourceReads === 1 ? "commit A\n" : "commit B\n",
                path: "app.ts",
              }),
            }],
            page_info: {},
          });
        }
        return Promise.resolve({
          data: [{
            id: environmentId,
            name: "production",
            project_id: projectId,
            protected: true,
            deployment: {
              id: deploymentId,
              release: { id: releaseId, name: "github-main-90719c01" },
            },
          }],
        });
      },
    });

    const result = await verifyDeployment(mockClient, "my-project", {
      projectId,
      projectSlug: "my-project",
      environmentId,
      environmentName: "production",
      releaseId,
      deploymentId,
      commitSha: "90719c01c1dded95a6b6df46b0fb17ea37d3ace8",
      sourceDigest,
    }, {
      attempts: 1,
      delayMs: 0,
      releaseSource: { attempts: 2, delayMs: 0 },
    });

    assertEquals(result.sourceDigest, sourceDigest);
    assertEquals(sourceReads, 2);
  });
});

describe("waitForReleaseAssetManifest", () => {
  function readyManifest(routes: Record<string, { modules: string[]; css: string[] }> = {
    "/": { modules: ["app/page.tsx"], css: [] },
  }) {
    return {
      state: "ready",
      manifest_version: 1,
      manifest: {
        schemaVersion: 1,
        projectId: "proj-1",
        releaseId: "rel-1",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "sha256:abc",
        createdAt: "2026-07-27T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {
          "app/page.tsx": {
            contentHash: "a".repeat(64),
            size: 1,
            contentType: "text/javascript",
          },
        },
        css: [],
        routes,
        dependencies: {},
        fallback: { mode: "jit", gaps: [] },
      },
    };
  }

  it("returns a ready manifest that covers expected routes", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve(readyManifest()),
    });

    const result = await waitForReleaseAssetManifest(mockClient, "my-project", "rel-1", {
      expectedRoutes: ["/"],
      pollIntervalMs: 100,
      timeoutMs: 100,
    });

    assertEquals(result.state, "ready");
  });

  it("rejects ready empty manifests before deployment", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve(readyManifest({})),
    });

    await assertRejects(
      () =>
        waitForReleaseAssetManifest(mockClient, "my-project", "rel-1", {
          expectedRoutes: ["/", "/about"],
          pollIntervalMs: 100,
          timeoutMs: 100,
        }),
      Error,
      "Missing routes: /, /about",
    );
  });

  it("rejects ready manifests with empty route module coverage", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve(readyManifest({ "/": { modules: [], css: [] } })),
    });

    await assertRejects(
      () =>
        waitForReleaseAssetManifest(mockClient, "my-project", "rel-1", {
          expectedRoutes: ["/"],
          pollIntervalMs: 100,
          timeoutMs: 100,
        }),
      Error,
      "Missing routes: /",
    );
  });

  it("accepts empty manifests when no page routes are expected", async () => {
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          ...readyManifest({}),
          manifest: {
            ...readyManifest({}).manifest,
            modules: {},
          },
        }),
    });

    const result = await waitForReleaseAssetManifest(mockClient, "my-project", "rel-1", {
      expectedRoutes: [],
      pollIntervalMs: 100,
      timeoutMs: 100,
    });

    assertEquals(result.state, "ready");
  });
});
