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
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  createVeryfrontApiTransport,
  type TransportRequestInit,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
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

  describe("bounded file content", () => {
    it("returns exact UTF-8 bytes through the normal branch file endpoint", async () => {
      let requestedUrl = "";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return Promise.resolve(
          new Response(JSON.stringify({ ignored: [1, 2, 3], content: "é" }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const bytes = await createOps().getBranchFileContentBytesWithinLimit(
        "project-slug",
        "main",
        "styles/manifest.json",
        2,
      );

      assertEquals([...bytes], [0xc3, 0xa9]);
      assertStringIncludes(requestedUrl, "/projects/project-slug/files/styles%2Fmanifest.json?");
      assertStringIncludes(requestedUrl, "branch=main");
      assertStringIncludes(requestedUrl, "include_server_functions=true");
    });

    it("rejects oversized content before JSON.parse and without retries", async () => {
      let fetchCalls = 0;
      let parseCalls = 0;
      const originalJsonParse = JSON.parse;
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(new Response(JSON.stringify({ content: "xx" })));
      }) as typeof fetch;
      JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
        parseCalls++;
        return Reflect.apply(originalJsonParse, JSON, args);
      }) as typeof JSON.parse;

      try {
        await assertRejects(
          () =>
            createOps().getBranchFileContentBytesWithinLimit(
              "project-slug",
              "main",
              "styles/manifest.json",
              1,
            ),
          RangeError,
          "1 UTF-8 bytes",
        );
      } finally {
        JSON.parse = originalJsonParse;
      }

      assertEquals(fetchCalls, 1);
      assertEquals(parseCalls, 0);
    });

    it("defensively copies and post-validates custom transport bytes", async () => {
      const operations = createOps();
      const mutable = operations as unknown as {
        transport: { request(): Promise<unknown> };
      };
      const source = new Uint8Array([1, 2]);
      mutable.transport = { request: () => Promise.resolve(source) };

      const bytes = await operations.getBranchFileContentBytesWithinLimit(
        "project-slug",
        "main",
        "manifest.json",
        2,
      );
      source[0] = 9;
      assertEquals([...bytes], [1, 2]);

      mutable.transport = { request: () => Promise.resolve(new Uint8Array([1, 2, 3])) };
      await assertRejects(
        () =>
          operations.getBranchFileContentBytesWithinLimit(
            "project-slug",
            "main",
            "manifest.json",
            2,
          ),
        RangeError,
        "exceeds 2 bytes",
      );
    });
  });

  describe("bounded transport failures", () => {
    it("reserves worst-case JSON escape bytes outside the non-value response budget", async () => {
      const body = '{"content":"\\u0000\\u0000"}';
      assertEquals(new TextEncoder().encode(body).byteLength, 26);
      globalThis.fetch = (() => Promise.resolve(new Response(body))) as typeof fetch;
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const result = await transport.request("/bounded", {
        // The compact document has 14 non-value bytes and the two admitted
        // NULs use the exact worst case of six wire bytes each.
        maxResponseBytes: 14,
        jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 2 },
      });

      assertEquals(result, new Uint8Array([0, 0]));
    });

    it("retries a body read aborted by the per-attempt timeout", async () => {
      let fetchCalls = 0;
      let cancellations = 0;
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                return new Promise<void>(() => {});
              },
              cancel() {
                cancellations++;
              },
            }),
          ),
        );
      }) as typeof fetch;
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        timeoutMs: 5,
      });

      await assertRejects(
        () =>
          transport.request("/bounded", {
            maxResponseBytes: 128,
            jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 8 },
          }),
        VeryfrontError,
      );

      assertEquals(fetchCalls, 2);
      assertEquals(cancellations, 2);
    });

    it("preserves a 400 status when its diagnostic body is malformed UTF-8", async () => {
      let fetchCalls = 0;
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(
          new Response(new Uint8Array([0xc3, 0x28]), {
            status: 400,
            statusText: "Bad Request",
          }),
        );
      }) as typeof fetch;
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });

      const error = await assertRejects(
        () => transport.request("/invalid"),
        VeryfrontError,
        "API request failed: 400 Bad Request",
      );

      assertEquals((error as VeryfrontError).status, 400);
      assertEquals(fetchCalls, 1);
    });

    it("retries a 500 even when its diagnostic body is malformed UTF-8", async () => {
      let fetchCalls = 0;
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(
          new Response(new Uint8Array([0xc3, 0x28]), {
            status: 500,
            statusText: "Internal Server Error",
          }),
        );
      }) as typeof fetch;
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
      });

      await assertRejects(
        () => transport.request("/failed"),
        VeryfrontError,
        "API request failed after 1 retries",
      );

      assertEquals(fetchCalls, 2);
    });

    it("rejects invalid bounded options before fetching", async () => {
      let fetchCalls = 0;
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(new Response("{}"));
      }) as typeof fetch;
      const transport = createVeryfrontApiTransport<unknown>({
        baseUrl: "https://api.example.com",
        getToken: () => "token",
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });
      const invalidOptions = [
        { maxResponseBytes: 0 },
        { maxResponseBytes: Number.MAX_SAFE_INTEGER + 1 },
        { jsonStringFieldWithinLimit: { fieldName: "", maximumBytes: 1 } },
        { jsonStringFieldWithinLimit: { fieldName: "content", maximumBytes: 1.5 } },
        {
          maxResponseBytes: 1,
          jsonStringFieldWithinLimit: {
            fieldName: "content",
            maximumBytes: Number.MAX_SAFE_INTEGER,
          },
        },
      ] as TransportRequestInit[];

      for (const init of invalidOptions) {
        await assertRejects(() => transport.request("/invalid", init));
      }
      assertEquals(fetchCalls, 0);
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
