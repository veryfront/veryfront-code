import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { VeryfrontCloudBlobStorage } from "./veryfront-cloud-storage.ts";
import type { BlobStorage } from "./types.ts";

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
      if (createMatch && method === "GET") {
        const projectSlug = decodeURIComponent(createMatch[1] ?? "");
        const prefix = `${projectSlug}:`;
        const data = [...uploads.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ path: key.slice(prefix.length) }));
        return Response.json({ data });
      }
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

  it("does not advertise partial listing without an exhaustive pagination contract", () => {
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    assertEquals((storage as BlobStorage).list, undefined);
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

  it("removes the primary cloud upload when its metadata sidecar upload fails", async () => {
    const service = createMockUploadService();
    const serviceFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        url.origin === "https://upload.test" && request.method === "PUT" &&
        decodeURIComponent(url.pathname).endsWith(".meta.json")
      ) {
        return new Response("sidecar unavailable", { status: 503 });
      }
      return await serviceFetch(input, init);
    }) as typeof fetch;
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      await assertRejects(
        () => storage.put("payload", { id: "cleanup-id" }),
        Error,
        "Veryfront Cloud upload failed",
      );
      assertEquals(service.uploads.size, 0);
      assertEquals(
        service.fetchCalls.some((call) =>
          call.method === "DELETE" && call.url.includes("cleanup-id.blob")
        ),
        true,
      );
    } finally {
      service.restore();
    }
  });

  it("fails closed when an existing metadata sidecar is corrupt or mismatched", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      const ref = await storage.put("payload", { id: "valid-id" });
      const metadataKey = makeStorageKey(
        "demo-project",
        `.vf-test/${ref.id}.meta.json`,
      );
      const metadataUpload = service.uploads.get(metadataKey);
      assertExists(metadataUpload);

      service.uploads.set(metadataKey, {
        ...metadataUpload,
        bytes: new TextEncoder().encode("{not-json"),
      });
      await assertRejects(
        () => storage.stat(ref.id),
        Error,
        "Invalid cloud blob metadata sidecar",
      );

      service.uploads.set(metadataKey, {
        ...metadataUpload,
        bytes: new TextEncoder().encode(JSON.stringify({
          version: 1,
          id: "different-id",
          size: 7,
          mimeType: "application/octet-stream",
          createdAt: FIXED_NOW.toISOString(),
        })),
      });
      await assertRejects(
        () => storage.stat(ref.id),
        Error,
        "Invalid cloud blob metadata sidecar",
      );
    } finally {
      service.restore();
    }
  });

  it("propagates signed URL failures instead of returning incomplete metadata", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      const ref = await storage.put("payload");
      const serviceFetch = globalThis.fetch;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (
          url.origin === "https://api.test" && request.method === "GET" &&
          url.pathname.endsWith(".blob/url")
        ) {
          return new Response("signing unavailable", { status: 503 });
        }
        return await serviceFetch(input, init);
      }) as typeof fetch;

      await assertRejects(
        () => storage.stat(ref.id),
        Error,
        "Veryfront Cloud request failed",
      );
    } finally {
      service.restore();
    }
  });

  it("validates and snapshots storage inputs before uploading", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      for (const ttl of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => storage.put("payload", { ttl }),
          Error,
          "Blob TTL must be a non-negative safe integer",
        );
      }
      await assertRejects(
        () =>
          storage.put("payload", {
            metadata: { unsafe: 7 } as unknown as Record<string, string>,
          }),
        Error,
        "Blob metadata values must be strings",
      );
      await assertRejects(
        () => storage.put("payload", { mimeType: "" }),
        Error,
        "Blob mimeType must be a non-empty string",
      );

      const metadata = { filename: "original.txt" };
      const ref = await storage.put("payload", { metadata });
      metadata.filename = "mutated.txt";
      assertEquals(ref.metadata, { filename: "original.txt" });
      assertEquals((await storage.stat(ref.id))?.metadata, { filename: "original.txt" });
    } finally {
      service.restore();
    }
  });

  it("rejects hostile public records without invoking hooks or making requests", async () => {
    let hooks = 0;
    const configProxy = new Proxy({}, {
      get() {
        hooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        hooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () =>
        new VeryfrontCloudBlobStorage(
          configProxy as unknown as ConstructorParameters<typeof VeryfrontCloudBlobStorage>[0],
        ),
      Error,
      "non-Proxy plain record",
    );
    assertEquals(hooks, 0);

    const nowProxy = new Proxy(() => FIXED_NOW, {
      apply() {
        hooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => new VeryfrontCloudBlobStorage({ now: nowProxy }),
      Error,
      "non-Proxy function",
    );
    assertEquals(hooks, 0);

    const config = Object.create(null);
    Object.defineProperty(config, "apiToken", {
      enumerable: true,
      get() {
        hooks++;
        return "unsafe";
      },
    });
    assertThrows(
      () => new VeryfrontCloudBlobStorage(config),
      Error,
      "enumerable own data property",
    );
    assertEquals(hooks, 0);

    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://api.test",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
    });
    try {
      const options = Object.create(null);
      Object.defineProperty(options, "metadata", {
        enumerable: true,
        get() {
          hooks++;
          return { unsafe: "secret" };
        },
      });
      await assertRejects(
        () => storage.put("payload", options),
        Error,
        "enumerable own data property",
      );

      const payload = new Proxy(new Blob(["payload"]), {
        get() {
          hooks++;
          throw new Error("must not run");
        },
      });
      await assertRejects(
        () => storage.put(payload),
        Error,
        "non-Proxy",
      );
      assertEquals(hooks, 0);
      assertEquals(service.fetchCalls, []);
    } finally {
      service.restore();
    }
  });

  it("rejects invalid cloud endpoint, prefix, and default timer configuration", async () => {
    const baseConfig = {
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
    };
    await assertRejects(
      () =>
        new VeryfrontCloudBlobStorage({ ...baseConfig, apiBaseUrl: "file:///tmp/api" }).exists(
          "valid",
        ),
      Error,
      "apiBaseUrl is invalid",
    );
    await assertRejects(
      () =>
        new VeryfrontCloudBlobStorage({
          ...baseConfig,
          apiBaseUrl: "https://api.test",
          prefix: "../outside/",
        }).exists("valid"),
      Error,
      "prefix must be a portable relative path",
    );
    await assertRejects(
      () =>
        new VeryfrontCloudBlobStorage({
          ...baseConfig,
          apiBaseUrl: "https://api.test",
          defaultTtl: Number.NaN,
        }).exists("valid"),
      Error,
      "defaultTtl must be a non-negative safe integer",
    );
    await assertRejects(
      () =>
        new VeryfrontCloudBlobStorage({
          ...baseConfig,
          apiBaseUrl: "https://api.test",
          requestTimeout: 0,
        }).exists("valid"),
      Error,
      "requestTimeout",
    );
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

  it("snapshots mutable cloud configuration at construction", async () => {
    const service = createMockUploadService();
    const config = {
      apiBaseUrl: "https://api.test",
      apiToken: "vf_original_token",
      projectSlug: "original-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    };
    const storage = new VeryfrontCloudBlobStorage(config);
    config.apiBaseUrl = "https://mutated.invalid";
    config.apiToken = "vf_mutated_token";
    config.projectSlug = "mutated-project";

    try {
      await storage.put("snapshot", { id: "config-snapshot" });
      const createCall = service.fetchCalls.find((call) => call.method === "POST");
      assertExists(createCall);
      assertEquals(
        createCall.url,
        "https://api.test/projects/original-project/uploads",
      );
      assertEquals(createCall.headers.get("Authorization"), "Bearer vf_original_token");
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
      "Blob IDs must contain only",
    );

    await assertRejects(
      () => storage.stat("../secret"),
      Error,
      "Blob IDs must contain only",
    );

    await assertRejects(
      () => storage.delete("foo/bar"),
      Error,
      "Blob IDs must contain only",
    );
  });
});
