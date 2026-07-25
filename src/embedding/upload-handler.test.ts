import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
import { createUploadHandler } from "./upload-handler.ts";
import type {
  RagIngestMeta,
  RagOperationOptions,
  RagSearchOptions,
  RagSearchResult,
  RagStore,
} from "./types.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "VERYFRONT_API_BASE_URL",
] as const;

const ORIGINAL_CLOUD_ENV = new Map(
  CLOUD_ENV_KEYS.map((key) => [key, getEnv(key)] as const),
);

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function restoreCloudEnv(): void {
  clearCloudEnv();
  for (const [key, value] of ORIGINAL_CLOUD_ENV) {
    if (value !== undefined) setEnv(key, value);
  }
}

function createStubStore(overrides: Partial<RagStore> = {}): RagStore {
  return {
    async ingest(): Promise<string> {
      return "doc-123";
    },
    async search(
      _query: string,
      _options?: RagSearchOptions,
    ): Promise<RagSearchResult[]> {
      return [];
    },
    async listDocuments() {
      return [];
    },
    async refreshDocument(_id: string, _text: string): Promise<void> {},
    async removeDocument(_id: string): Promise<void> {},
    async indexContentDir(): Promise<void> {},
    ...overrides,
  };
}

describe("createUploadHandler", () => {
  beforeEach(() => {
    clearCloudEnv();
  });

  afterEach(() => {
    restoreCloudEnv();
  });

  it("warns once when registered without explicit auth", () => {
    const originalWarn = serverLogger.warn;
    const warnings: string[] = [];
    serverLogger.warn = (message: string) => {
      warnings.push(message);
    };

    try {
      createUploadHandler(createStubStore());
      createUploadHandler(createStubStore());
    } finally {
      serverLogger.warn = originalWarn;
    }

    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0] ?? "", "createUploadHandler");
    assertStringIncludes(warnings[0] ?? "", "auth");
    assertStringIncludes(warnings[0] ?? "", "allowUnauthenticated");
  });

  it("rejects invalid resource-limit configuration at construction", () => {
    for (const maxFileSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () =>
          createUploadHandler(createStubStore(), {
            maxFileSize,
            auth: { type: "none", allowUnauthenticated: true },
          }),
        Error,
        "maxFileSize",
      );
    }

    assertThrows(
      () =>
        createUploadHandler(createStubStore(), {
          maxFileSize: 10,
          maxBodySize: 9,
          auth: { type: "none", allowUnauthenticated: true },
        }),
      Error,
      "maxBodySize",
    );
  });

  it("rejects upload routes before store access when auth denies", async () => {
    let ingestCalls = 0;
    let listCalls = 0;
    let removeCalls = 0;
    const store = createStubStore({
      async ingest(): Promise<string> {
        ingestCalls++;
        return "doc-denied";
      },
      async listDocuments() {
        listCalls++;
        return [];
      },
      async removeDocument(): Promise<void> {
        removeCalls++;
      },
    });
    const handlers = createUploadHandler(store, {
      auth: {
        authorize: () => Response.json({ error: "Forbidden" }, { status: 403 }),
      },
    });

    const postResponse = await handlers.POST(
      new Request("http://test/uploads", {
        method: "POST",
        body: "not multipart",
      }),
    );
    const getResponse = await handlers.GET(
      new Request("http://test/uploads", { method: "GET" }),
    );
    const deleteResponse = await handlers.DELETE(
      new Request("http://test/uploads/doc-123", { method: "DELETE" }),
      { params: { id: "doc-123" } },
    );

    assertEquals(postResponse.status, 403);
    assertEquals(getResponse.status, 403);
    assertEquals(deleteResponse.status, 403);
    assertEquals(ingestCalls, 0);
    assertEquals(listCalls, 0);
    assertEquals(removeCalls, 0);
  });

  it("allows upload routes when auth accepts", async () => {
    const methods: string[] = [];
    const removed: string[] = [];
    const store = createStubStore({
      async listDocuments() {
        return [];
      },
      async removeDocument(id: string): Promise<void> {
        removed.push(id);
      },
    });
    const handlers = createUploadHandler(store, {
      auth: {
        authorize: (request) => {
          methods.push(request.method);
          return true;
        },
      },
    });

    const formData = new FormData();
    formData.append(
      "file",
      new File(["hello world"], "guide.txt", { type: "text/plain" }),
    );

    const postResponse = await handlers.POST(
      new Request("http://test/uploads", {
        method: "POST",
        body: formData,
      }),
    );
    const getResponse = await handlers.GET(
      new Request("http://test/uploads", { method: "GET" }),
    );
    const deleteResponse = await handlers.DELETE(
      new Request("http://test/uploads/doc-123", { method: "DELETE" }),
      { params: { id: "doc-123" } },
    );

    assertEquals(postResponse.status, 200);
    assertEquals(getResponse.status, 200);
    assertEquals(deleteResponse.status, 200);
    assertEquals(methods, ["POST", "GET", "DELETE"]);
    assertEquals(removed, ["doc-123"]);
  });

  it("rejects oversized declared multipart bodies before ingestion", async () => {
    let ingestCalls = 0;
    const { POST } = createUploadHandler(
      createStubStore({
        async ingest(): Promise<string> {
          ingestCalls++;
          return "never";
        },
      }),
      {
        maxFileSize: 4,
        maxBodySize: 8,
        auth: { type: "none", allowUnauthenticated: true },
      },
    );

    const response = await POST(
      new Request("http://test/uploads", {
        method: "POST",
        headers: {
          "content-length": "9",
          "content-type": "multipart/form-data; boundary=test",
        },
        body: "ignored",
      }),
    );

    assertEquals(response.status, 413);
    assertEquals(ingestCalls, 0);
  });

  it("bounds chunked multipart bodies before parsing", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { POST } = createUploadHandler(createStubStore(), {
      maxFileSize: 4,
      maxBodySize: 8,
      auth: { type: "none", allowUnauthenticated: true },
    });

    const response = await POST(
      new Request("http://test/uploads", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: stream,
      }),
    );

    assertEquals(response.status, 413);
    assertEquals(cancelled, true);
  });

  it("rejects malformed or non-multipart bodies as client errors", async () => {
    const { POST } = createUploadHandler(createStubStore(), {
      auth: { type: "none", allowUnauthenticated: true },
    });

    const wrongType = await POST(
      new Request("http://test/uploads", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not multipart",
      }),
    );
    const malformed = await POST(
      new Request("http://test/uploads", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: "--test\r\ninvalid\r\n--test--",
      }),
    );

    assertEquals(wrongType.status, 415);
    assertEquals(malformed.status, 400);
  });

  it("rejects multiple file fields", async () => {
    const { POST } = createUploadHandler(createStubStore(), {
      auth: { type: "none", allowUnauthenticated: true },
    });
    const formData = new FormData();
    formData.append("file", new File(["one"], "one.txt", { type: "text/plain" }));
    formData.append("file", new File(["two"], "two.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 400);
  });

  it("rejects files and extracted text that exceed configured limits", async () => {
    const fileLimited = createUploadHandler(createStubStore(), {
      maxFileSize: 4,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const largeFile = new FormData();
    largeFile.append("file", new File(["12345"], "large.txt", { type: "text/plain" }));
    const fileResponse = await fileLimited.POST(
      new Request("http://test/uploads", { method: "POST", body: largeFile }),
    );

    const outputLimited = createUploadHandler(createStubStore(), {
      maxExtractedTextBytes: 40,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const amplified = new FormData();
    amplified.append(
      "file",
      new File([`${"Header".repeat(8)}\na\nb`], "large.csv", { type: "text/csv" }),
    );
    const outputResponse = await outputLimited.POST(
      new Request("http://test/uploads", { method: "POST", body: amplified }),
    );

    assertEquals(fileResponse.status, 413);
    assertEquals(outputResponse.status, 413);
  });

  it("does not expose internal ingestion errors to clients", async () => {
    const { POST } = createUploadHandler(
      createStubStore({
        async ingest(): Promise<string> {
          throw new Error("secret-token=should-not-leak");
        },
      }),
      { auth: { type: "none", allowUnauthenticated: true } },
    );
    const formData = new FormData();
    formData.append("file", new File(["safe"], "safe.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );
    const body = await response.json();

    assertEquals(response.status, 500);
    assertEquals(body.error, "Upload failed");
    assertEquals(JSON.stringify(body).includes("secret-token"), false);
  });

  it("stops before body parsing when the request is already aborted", async () => {
    let ingestCalls = 0;
    const { POST } = createUploadHandler(
      createStubStore({
        async ingest(): Promise<string> {
          ingestCalls++;
          return "never";
        },
      }),
      { auth: { type: "none", allowUnauthenticated: true } },
    );
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const formData = new FormData();
    formData.append("file", new File(["safe"], "safe.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://test/uploads", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }),
    );

    assertEquals(response.status, 499);
    assertEquals(ingestCalls, 0);
  });

  it("propagates request cancellation into RAG ingestion", async () => {
    const ingestStarted = Promise.withResolvers<AbortSignal>();
    const { POST } = createUploadHandler(
      createStubStore({
        async ingest(
          _title: string,
          _text: string,
          _meta?: RagIngestMeta,
          options?: RagOperationOptions,
        ): Promise<string> {
          const signal = options?.abortSignal;
          assertExists(signal);
          ingestStarted.resolve(signal);
          return await new Promise<string>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(signal.reason),
              { once: true },
            );
          });
        },
      }),
      { auth: { type: "none", allowUnauthenticated: true } },
    );
    const controller = new AbortController();
    const formData = new FormData();
    formData.append("file", new File(["safe"], "safe.txt", { type: "text/plain" }));

    const request = new Request("http://test/uploads", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    const responsePromise = POST(request);
    const receivedSignal = await ingestStarted.promise;
    controller.abort(new DOMException("cancelled", "AbortError"));
    const response = await responsePromise;

    assertEquals(receivedSignal, request.signal);
    assertEquals(receivedSignal.aborted, true);
    assertEquals(response.status, 499);
  });

  it("returns chat upload registry fields for docs-agent uploads", async () => {
    const store = createStubStore({
      async ingest(): Promise<string> {
        return "doc-123";
      },
      async listDocuments() {
        return [
          {
            id: "doc-123",
            title: "guide.txt",
            source: "upload:guide.txt",
            type: "txt",
            createdAt: 1,
          },
        ];
      },
    });
    const { POST, GET } = createUploadHandler(store, {
      auth: { type: "none", allowUnauthenticated: true },
    });

    const formData = new FormData();
    formData.append(
      "file",
      new File(["hello world"], "guide.txt", { type: "text/plain" }),
    );

    const postResponse = await POST(
      new Request("http://test/uploads", {
        method: "POST",
        body: formData,
      }),
    );
    const postBody = await postResponse.json();
    const getResponse = await GET(new Request("http://test/uploads", { method: "GET" }));
    const getBody = await getResponse.json();

    assertEquals(postBody.id, "doc-123");
    assertEquals(postBody.name, "guide.txt");
    assertEquals(postBody.mediaType, "text/plain");
    assertEquals(postBody.size, 11);
    assertEquals(getBody.items[0], {
      id: "doc-123",
      name: "guide.txt",
      mediaType: "text/plain",
      size: 0,
    });
    assertEquals(getBody.total, 1);
    assertEquals(getBody.hasMore, false);
  });

  it("lists only uploads with deterministic pagination and persisted metadata", async () => {
    const store = createStubStore({
      async listDocuments() {
        return [
          {
            id: "content-1",
            title: "Managed content",
            source: "content/managed.md",
            type: "md",
            createdAt: 99,
          },
          {
            id: "upload-1",
            title: "old.txt",
            source: "upload:old.txt",
            type: "txt",
            mediaType: "text/plain",
            size: 3,
            createdAt: 1,
          },
          {
            id: "upload-3",
            title: "new.csv",
            source: "upload:new.csv",
            type: "csv",
            mediaType: "text/csv",
            size: 9,
            createdAt: 3,
          },
          {
            id: "upload-2",
            title: "middle.txt",
            source: "upload:middle.txt",
            type: "txt",
            mediaType: "text/plain",
            size: 6,
            createdAt: 2,
          },
        ];
      },
    });
    const { GET } = createUploadHandler(store, {
      maxListItems: 2,
      auth: { type: "none", allowUnauthenticated: true },
    });

    const first = await GET(new Request("http://test/uploads?limit=2"));
    const firstBody = await first.json();
    const second = await GET(new Request("http://test/uploads?limit=2&offset=2"));
    const secondBody = await second.json();
    const invalid = await GET(new Request("http://test/uploads?limit=3"));

    assertEquals(
      firstBody.items.map((item: { id: string }) => item.id),
      ["upload-3", "upload-2"],
    );
    assertEquals(firstBody.items[0].mediaType, "text/csv");
    assertEquals(firstBody.items[0].size, 9);
    assertEquals(firstBody.total, 3);
    assertEquals(firstBody.hasMore, true);
    assertEquals(
      secondBody.items.map((item: { id: string }) => item.id),
      ["upload-1"],
    );
    assertEquals(secondBody.hasMore, false);
    assertEquals(invalid.status, 400);
  });

  it("deletes docs-agent uploads from a query-string id", async () => {
    const removed: string[] = [];
    const store = createStubStore({
      async removeDocument(id: string): Promise<void> {
        removed.push(id);
      },
    });
    const { DELETE } = createUploadHandler(store, {
      auth: { type: "none", allowUnauthenticated: true },
    });

    const response = await DELETE(
      new Request("http://test/uploads?id=doc-123", { method: "DELETE" }),
    );

    assertEquals(response.status, 200);
    assertEquals(removed, ["doc-123"]);
  });

  it("does not expose non-upload documents to deletion", async () => {
    let removeCalls = 0;
    const store = createStubStore({
      async listDocuments() {
        return [{
          id: "content-1",
          title: "Managed",
          source: "content/managed.md",
          type: "md",
          createdAt: 1,
        }];
      },
      async removeDocument(): Promise<void> {
        removeCalls++;
      },
    });
    const { DELETE } = createUploadHandler(store, {
      auth: { type: "none", allowUnauthenticated: true },
    });

    const response = await DELETE(
      new Request("http://test/uploads?id=content-1", { method: "DELETE" }),
    );

    assertEquals(response.status, 404);
    assertEquals(removeCalls, 0);
  });

  it("rejects ambiguous or unsafe deletion IDs before store mutation", async () => {
    let removeCalls = 0;
    const { DELETE } = createUploadHandler(
      createStubStore({
        async removeDocument(): Promise<void> {
          removeCalls++;
        },
      }),
      { auth: { type: "none", allowUnauthenticated: true } },
    );

    const conflicting = await DELETE(
      new Request("http://test/uploads?id=other", { method: "DELETE" }),
      { params: { id: "doc-123" } },
    );
    const unsafe = await DELETE(
      new Request("http://test/uploads?id=..%2Fsecret", { method: "DELETE" }),
    );

    assertEquals(conflicting.status, 400);
    assertEquals(unsafe.status, 400);
    assertEquals(removeCalls, 0);
  });

  it("accepts explicit unauthenticated upload routes", async () => {
    const store = createStubStore();
    const { GET } = createUploadHandler(store, {
      auth: { type: "none", allowUnauthenticated: true },
    });

    const response = await GET(new Request("http://test/uploads", { method: "GET" }));

    assertEquals(response.status, 200);
  });

  it("stores uploaded source binaries in Veryfront Cloud when bootstrap is present", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_uploads");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");

    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const store = createStubStore();
    const { POST } = createUploadHandler(store);

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = request.url;
      const method = request.method;

      if (method === "POST" && url === "https://api.test/projects/demo-project/uploads") {
        const body = await request.json();
        calls.push({ method, url, body });

        return Response.json({
          file_upload_url: "https://storage.test/upload/doc-123",
          file_path: ".veryfront/rag/uploads/doc-123.blob",
          upload_id: "upload-123",
          required_headers: {},
        });
      }

      if (method === "PUT" && url === "https://storage.test/upload/doc-123") {
        calls.push({ method, url });
        return new Response(null, { status: 200 });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }, async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["hello world"], "guide.txt", { type: "text/plain" }),
      );

      const response = await POST(
        new Request("http://test/uploads", {
          method: "POST",
          body: formData,
        }),
      );

      assertEquals(response.status, 200);
      assertEquals(calls.length, 4);
      assertEquals(calls[0]?.method, "POST");
      assertEquals(calls[0]?.url, "https://api.test/projects/demo-project/uploads");
      assertEquals(calls[0]?.body, {
        file_path: ".veryfront/rag/uploads/doc-123.blob",
        content_type: "text/plain",
        size: 11,
      });
      assertEquals(calls[1]?.method, "PUT");
      assertEquals(calls[1]?.url, "https://storage.test/upload/doc-123");
      assertEquals(calls[2]?.method, "POST");
      assertEquals(calls[2]?.url, "https://api.test/projects/demo-project/uploads");
      const metadataCreateBody = calls[2]?.body as Record<string, unknown>;
      assertEquals(metadataCreateBody.file_path, ".veryfront/rag/uploads/doc-123.meta.json");
      assertEquals(metadataCreateBody.content_type, "application/json");
      assertEquals(typeof metadataCreateBody.size, "number");
      assertEquals(calls[3]?.method, "PUT");
      assertEquals(calls[3]?.url, "https://storage.test/upload/doc-123");
    });
  });

  it("rolls back the RAG document when cloud source persistence fails", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_uploads");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");

    const removed: string[] = [];
    const deleted: string[] = [];
    const store = createStubStore({
      async removeDocument(id: string): Promise<void> {
        removed.push(id);
      },
    });
    const { POST } = createUploadHandler(store);

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);

      if (
        request.method === "POST" &&
        request.url === "https://api.test/projects/demo-project/uploads"
      ) {
        return Response.json({
          file_upload_url: "https://storage.test/upload/doc-123",
          file_path: ".veryfront/rag/uploads/doc-123.blob",
          upload_id: "upload-123",
          required_headers: {},
        });
      }

      if (request.method === "PUT" && request.url === "https://storage.test/upload/doc-123") {
        return new Response("boom", { status: 500 });
      }

      if (request.method === "DELETE") {
        deleted.push(request.url);
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    }, async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["hello world"], "guide.txt", { type: "text/plain" }),
      );

      const response = await POST(
        new Request("http://test/uploads", {
          method: "POST",
          body: formData,
        }),
      );

      assertEquals(response.status, 500);
      assertEquals(removed, ["doc-123"]);
      assertEquals(deleted.length, 2);
      assertEquals(
        deleted.some((url) => url.endsWith("doc-123.meta.json")),
        true,
      );
      assertEquals(
        deleted.some((url) => url.endsWith("doc-123.blob")),
        true,
      );
    });
  });

  it("cleans up cloud source binaries on delete when bootstrap is present", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_uploads");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");

    const removed: string[] = [];
    const deleteCalls: string[] = [];
    const store = createStubStore({
      async removeDocument(id: string): Promise<void> {
        removed.push(id);
      },
    });
    const { DELETE } = createUploadHandler(store);

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      deleteCalls.push(`${request.method} ${request.url}`);
      return new Response(null, { status: 204 });
    }, async () => {
      const response = await DELETE(
        new Request("http://test/uploads/doc-123", { method: "DELETE" }),
        { params: { id: "doc-123" } },
      );

      assertEquals(response.status, 200);
      assertEquals(removed, ["doc-123"]);
      assertEquals(deleteCalls, [
        "DELETE https://api.test/projects/demo-project/uploads/.veryfront%2Frag%2Fuploads%2Fdoc-123.meta.json",
        "DELETE https://api.test/projects/demo-project/uploads/.veryfront%2Frag%2Fuploads%2Fdoc-123.blob",
      ]);
    });
  });

  it("lists cloud-backed uploads with signed source URLs", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_uploads");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");

    const store = createStubStore({
      async listDocuments() {
        return [{
          id: "doc-123",
          title: "guide.txt",
          source: "upload:guide.txt",
          type: "txt",
          createdAt: 1,
        }];
      },
    });
    const { GET } = createUploadHandler(store);

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = request.url;
      const method = request.method;

      if (
        method === "GET" &&
        url ===
          "https://api.test/projects/demo-project/uploads/.veryfront%2Frag%2Fuploads%2Fdoc-123.meta.json/url"
      ) {
        return Response.json({
          signed_url:
            "https://download.test/demo-project/.veryfront%2Frag%2Fuploads%2Fdoc-123.meta.json",
          expires_at: "2026-03-09T12:30:00.000Z",
        });
      }

      if (
        method === "GET" &&
        url === "https://download.test/demo-project/.veryfront%2Frag%2Fuploads%2Fdoc-123.meta.json"
      ) {
        return Response.json({
          version: 1,
          id: "doc-123",
          size: 11,
          mimeType: "text/plain",
          createdAt: "2026-03-09T12:00:00.000Z",
          metadata: { title: "guide.txt" },
        });
      }

      if (
        method === "GET" &&
        url ===
          "https://api.test/projects/demo-project/uploads/.veryfront%2Frag%2Fuploads%2Fdoc-123.blob/url"
      ) {
        return Response.json({
          signed_url:
            "https://download.test/demo-project/.veryfront%2Frag%2Fuploads%2Fdoc-123.blob",
          expires_at: "2026-03-09T12:30:00.000Z",
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }, async () => {
      const response = await GET();

      assertEquals(response.status, 200);
      const payload = await response.json();
      const [upload] = payload.items as Array<Record<string, unknown>>;
      assertExists(upload);
      assertEquals(upload.id, "doc-123");
      assertEquals(upload.name, "guide.txt");
      assertEquals(upload.mediaType, "text/plain");
      assertEquals(upload.size, 11);
      assertEquals(
        upload.url,
        "https://download.test/demo-project/.veryfront%2Frag%2Fuploads%2Fdoc-123.blob",
      );
    });
  });

  it("returns a retryable error when blob cleanup remains incomplete", async () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_uploads");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");

    const removed: string[] = [];
    const store = createStubStore({
      async removeDocument(id: string): Promise<void> {
        removed.push(id);
      },
    });
    const { DELETE } = createUploadHandler(store);

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === "DELETE") {
        return new Response("boom", { status: 500 });
      }

      throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
    }, async () => {
      const response = await DELETE(
        new Request("http://test/uploads/doc-123", { method: "DELETE" }),
        { params: { id: "doc-123" } },
      );

      assertEquals(response.status, 502);
      assertEquals(removed, ["doc-123"]);
    });
  });

  it("does not use cloud uploads without bootstrap", async () => {
    const store = createStubStore();
    const { POST } = createUploadHandler(store);

    await withMockFetch(async () => {
      throw new Error("fetch should not be called");
    }, async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["hello world"], "guide.txt", { type: "text/plain" }),
      );

      const response = await POST(
        new Request("http://test/uploads", {
          method: "POST",
          body: formData,
        }),
      );

      assertEquals(response.status, 200);
    });
  });

  it("strips angle brackets from uploaded filenames to prevent stored XSS", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-xss";
      },
    });
    const { POST } = createUploadHandler(store);

    // Use a filename with angle brackets (the key XSS vector).
    // Deno's FormData mangles filenames with = and control chars,
    // so we use a simpler payload that survives the round-trip.
    const formData = new FormData();
    formData.append(
      "file",
      new File(
        ["test content"],
        "<b>bold</b>.txt",
        { type: "text/plain" },
      ),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(
      body.name,
      "bbold_b.txt",
      "angle brackets must be stripped, / becomes _",
    );
    assertEquals(ingestedTitle, body.name);
  });

  it("strips ampersands to prevent HTML entity injection", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-amp";
      },
    });
    const { POST } = createUploadHandler(store);

    // Deno's FormData truncates filenames at & so we test with
    // a filename where & appears after a safe prefix
    const formData = new FormData();
    formData.append(
      "file",
      new File(["data"], "Tom & Jerry.txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    assertEquals(
      ingestedTitle,
      "Tom  Jerry.txt",
      "ampersands must be stripped to prevent entity injection",
    );
  });

  it("strips path separators from filenames", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-path";
      },
    });
    const { POST } = createUploadHandler(store);

    const formData = new FormData();
    formData.append(
      "file",
      new File(["content"], ".._.._etc_passwd.txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    assertEquals(ingestedTitle, ".._.._etc_passwd.txt");
  });

  it("falls back to 'untitled' when filename is only special characters", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-empty";
      },
    });
    const { POST } = createUploadHandler(store);

    // Filename of only angle brackets — sanitization removes everything
    const formData = new FormData();
    formData.append(
      "file",
      new File(["hello world"], "<>.txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(
      body.name,
      ".txt",
      "only angle brackets removed, extension preserved",
    );
    assertEquals(ingestedTitle, ".txt");
  });

  it("falls back to 'untitled' when entire filename is stripped", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-untitled";
      },
    });
    const { POST } = createUploadHandler(store);

    // Filename of only stripped characters (no extension)
    const formData = new FormData();
    formData.append(
      "file",
      new File(["hello world"], "<>", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    assertEquals(
      ingestedTitle,
      "untitled",
      "empty filename after sanitization should fall back to 'untitled'",
    );
  });

  it("preserves normal filenames with dots, spaces, and parentheses", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-normal";
      },
    });
    const { POST } = createUploadHandler(store);

    const formData = new FormData();
    formData.append(
      "file",
      new File(["data"], "My Report (2026).txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    assertEquals(
      ingestedTitle,
      "My Report (2026).txt",
      "normal filenames should be preserved",
    );
  });

  it("preserves unicode characters in filenames", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-unicode";
      },
    });
    const { POST } = createUploadHandler(store);

    const formData = new FormData();
    formData.append(
      "file",
      new File(["data"], "レポート-2026.txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    assertEquals(
      ingestedTitle,
      "レポート-2026.txt",
      "unicode filenames should be preserved",
    );
  });

  it("truncates filenames exceeding max length", async () => {
    let ingestedTitle = "";
    const store = createStubStore({
      async ingest(title: string): Promise<string> {
        ingestedTitle = title;
        return "doc-long";
      },
    });
    const { POST } = createUploadHandler(store);

    const longName = "a".repeat(300) + ".txt";
    const formData = new FormData();
    formData.append(
      "file",
      new File(["data"], longName, { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://test/uploads", { method: "POST", body: formData }),
    );

    assertEquals(response.status, 200);
    assertEquals(
      ingestedTitle.length <= 200,
      true,
      "filename must be truncated to max length",
    );
  });
});
