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
      "invalid state response",
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
