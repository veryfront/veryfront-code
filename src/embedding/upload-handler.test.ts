import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { createUploadHandler } from "./upload-handler.ts";
import type { RagSearchOptions, RagSearchResult, RagStore } from "./types.ts";

const CLOUD_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "VERYFRONT_API_BASE_URL",
] as const;

function clearCloudEnv(): void {
  for (const key of CLOUD_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function withMockFetch<T>(
  mockFetch: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
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
    async removeDocument(_id: string): Promise<void> {},
    async indexContentDir(): Promise<void> {},
    ...overrides,
  };
}

describe("createUploadHandler", () => {
  afterEach(() => {
    clearCloudEnv();
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
      const [upload] = payload.uploads as Array<Record<string, unknown>>;
      assertExists(upload);
      assertEquals(upload.id, "doc-123");
      assertEquals(
        upload.url,
        "https://download.test/demo-project/.veryfront%2Frag%2Fuploads%2Fdoc-123.blob",
      );
    });
  });

  it("fails delete without removing the document when blob cleanup fails", async () => {
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

      assertEquals(response.status, 500);
      assertEquals(removed, []);
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
});
