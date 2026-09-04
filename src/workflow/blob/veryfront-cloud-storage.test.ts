import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { VeryfrontCloudBlobStorage } from "./veryfront-cloud-storage.ts";

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

async function beforeDeadline<T>(operation: Promise<T>, timeoutMs = 250): Promise<T> {
  let timeout: number | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Operation exceeded the test deadline")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function makeStorageKey(projectSlug: string, path: string): string {
  return `${projectSlug}:${path}`;
}

function createMockUploadService(
  options: { failMetadataSidecarUpload?: boolean } = {},
) {
  const uploads = new Map<string, StoredUpload>();
  const pendingUploads = new Map<string, PendingUpload>();
  const fetchCalls: FetchCallRecord[] = [];

  installMockFetch(
    (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const headers = new Headers(request.headers);

      fetchCalls.push({
        url: url.toString(),
        method,
        headers,
      });

      if (url.origin === "https://93.184.216.34") {
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
            file_upload_url: `https://93.184.216.35/${encodeURIComponent(projectSlug)}/${
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
            signed_url: `https://93.184.216.36/${encodeURIComponent(projectSlug)}/${
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

      if (url.origin === "https://93.184.216.35" && method === "PUT") {
        const [, encodedProjectSlug = "", encodedPath = ""] = url.pathname.split("/");
        const projectSlug = decodeURIComponent(encodedProjectSlug);
        const path = decodeURIComponent(encodedPath);
        const key = makeStorageKey(projectSlug, path);
        const pending = pendingUploads.get(key);

        if (!pending) {
          return new Response("Missing pending upload", { status: 404 });
        }

        if (options.failMetadataSidecarUpload && path.endsWith(".meta.json")) {
          return new Response("Sidecar storage unavailable", { status: 500 });
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

      if (url.origin === "https://93.184.216.36" && method === "GET") {
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
    }) as typeof fetch,
  );

  return {
    uploads,
    fetchCalls,
    restore() {
      restoreMockFetch();
    },
  };
}

describe("VeryfrontCloudBlobStorage", () => {
  it("does not expose ambient credential resolution as a runtime method", () => {
    const storage = new VeryfrontCloudBlobStorage();
    assertEquals((storage as unknown as Record<string, unknown>).resolveConfig, undefined);
    assertEquals((storage as unknown as Record<string, unknown>).requestJson, undefined);
  });

  afterEach(() => {
    restoreMockFetch();
  });

  it("stores, retrieves, stats, and deletes blobs via project uploads", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
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
        `https://93.184.216.36/demo-project/${encodeURIComponent(`.vf-test/${ref.id}.blob`)}`,
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
        call.method === "POST" && call.url === "https://93.184.216.34/projects/demo-project/uploads"
      );
      assertExists(firstCreate);
      assertEquals(firstCreate.headers.get("Authorization"), "Bearer vf_config_token");
    } finally {
      service.restore();
    }
  });

  it("deletes the primary upload when the metadata sidecar fails", async () => {
    const service = createMockUploadService({ failMetadataSidecarUpload: true });
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      await assertRejects(
        () => storage.put("Hello cloud blob", { mimeType: "text/plain" }),
        Error,
        undefined,
        "put must not resolve when the sidecar upload fails",
      );

      assertEquals(
        service.uploads.size,
        0,
        "the primary blob must be cleaned up after a sidecar failure",
      );
    } finally {
      service.restore();
    }
  });

  it("lists stored blobs (newest first) with sidecar filenames", async () => {
    const service = createMockUploadService();
    let clock = FIXED_NOW;
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => clock,
    });

    try {
      const first = await storage.put("one", {
        mimeType: "text/plain",
        metadata: { filename: "first.txt" },
      });
      clock = new Date(FIXED_NOW.getTime() + 60_000);
      const second = await storage.put("two", {
        mimeType: "text/plain",
        metadata: { filename: "second.txt" },
      });

      const refs = await storage.list();

      // Both data blobs surface (the `.meta.json` sidecars are filtered out),
      // enriched with the original filename from each sidecar.
      assertEquals(refs.length, 2);
      assertEquals(
        refs.map((ref) => ref.id),
        [second.id, first.id],
        "list must return the newest blob first",
      );
      const byId = new Map(refs.map((ref) => [ref.id, ref]));
      assertEquals(byId.get(first.id)?.metadata?.filename, "first.txt");
      assertEquals(byId.get(second.id)?.metadata?.filename, "second.txt");
      assertExists(byId.get(first.id)?.url);

      const listCall = service.fetchCalls.find((call) =>
        call.method === "GET" && call.url === "https://93.184.216.34/projects/demo-project/uploads"
      );
      assertExists(listCall);
    } finally {
      service.restore();
    }
  });

  it("returns an empty list when nothing is stored", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_config_token",
      projectSlug: "demo-project",
      prefix: ".vf-test/",
      now: () => FIXED_NOW,
    });

    try {
      assertEquals(await storage.list(), []);
    } finally {
      service.restore();
    }
  });

  it("falls back to upload metadata when the sidecar is missing", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
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
        `https://93.184.216.36/demo-project/${encodeURIComponent(`.vf-test/${ref.id}.blob`)}`,
      );
      assertEquals(await storage.exists(ref.id), true);
    } finally {
      service.restore();
    }
  });

  it("keeps explicit blob endpoints paired with their explicit credential", async () => {
    const service = createMockUploadService();
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_scoped_token",
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
        call.method === "POST" &&
        call.url === "https://93.184.216.34/projects/request-project/uploads"
      );
      assertExists(createCall);
      assertEquals(createCall.headers.get("Authorization"), "Bearer vf_scoped_token");
    } finally {
      service.restore();
    }
  });

  it("never pairs host credentials with a source-selected cloud endpoint", async () => {
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://93.184.216.34");
    Deno.env.set("VERYFRONT_API_TOKEN", "host-token");
    let fetchCalls = 0;
    installMockFetch(
      (() => {
        fetchCalls++;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch,
    );

    try {
      await runWithVeryfrontCloudContext(
        {
          apiBaseUrl: "https://93.184.216.35",
          projectSlug: "tenant-project",
        },
        async () => {
          const storage = new VeryfrontCloudBlobStorage();
          await assertRejects(
            () => storage.put("secret"),
            Error,
            "VeryfrontCloudBlobStorage requires auth",
          );
        },
      );
      assertEquals(fetchCalls, 0);
    } finally {
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
    }
  });

  it("rejects blob IDs containing path traversal sequences", async () => {
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
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

  it("times out and cancels a stalled signed-download body", async () => {
    let cancelled = false;
    installMockFetch(
      ((input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.origin === "https://93.184.216.34") {
          return Promise.resolve(Response.json({
            signed_url: "https://93.184.216.35/download",
            expires_at: FIXED_NOW.toISOString(),
          }));
        }
        return Promise.resolve(
          new Response(
            new ReadableStream({
              pull: () => new Promise<void>(() => {}),
              cancel() {
                cancelled = true;
              },
            }),
          ),
        );
      }) as typeof fetch,
    );
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_test",
      projectSlug: "project",
      requestTimeoutMs: 5,
    });

    await assertRejects(() => storage.getText("blob-id"), Error, "timed out");
    assertEquals(cancelled, true);
  });

  it("rejects oversized signed-download bodies", async () => {
    installMockFetch(
      ((input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.origin === "https://93.184.216.34") {
          return Promise.resolve(Response.json({
            signed_url: "https://93.184.216.35/download",
            expires_at: FIXED_NOW.toISOString(),
          }));
        }
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4, 5])));
      }) as typeof fetch,
    );
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_test",
      projectSlug: "project",
      maxResponseBytes: 4,
    });

    await assertRejects(() => storage.getBytes("blob-id"), RangeError, "exceeds 4 bytes");
  });

  it("rejects known-size uploads before opening a network request", async () => {
    let fetchCalls = 0;
    installMockFetch(
      (() => {
        fetchCalls++;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch,
    );
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_test",
      projectSlug: "project",
      maxUploadBytes: 4,
    });

    for (
      const data of [
        "12345",
        new Uint8Array([1, 2, 3, 4, 5]),
        new Blob([new Uint8Array([1, 2, 3, 4, 5])]),
      ]
    ) {
      await assertRejects(
        () => storage.put(data),
        Error,
        "upload exceeds 4 bytes",
      );
    }
    assertEquals(fetchCalls, 0);
  });

  it("bounds and cancels streamed upload preprocessing", async () => {
    let cancelled = false;
    let fetchCalls = 0;
    installMockFetch(
      (() => {
        fetchCalls++;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch,
    );
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_test",
      projectSlug: "project",
      maxUploadBytes: 5,
    });

    await assertRejects(() => storage.put(input), Error, "Blob upload exceeds 5 bytes");
    assertEquals(cancelled, true);
    assertEquals(fetchCalls, 0);
  });

  it("does not await a project stream cancellation that never settles", async () => {
    let cancelCalls = 0;
    let fetchCalls = 0;
    installMockFetch(
      (() => {
        fetchCalls++;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch,
    );
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
      cancel() {
        cancelCalls++;
        return new Promise<void>(() => {});
      },
    });
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_test",
      projectSlug: "project",
      maxUploadBytes: 1,
    });

    await beforeDeadline(
      assertRejects(() => storage.put(input), Error, "Blob upload exceeds 1 bytes"),
    );
    assertEquals(cancelCalls, 1);
    assertEquals(fetchCalls, 0);
  });

  it("bounds blob identity and metadata before consuming the upload stream", async () => {
    let getterCalls = 0;
    const accessorMetadata = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unexpected";
      },
    });
    const accessorOptions = Object.defineProperty({}, "id", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unexpected";
      },
    });
    const cases: Array<{ options: Record<string, unknown>; message: string }> = [
      {
        options: { id: "a".repeat(257) },
        message: "Blob IDs must contain at most 256",
      },
      {
        options: { mimeType: "x".repeat(1_025) },
        message: "Blob mimeType exceeds 1024 bytes",
      },
      {
        options: {
          metadata: Object.fromEntries(
            Array.from({ length: 129 }, (_, index) => [`key-${index}`, "value"]),
          ),
        },
        message: "Blob metadata must contain at most 128 entries",
      },
      {
        options: { metadata: { key: "x".repeat(8 * 1024 + 1) } },
        message: 'Blob metadata value for "key" exceeds 8192 bytes',
      },
      {
        options: { metadata: accessorMetadata },
        message: "Blob metadata must contain enumerable data properties only",
      },
      {
        options: accessorOptions,
        message: 'Blob storage option "id" must be a data property',
      },
    ];

    for (const testCase of cases) {
      let pulls = 0;
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(new Response("unexpected"));
        }) as typeof fetch,
      );
      const input = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const storage = new VeryfrontCloudBlobStorage({
        apiBaseUrl: "https://93.184.216.34",
        apiToken: "vf_test",
        projectSlug: "project",
      });

      await assertRejects(
        () => storage.put(input, testCase.options as never),
        Error,
        testCase.message,
      );
      assertEquals(pulls, 0);
      assertEquals(fetchCalls, 0);
    }
    assertEquals(getterCalls, 0);
  });

  it("times out and cancels a stalled upload stream before network access", async () => {
    let cancelled = false;
    let fetchCalls = 0;
    installMockFetch(
      (() => {
        fetchCalls++;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch,
    );
    const input = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel() {
        cancelled = true;
      },
    });
    const storage = new VeryfrontCloudBlobStorage({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "vf_test",
      projectSlug: "project",
      requestTimeoutMs: 5,
    });

    await assertRejects(() => storage.put(input), Error, "timed out");
    assertEquals(cancelled, true);
    assertEquals(fetchCalls, 0);
  });
});
