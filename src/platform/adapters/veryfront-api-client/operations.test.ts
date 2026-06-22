import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontAPIOperations } from "./operations.ts";

function createOps(
  token: string | (() => string) = "token",
  projectId?: string,
): VeryfrontAPIOperations {
  return new VeryfrontAPIOperations(
    "https://api.example.com",
    token,
    { maxRetries: 3, initialDelay: 100, maxDelay: 1000 },
    projectId,
  );
}

function assertMethodExists<T extends object>(obj: T, key: keyof T): void {
  const value = obj[key];
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("VeryfrontAPIOperations", () => {
  const originalFetch = globalThis.fetch;

  function stubJsonFetch(handler: (url: string, init?: RequestInit) => unknown): void {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const body = handler(String(input), init);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("class", () => {
    it("should export VeryfrontAPIOperations class", () => {
      assertExists(VeryfrontAPIOperations);
      assertEquals(typeof VeryfrontAPIOperations, "function");
    });

    it("should be instantiable with string token", () => {
      assertExists(createOps("test-token"));
    });

    it("should be instantiable with token provider function", () => {
      assertExists(createOps(() => "dynamic-token"));
    });
  });

  describe("getToken", () => {
    it("should return token from string", () => {
      assertEquals(createOps("static-token").getToken(), "static-token");
    });

    it("should return token from provider function", () => {
      assertEquals(createOps(() => "provider-token").getToken(), "provider-token");
    });
  });

  describe("setTokenProvider", () => {
    it("should update the token provider", () => {
      const ops = createOps("old-token");
      assertEquals(ops.getToken(), "old-token");

      ops.setTokenProvider(() => "new-token");
      assertEquals(ops.getToken(), "new-token");
    });
  });

  describe("setProjectId/getProjectId", () => {
    it("should set and get project ID", () => {
      const ops = createOps("token", "initial-project-id");
      assertEquals(ops.getProjectId(), "initial-project-id");

      ops.setProjectId("new-project-id");
      assertEquals(ops.getProjectId(), "new-project-id");
    });

    it("should throw when getting project ID if not set", () => {
      const ops = createOps("token");

      assertThrows(
        () => ops.getProjectId(),
        Error,
        "Veryfront API client not initialized",
      );
    });
  });

  describe("methods exist", () => {
    it("should have listProjects method", () => {
      assertMethodExists(createOps(), "listProjects");
    });

    it("should have getProject method", () => {
      assertMethodExists(createOps(), "getProject");
    });

    it("should have listBranchFiles method", () => {
      assertMethodExists(createOps(), "listBranchFiles");
    });

    it("should have getBranchFile method", () => {
      assertMethodExists(createOps(), "getBranchFile");
    });

    it("should have listEnvironmentFiles method", () => {
      assertMethodExists(createOps(), "listEnvironmentFiles");
    });

    it("should have getEnvironmentFile method", () => {
      assertMethodExists(createOps(), "getEnvironmentFile");
    });

    it("should have listReleaseFiles method", () => {
      assertMethodExists(createOps(), "listReleaseFiles");
    });

    it("should have getReleaseFile method", () => {
      assertMethodExists(createOps(), "getReleaseFile");
    });

    it("should have lookupProjectByDomain method", () => {
      assertMethodExists(createOps(), "lookupProjectByDomain");
    });
  });

  describe("runtime server function access", () => {
    it("requests branch file lists with server functions for preview route discovery", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        };
      });

      await createOps().listBranchFiles("project-slug", "main");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("requests branch file content with server functions for preview handlers", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "file-id",
          path: "app/api/ag-ui/route.ts",
          content: "export const POST = () => new Response();",
          size: 40,
          type: "function",
          updated_at: "2026-04-23T00:00:00.000Z",
        };
      });

      await createOps().getBranchFile("project-slug", "main", "app/api/ag-ui/route.ts");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("requests release file lists with server functions for runtime route discovery", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
          release_id: "release-id",
          release_version: "v1",
        };
      });

      await createOps().listReleaseFiles("project-slug", "release-id");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("requests release file content with server functions for runtime handlers", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "file-id",
          version_id: "version-id",
          path: "pages/api/articles-2.ts",
          content: "export default () => {}",
          size: 21,
          type: "function",
          updated_at: "2026-04-23T00:00:00.000Z",
          release_id: "release-id",
          release_version: "v1",
        };
      });

      await createOps().getReleaseFile("project-slug", "release-id", "pages/api/articles-2.ts");

      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });
  });

  describe("release asset manifest operations", () => {
    it("begins a build at the builds endpoint", async () => {
      let requestedUrl = "";
      let method = "";
      stubJsonFetch((url, init) => {
        requestedUrl = url;
        method = init?.method ?? "GET";
        return { id: "b1", manifest_version: 1, state: "building" };
      });

      const res = await createOps().beginReleaseAssetManifestBuild("project-slug", "rel-1");

      assertEquals(method, "POST");
      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest/builds");
      assertEquals(res.state, "building");
    });

    it("uploads an asset with the content-hash header and raw bytes", async () => {
      let contentHashHeader: string | null = null;
      let contentTypeHeader: string | null = null;
      let requestedUrl = "";
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        const headers = new Headers(init?.headers);
        contentHashHeader = headers.get("x-vf-content-hash");
        contentTypeHeader = headers.get("Content-Type");
        return Promise.resolve(
          new Response(JSON.stringify({ stored: true, existed: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const bytes = new TextEncoder().encode("export const x = 1;");
      const res = await createOps().uploadReleaseAsset(
        "project-slug",
        "rel-1",
        "a".repeat(64),
        "text/javascript",
        bytes,
      );

      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest/assets");
      assertEquals(contentHashHeader, "a".repeat(64));
      assertEquals(contentTypeHeader, "text/javascript");
      assertEquals(res.stored, true);
    });

    it("PUTs the full manifest body", async () => {
      let method = "";
      let requestedUrl = "";
      stubJsonFetch((url, init) => {
        requestedUrl = url;
        method = init?.method ?? "GET";
        return { state: "ready", manifest_version: 1 };
      });

      const res = await createOps().putReleaseAssetManifest("project-slug", "rel-1", {
        schemaVersion: 1,
      });

      assertEquals(method, "PUT");
      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest");
      assertEquals(res.state, "ready");
    });

    it("reports a failed state with sanitized error", async () => {
      let body: unknown;
      stubJsonFetch((_url, init) => {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
        return { state: "failed" };
      });

      await createOps().reportReleaseAssetManifestState(
        "project-slug",
        "rel-1",
        "failed",
        "boom",
      );

      assertEquals((body as { state: string }).state, "failed");
      assertEquals((body as { error: string }).error, "boom");
    });

    it("fetches the manifest via GET", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return { state: "ready", manifest_version: 1, manifest: { schemaVersion: 1 } };
      });

      const res = await createOps().getReleaseAssetManifest("project-slug", "rel-1");

      assertStringIncludes(requestedUrl, "/releases/rel-1/asset-manifest");
      assertEquals(res.state, "ready");
    });
  });
});
