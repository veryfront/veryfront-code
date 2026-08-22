import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ApiClient, ResolvedConfig } from "#cli/shared/config";
import { createHttpDeployControlPlane, type DeployReleaseFile } from "./control-plane.ts";

type MockClientOverrides = Partial<{
  get: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
}>;

const config: ResolvedConfig = {
  apiUrl: "https://control.example.test/api",
  apiToken: "test-token",
  projectSlug: "my-project",
};

function mockClientReturning(overrides: MockClientOverrides): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = overrides.get ? await overrides.get(path, params) : {};
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

async function collectReleaseFiles(files: AsyncIterable<DeployReleaseFile>) {
  const collected: DeployReleaseFile[] = [];
  for await (const file of files) collected.push(file);
  return collected;
}

describe("createHttpDeployControlPlane", () => {
  it("exchanges the API key for an environment access token", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        post: (path, body) => {
          calls.push({ path, body });
          return Promise.resolve({
            access_token: "eyJhbGciOiJSUzI1NiJ9.eyJ1c2VySWQiOiJ1XzEifQ.sig",
            token_type: "Bearer",
            expires_in: 300,
          });
        },
      }),
    );

    assertEquals(
      await controlPlane.createEnvironmentAccessToken({
        projectId: "11111111-1111-4111-8111-111111111111",
        environmentName: "production",
      }),
      "eyJhbGciOiJSUzI1NiJ9.eyJ1c2VySWQiOiJ1XzEifQ.sig",
    );
    assertEquals(calls, [{
      path: "/auth/environment-token",
      body: {
        project_reference: "11111111-1111-4111-8111-111111111111",
        environment_name: "production",
      },
    }]);
  });

  it("treats only not-found release asset manifests as polling absence", async () => {
    const notFound = { status: 404 };
    const forbidden = { status: 403 };
    let error: unknown = notFound;
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () => Promise.reject(error),
      }),
    );

    assertEquals(
      await controlPlane.getReleaseAssetManifest("my-project", "release-1"),
      null,
    );

    error = forbidden;
    await assertRejects(
      () => controlPlane.getReleaseAssetManifest("my-project", "release-1"),
    );
  });

  it("does not treat a successful null manifest response as polling absence", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () => Promise.resolve(null),
      }),
    );

    await assertRejects(
      () => controlPlane.getReleaseAssetManifest("my-project", "release-1"),
      Error,
      "empty manifest response",
    );
  });

  it("does not treat an empty successful manifest response as polling absence", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () => Promise.resolve(undefined),
      }),
    );

    await assertRejects(
      () => controlPlane.getReleaseAssetManifest("my-project", "release-1"),
      Error,
      "empty manifest response",
    );
  });

  it("normalizes legacy deployment references before returning them", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        post: () =>
          Promise.resolve({
            id: "deployment-1",
            release: { id: "release-1" },
            environment: { id: "environment-1" },
          }),
      }),
    );

    assertEquals(
      await controlPlane.createDeployment("project-1", {
        releaseId: "release-1",
        environmentId: "environment-1",
      }),
      {
        id: "deployment-1",
        releaseId: "release-1",
        environmentId: "environment-1",
      },
    );
  });

  it("reads environment pages until the named environment is found", async () => {
    const requests: Array<{ path: string; params?: Record<string, string> }> = [];
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: (path, params) => {
          requests.push({ path, params });
          if (!params?.cursor) {
            return Promise.resolve({
              data: [{ id: "environment-1", name: "preview", protected: false }],
              page_info: { next: "cursor-2" },
            });
          }
          return Promise.resolve({
            data: [{
              id: "environment-2",
              name: "production",
              protected: true,
              project: { id: "project-1" },
            }],
            page_info: {},
          });
        },
      }),
    );

    assertEquals(await controlPlane.getEnvironment("project-1", "production"), {
      id: "environment-2",
      name: "production",
      protected: true,
      projectId: "project-1",
    });
    assertEquals(requests, [
      { path: "/projects/project-1/environments", params: { limit: "100" } },
      {
        path: "/projects/project-1/environments",
        params: { limit: "100", cursor: "cursor-2" },
      },
    ]);
  });

  it("streams release files from every page with legacy version data decoded", async () => {
    const requests: Array<{ path: string; params?: Record<string, string> }> = [];
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: (path, params) => {
          requests.push({ path, params });
          if (!params?.cursor) {
            return Promise.resolve({
              data: [{
                path: "app.ts",
                data: JSON.stringify({
                  path: "app.ts",
                  body: "export const app = 1;\n",
                  language: "typescript",
                }),
              }],
              page_info: { next: "cursor-2" },
            });
          }
          return Promise.resolve({
            data: [{ path: "routes/home.ts", content: "export const route = '/';\n" }],
            page_info: {},
          });
        },
      }),
    );

    assertEquals(
      await collectReleaseFiles(
        controlPlane.listReleaseFiles("project-1", "release-1"),
      ),
      [
        { path: "app.ts", content: "export const app = 1;\n" },
        { path: "routes/home.ts", content: "export const route = '/';\n" },
      ],
    );
    assertEquals(requests, [
      {
        path: "/projects/project-1/releases/release-1/versions",
        params: { limit: "100" },
      },
      {
        path: "/projects/project-1/releases/release-1/versions",
        params: { limit: "100", cursor: "cursor-2" },
      },
    ]);
  });
});

