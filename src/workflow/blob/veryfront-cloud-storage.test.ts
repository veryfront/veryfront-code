import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { VeryfrontCloudBlobStorage } from "./veryfront-cloud-storage.ts";

const originalFetch = globalThis.fetch;
const FIXED_NOW = new Date("2026-03-08T12:00:00.000Z");

interface FetchCallRecord {
  url: string;
  method: string;
  headers: Headers;
}

interface PendingUpload {
  projectSlug: string;
  path: string;
  contentType: string;
  size: number;
}

interface StoredUpload {
  bytes: Uint8Array;
  contentType: string;
  createdAt: string;
}

function makeStorageKey(projectSlug: string, path: string): string {
  return `${projectSlug}:${path}`;
}

function createMockUploadService() {
  const uploads = new Map<string, StoredUpload>();
  const pendingUploads = new Map<string, PendingUpload>();
  const fetchCalls: FetchCallRecord[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const headers = new Headers(request.headers);

    fetchCalls.push({
      url: url.toString(),
      method,
      headers,
    });

    if (url.origin === "https://api.test") {
      const authHeader = headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response("Unauthorized", { status: 401 });
      }

      const createMatch = url.pathname.match(/^\/projects\/([^/]+)\/uploads$/);
      if (createMatch && method === "POST") {
        const projectSlug = decodeURIComponent(createMatch[1] ?? "");
        const body = await request.json() as {
          file_path: string;
          content_type?: string;
          size: number;
        };

        pendingUploads.set(makeStorageKey(projectSlug, body.file_path), {
          projectSlug,
          path: body.file_path,
          contentType: body.content_type ?? "application/octet-stream",
          size: body.size,
        });

        return Response.json({
          file_upload_url: `https://upload.test/${encodeURIComponent(projectSlug)}/${
            encodeURIComponent(body.file_path)
          }`,
          file_path: `${projectSlug}/${body.file_path}`,
          upload_id: crypto.randomUUID(),
          required_headers: {
            "Content-Type": body.content_type ?? "application/octet-stream",
          },
        }, { status: 201 });
      }

      const downloadMatch = url.pathname.match(/^\/projects\/([^/]+)\/uploads\/(.+)\/url$/);
      if (downloadMatch && method === "GET") {
        const projectSlug = decodeURIComponent(downloadMatch[1] ?? "");
        const path = decodeURIComponent(downloadMatch[2] ?? "");
        const key = makeStorageKey(projectSlug, path);
        if (!uploads.has(key)) {
          return new Response("Not found", { status: 404 });
        }

        return Response.json({
          signed_url: `https://download.test/${encodeURIComponent(projectSlug)}/${
            encodeURIComponent(path)
          }`,
          expires_at: new Date(FIXED_NOW.getTime() + 30 * 60 * 1000).toISOString(),
        });
      }

      const metadataMatch = url.pathname.match(/^\/projects\/([^/]+)\/uploads\/(.+)$/);
      if (metadataMatch) {
        const projectSlug = decodeURIComponent(metadataMatch[1] ?? "");
        const path = decodeURIComponent(metadataMatch[2] ?? "");
        const key = makeStorageKey(projectSlug, path);

        if (method === "GET") {
          const upload = uploads.get(key);
          if (!upload) {
            return new Response("Not found", { status: 404 });
          }

          return Response.json({
            id: crypto.randomUUID(),
            path,
            file_name: path.split("/").pop() ?? path,
            content_type: upload.contentType,
            size: upload.bytes.byteLength,
            url: null,
            status: "active",
            visibility: "project",
            created_at: upload.createdAt,
            updated_at: upload.createdAt,
            deleted_at: null,
          });
        }

        if (method === "DELETE") {
          const existed = uploads.delete(key);
          return new Response(null, { status: existed ? 204 : 404 });
        }
      }
    }

    if (url.origin === "https://upload.test" && method === "PUT") {
      const [, encodedProjectSlug = "", encodedPath = ""] = url.pathname.split("/");
      const projectSlug = decodeURIComponent(encodedProjectSlug);
      const path = decodeURIComponent(encodedPath);
      const key = makeStorageKey(projectSlug, path);
      const pending = pendingUploads.get(key);

      if (!pending) {
        return new Response("Missing pending upload", { status: 404 });
      }

      const bytes = new Uint8Array(await request.arrayBuffer());
      assertEquals(bytes.byteLength, pending.size);

      uploads.set(key, {
        bytes,
        contentType: pending.contentType,
        createdAt: FIXED_NOW.toISOString(),
      });
      pendingUploads.delete(key);

      return new Response(null, { status: 200 });
    }

    if (url.origin === "https://download.test" && method === "GET") {
      const [, encodedProjectSlug = "", encodedPath = ""] = url.pathname.split("/");
      const projectSlug = decodeURIComponent(encodedProjectSlug);
      const path = decodeURIComponent(encodedPath);
      const upload = uploads.get(makeStorageKey(projectSlug, path));

      if (!upload) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(Uint8Array.from(upload.bytes), {
        status: 200,
        headers: { "Content-Type": upload.contentType },
      });
    }

    throw new Error(`Unhandled fetch: ${method} ${url.toString()}`);
  }) as typeof fetch;

  return {
    uploads,
    fetchCalls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("VeryfrontCloudBlobStorage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("stores, retrieves, stats, and deletes blobs via project uploads", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      const ref = await storage.put("Hello cloud blob", {
        mimeType: "text/plain",
        metadata: { source: "test" },
        ttl: 300,
      });

      assertExists(ref.id);
      assertEquals(ref.mimeType, "text/plain");
      assertEquals(ref.size, 16);
      assertExists(ref.expiresAt);
      assertEquals(service.uploads.size, 2);

      const content = await storage.getText(ref.id);
      assertEquals(content, "Hello cloud blob");

      const stat = await storage.stat(ref.id);
      assertExists(stat);
      assertEquals(stat.metadata, { source: "test" });
      assertEquals(stat.mimeType, "text/plain");
      assertEquals(stat.size, 16);
      assertEquals(
        stat.url,
        `https://download.test/demo-project/${encodeURIComponent(`.vf-test/${ref.id}.blob`)}`,
      );
      assertEquals(stat.createdAt.toISOString(), FIXED_NOW.toISOString());
      assertEquals(
        stat.expiresAt?.toISOString(),
        new Date(FIXED_NOW.getTime() + 300_000).toISOString(),
      );

      assertEquals(await storage.exists(ref.id), true);

      await storage.delete(ref.id);

      assertEquals(await storage.getText(ref.id), null);
      assertEquals(await storage.stat(ref.id), null);
      assertEquals(service.uploads.size, 0);

      const firstCreate = service.fetchCalls.find((call) =>
        call.method === "POST" && call.url === "https://api.test/projects/demo-project/uploads"
      );
      assertExists(firstCreate);
      assertEquals(firstCreate.headers.get("Authorization"), "Bearer vf_config_token");
    } finally {
      service.restore();
    }
  });

  it("falls back to upload metadata when the sidecar is missing", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      const ref = await storage.put(new Uint8Array([1, 2, 3]), {
        mimeType: "application/octet-stream",
      });

      service.uploads.delete(makeStorageKey("demo-project", `.vf-test/${ref.id}.meta.json`));

      const stat = await storage.stat(ref.id);
      assertExists(stat);
      assertEquals(stat.size, 3);
      assertEquals(stat.mimeType, "application/octet-stream");
      assertEquals(stat.metadata, undefined);
      assertEquals(stat.expiresAt, undefined);
      assertEquals(
        stat.url,
        `https://download.test/demo-project/${encodeURIComponent(`.vf-test/${ref.id}.blob`)}`,
      );
      assertEquals(await storage.exists(ref.id), true);
    } finally {
      service.restore();
    }
  });

  it("resolves request-scoped auth and project slug without explicit config overrides", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      await runWithRequestContext(
        {
          projectSlug: "request-project",
          token: "vf_request_token",
        },
        async () => {
          const ref = await storage.put("ctx", { mimeType: "text/plain" });
          assertExists(ref.id);
        },
      );

      const createCall = service.fetchCalls.find((call) =>
        call.method === "POST" && call.url === "https://api.test/projects/request-project/uploads"
      );
      assertExists(createCall);
      assertEquals(createCall.headers.get("Authorization"), "Bearer vf_request_token");
    } finally {
      service.restore();
    }
  });

  it("rejects blob IDs containing path traversal sequences", async () => {
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_test",
      projectSlug: "my-project",
    });

    await assertRejects(
      () => storage.put("hello", { id: "../../etc/passwd" }),
      Error,
      "Invalid blob id",
    );

    await assertRejects(
      () => storage.stat("../secret"),
      Error,
      "Invalid blob id",
    );

    await assertRejects(
      () => storage.delete("foo/bar"),
      Error,
      "Invalid blob id",
    );
  });
});
