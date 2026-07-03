import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
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
  afterEach(() => {
    clearCloudEnv();
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

  it("removes the document even when blob cleanup fails", async () => {
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

      // Document is removed even though blob cleanup failed (best-effort)
      assertEquals(response.status, 200);
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
      body.upload.title,
      "bbold_b.txt",
      "angle brackets must be stripped, / becomes _",
    );
    assertEquals(ingestedTitle, body.upload.title);
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
      body.upload.title,
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