describe("createHttpDeployControlPlane environments", () => {
  it("finds the named environment among others and normalizes it", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () =>
          Promise.resolve({
            data: [
              { id: "env-1", name: "production", protected: true },
              { id: "env-2", name: "staging", protected: false },
            ],
            page_info: {},
          }),
      }),
    );

    assertEquals(await controlPlane.getEnvironment("my-project", "staging"), {
      id: "env-2",
      name: "staging",
      protected: false,
    });
  });

  it("returns null when the named environment does not exist", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () => Promise.resolve({ data: [], page_info: {} }),
      }),
    );

    assertEquals(await controlPlane.getEnvironment("my-project", "nonexistent"), null);
  });

  it("returns null after exhausting all environment pages", async () => {
    let callCount = 0;
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
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
      }),
    );

    assertEquals(await controlPlane.getEnvironment("my-project", "production"), null);
    assertEquals(callCount, 2, "reads every page before concluding absence");
  });

  it("propagates environment listing API errors", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () => Promise.reject(new Error("Network error")),
      }),
    );

    await assertRejects(
      () => controlPlane.getEnvironment("my-project", "production"),
      Error,
      "Network error",
    );
  });
});

describe("createHttpDeployControlPlane releases", () => {
  it("sends branch references through the release creation wire format", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        post: (url, body) => {
          capturedUrl = url;
          capturedBody = body;
          return Promise.resolve({ id: "rel-123", version: "1.0.0", name: "develop" });
        },
      }),
    );

    await controlPlane.createRelease("my-project", { branch: "develop" });
    assertEquals(capturedUrl, "/projects/my-project/releases");
    assertEquals(capturedBody, { branch_reference: "develop" });
  });

  it("sends name and branch together in the release creation wire format", async () => {
    let capturedBody: unknown = null;
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        post: (_url, body) => {
          capturedBody = body;
          return Promise.resolve({ id: "rel-123", version: "1.0.0", name: "v2.0.0" });
        },
      }),
    );

    await controlPlane.createRelease("my-project", { name: "v2.0.0", branch: "develop" });
    assertEquals(capturedBody, { name: "v2.0.0", branch_reference: "develop" });
  });

  it("propagates release creation API errors", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        post: () => Promise.reject(new Error("Branch not found")),
      }),
    );

    await assertRejects(
      () => controlPlane.createRelease("my-project", { branch: "nonexistent" }),
      Error,
      "Branch not found",
    );
  });

  it("normalizes canonical release records from wire aliases", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: (path) => {
          assertEquals(path, "/projects/my-project/releases/rel-123");
          return Promise.resolve({
            id: "rel-123",
            name: "github-main-90719c01",
            version: "0.0.41",
            project_id: "project-1",
          });
        },
      }),
    );

    const release = await controlPlane.getRelease("my-project", "rel-123");
    assertEquals(release.id, "rel-123");
    assertEquals(release.version, "0.0.41");
    assertEquals(release.projectId, "project-1");
  });

  it("rejects release files with invalid version data", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () =>
          Promise.resolve({
            data: [{ path: "app.ts", data: "not-json" }],
            page_info: {},
          }),
      }),
    );

    await assertRejects(
      async () => {
        for await (const _ of controlPlane.listReleaseFiles("my-project", "rel-1")) {
          // drain
        }
      },
      Error,
      "has invalid version data",
    );
  });
});

describe("createHttpDeployControlPlane deployments", () => {
  it("sends deployment creation through the wire format", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        post: (url, body) => {
          capturedUrl = url;
          capturedBody = body;
          return Promise.resolve({
            id: "deploy-123",
            release_id: "rel-456",
            environment_id: "env-789",
          });
        },
      }),
    );

    const deployment = await controlPlane.createDeployment("my-project", {
      releaseId: "rel-456",
      environmentId: "env-789",
    });
    assertEquals(capturedUrl, "/projects/my-project/deployments");
    assertEquals(capturedBody, { release_id: "rel-456", environment_id: "env-789" });
    assertEquals(deployment.id, "deploy-123");
    assertEquals(deployment.releaseId, "rel-456");
    assertEquals(deployment.environmentId, "env-789");
  });

  it("normalizes canonical deployment reads from the wire format", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: (path) => {
          assertEquals(path, "/projects/my-project/deployments/deploy-123");
          return Promise.resolve({
            id: "deploy-123",
            release_id: "rel-456",
            environment_id: "env-789",
          });
        },
      }),
    );

    const deployment = await controlPlane.getDeployment("my-project", "deploy-123");
    assertEquals(deployment.releaseId, "rel-456");
    assertEquals(deployment.environmentId, "env-789");
  });

  it("normalizes legacy nested references on deployment reads", async () => {
    const controlPlane = createHttpDeployControlPlane(
      config,
      mockClientReturning({
        get: () =>
          Promise.resolve({
            id: "deploy-123",
            release: { id: "rel-456" },
            environment: { id: "env-789" },
          }),
      }),
    );

    const deployment = await controlPlane.getDeployment("my-project", "deploy-123");
    assertEquals(deployment.releaseId, "rel-456");
    assertEquals(deployment.environmentId, "env-789");
  });

  it("propagates deployment creation API errors", async () => {
    for (
      const failure of [
        "Cannot deploy to protected environment without approval",
        "Release not found",
        "Environment not found",
      ]
    ) {
      const controlPlane = createHttpDeployControlPlane(
        config,
        mockClientReturning({
          post: () => Promise.reject(new Error(failure)),
        }),
      );

      await assertRejects(
        () =>
          controlPlane.createDeployment("my-project", {
            releaseId: "rel-123",
            environmentId: "env-123",
          }),
        Error,
        failure,
        failure,
      );
    }
  });
});
