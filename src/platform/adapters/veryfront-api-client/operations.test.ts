import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/index.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
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
    __resetLogRecordEmitterForTests();
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

    it("enforces retry bounds for direct construction", () => {
      assertThrows(
        () =>
          new VeryfrontAPIOperations(
            "https://api.example.com",
            "token",
            { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
          ),
        RangeError,
        "maxRetries",
      );
      assertThrows(
        () =>
          new VeryfrontAPIOperations(
            "https://api.example.com",
            "token",
            { maxRetries: 0, initialDelay: 2, maxDelay: 1 },
          ),
        RangeError,
        "initialDelay",
      );
      assertExists(
        new VeryfrontAPIOperations(
          "https://api.example.com",
          "token",
          {
            maxRetries: MAX_VERYFRONT_API_RETRIES,
            initialDelay: 0,
            maxDelay: 0,
          },
        ),
      );
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

    it("clears the project identity explicitly", () => {
      const ops = createOps("token", "project-id");
      ops.clearProjectId();

      assertThrows(
        () => ops.getProjectId(),
        Error,
        "Veryfront API client not initialized",
      );
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

    it("passes path filters through branch file list requests", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        };
      });

      await createOps().listBranchFiles("project-slug", "main", { path: "knowledge/" });

      const parsed = new URL(requestedUrl);
      assertEquals(parsed.searchParams.get("path"), "knowledge/");
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

    it("warn-logs normal 404s for branch file content reads", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () => createOps().getBranchFile("project-slug", "main", "app/globals.css"),
          Error,
          "API request failed: 404 Not Found",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          entry.level === "warn" &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        true,
      );
    });

    it("does not warn-log expected 404s for branch file content probes", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () =>
            createOps().getBranchFile("project-slug", "main", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed: 404 Not Found",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          (entry.level === "warn" || entry.level === "error") &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        false,
      );
    });

    it("does not warn-log expected 404s for environment file content probes", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () =>
            createOps().getEnvironmentFile("project-slug", "production", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed: 404 Not Found",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          (entry.level === "warn" || entry.level === "error") &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        false,
      );
    });

    it("does not warn-log expected 404s for release file content probes", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () =>
            createOps().getReleaseFile("project-slug", "release-id", "app/globals.css", {
              expectedMissing: true,
            }),
          Error,
          "API request failed: 404 Not Found",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          (entry.level === "warn" || entry.level === "error") &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        false,
      );
    });

    it("still warn-logs authentication failures for branch file content", async () => {
      const entries: LogEntry[] = [];
      const originalWarn = console.warn;
      console.warn = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "Invalid authentication token" }), {
            status: 401,
            statusText: "Unauthorized",
            headers: { "Content-Type": "application/json" },
          }),
        )) as typeof fetch;

      try {
        await assertRejects(
          () => createOps().getBranchFile("project-slug", "main", "app/globals.css"),
          Error,
          "API request failed: 401 Unauthorized",
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        entries.some((entry) =>
          entry.level === "warn" &&
          entry.component === "veryfront-api-client" &&
          entry.message === "Request failed"
        ),
        true,
      );
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

  describe("file pagination guards", () => {
    it("fails closed when the API repeats a pagination cursor", async () => {
      let requests = 0;
      stubJsonFetch(() => {
        requests++;
        return {
          data: [],
          page_info: { self: null, first: null, next: "loop", prev: null },
        };
      });

      await assertRejects(
        () => createOps().listAllBranchFiles("project-slug", "main"),
        Error,
        "repeated pagination cursor",
      );
      assertEquals(requests, 2);
    });

    it("rejects invalid page limits before making a request", async () => {
      let requests = 0;
      stubJsonFetch(() => {
        requests++;
        return {
          data: [],
          page_info: { self: null, first: null, next: null, prev: null },
        };
      });

      const ops = createOps();
      for (const limit of [0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => ops.listBranchFiles("project-slug", "main", { limit }),
          Error,
          "integer between 1 and 100",
        );
      }
      assertEquals(requests, 0);
    });
  });

  describe("request input and routing boundaries", () => {
    it("preserves a configured API base path", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return { data: [] };
      });
      const ops = new VeryfrontAPIOperations(
        "https://api.example.com/root/",
        "token",
        { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      );

      await ops.listProjects();

      assertEquals(requestedUrl, "https://api.example.com/root/projects");
    });

    it("rejects invalid project-list limits before making a request", async () => {
      let requests = 0;
      stubJsonFetch(() => {
        requests++;
        return { data: [] };
      });
      const ops = createOps();

      for (const limit of [0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => ops.listProjects({ limit }),
          Error,
          "integer between 1 and 100",
        );
      }
      assertEquals(requests, 0);
    });

    it("canonicalizes domain hosts and matches canonical upstream domains", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "00000000-0000-4000-a000-000000000001",
          name: "Project",
          slug: "project",
          environments: [{
            id: "00000000-0000-4000-a000-000000000002",
            name: "production",
            domains: ["EXAMPLE.COM."],
            active_release_id: "00000000-0000-4000-a000-000000000003",
          }],
        };
      });

      const result = await createOps().lookupProjectByDomain("Example.COM:443");

      assertEquals(new URL(requestedUrl).pathname, "/projects/example.com");
      assertEquals(result?.environment?.name, "production");
      assertEquals(result?.release_id, "00000000-0000-4000-a000-000000000003");
    });

    it("handles bracketed IPv6 hosts without corrupting the address", async () => {
      let requestedUrl = "";
      stubJsonFetch((url) => {
        requestedUrl = url;
        return {
          id: "00000000-0000-4000-a000-000000000001",
          name: "Project",
          slug: "project",
          environments: [{
            id: "00000000-0000-4000-a000-000000000002",
            name: "development",
            domains: ["[::1]"],
            active_release_id: null,
          }],
        };
      });

      const result = await createOps().lookupProjectByDomain("[::1]:8000");

      assertStringIncludes(requestedUrl, "/projects/%5B%3A%3A1%5D");
      assertEquals(result?.environment?.name, "development");
    });

    it("rejects URL-like or credential-bearing domain inputs before fetch", async () => {
      let requests = 0;
      stubJsonFetch(() => {
        requests++;
        return {};
      });

      for (
        const domain of [
          "",
          " example.com",
          "https://example.com",
          "user@example.com",
          "example.com/path",
          "example.com?token=secret",
        ]
      ) {
        await assertRejects(
          () => createOps().lookupProjectByDomain(domain),
          Error,
          "valid bounded host",
        );
      }
      assertEquals(requests, 0);
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
