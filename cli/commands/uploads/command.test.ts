import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildUploadCreateUrl,
  buildUploadSignedUrlPath,
  buildUploadsListUrl,
  deleteUpload,
  downloadUploadToFile,
  listAllUploads,
  resolveUploadOutputPath,
  uploadLocalFileToUploads,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";

function createMockClient(overrides: {
  get?: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post?: (path: string, body?: unknown) => Promise<unknown>;
  delete?: (path: string) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.post?.(path, body) ?? Promise.resolve({}));
      return result as T;
    },
    put: <T>(): Promise<T> => Promise.resolve({} as T),
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: async <T>(path: string): Promise<T> => {
      const result = await (overrides.delete?.(path) ?? Promise.resolve({}));
      return result as T;
    },
  };
}

describe("buildUploadsListUrl", () => {
  it("builds the project uploads endpoint", () => {
    assertEquals(buildUploadsListUrl("my-project"), "/projects/my-project/uploads");
  });
});

describe("buildUploadCreateUrl", () => {
  it("builds the uploads create endpoint", () => {
    assertEquals(buildUploadCreateUrl("my-project"), "/projects/my-project/uploads");
  });
});

describe("buildUploadSignedUrlPath", () => {
  it("encodes nested upload paths", () => {
    assertEquals(
      buildUploadSignedUrlPath("my-project", "contracts/q1 report.pdf"),
      "/projects/my-project/uploads/contracts%2Fq1%20report.pdf/url",
    );
  });
});

describe("listAllUploads", () => {
  it("paginates through upload results", async () => {
    const calls: Array<{ path: string; params?: Record<string, string> }> = [];

    const client = createMockClient({
      get: (path, params) => {
        calls.push({ path, params });
        if (calls.length === 1) {
          return Promise.resolve({
            data: [
              { type: "file", path: "contracts/q1.pdf", file_name: "q1.pdf", size: 10 },
            ],
            page_info: { next: "cursor-2" },
          });
        }

        return Promise.resolve({
          data: [
            { type: "file", path: "contracts/q2.pdf", file_name: "q2.pdf", size: 20 },
          ],
          page_info: { next: null },
        });
      },
    });

    const uploads = await listAllUploads(client, "my-project", {
      path: "contracts/",
      recursive: true,
    });

    assertEquals(uploads.map((upload: { path: string }) => upload.path), [
      "contracts/q1.pdf",
      "contracts/q2.pdf",
    ]);
    assertEquals(calls[0]?.path, "/projects/my-project/uploads");
    assertEquals(calls[0]?.params, { limit: "100", path: "contracts/", recursive: "true" });
    assertEquals(calls[1]?.params, {
      limit: "100",
      path: "contracts/",
      recursive: "true",
      cursor: "cursor-2",
    });
  });
});

describe("resolveUploadOutputPath", () => {
  it("preserves nested paths under the output dir", () => {
    assertStringIncludes(
      resolveUploadOutputPath("contracts/q1.pdf", "/workspace/uploads"),
      "/workspace/uploads/contracts/q1.pdf",
    );
  });

  it("rejects traversal attempts", () => {
    assertThrows(
      () => resolveUploadOutputPath("../secrets.txt", "/workspace/uploads"),
      Error,
      "Invalid upload path",
    );
  });
});

describe("downloadUploadToFile", () => {
  it("downloads signed-url content into the output directory", async () => {
    const originalFetch = globalThis.fetch;
    const tempDir = await Deno.makeTempDir();

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url === "https://signed.example.test/contracts/q1.pdf") {
        return new Response("quarterly report", { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const client = createMockClient({
        get: () =>
          Promise.resolve({
            signed_url: "https://signed.example.test/contracts/q1.pdf",
            expires_at: "2026-03-17T12:00:00.000Z",
          }),
      });

      const result = await downloadUploadToFile(client, "my-project", "contracts/q1.pdf", tempDir);
      const text = await Deno.readTextFile(result.localPath);

      assertStringIncludes(result.localPath, "/contracts/q1.pdf");
      assertEquals(text, "quarterly report");
    } finally {
      globalThis.fetch = originalFetch;
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("uploadLocalFileToUploads", () => {
  it("creates an upload URL then PUTs the local file bytes", async () => {
    const originalFetch = globalThis.fetch;
    const tempDir = await Deno.makeTempDir();
    const localPath = `${tempDir}/q1.pdf`;
    let metadataPath = "";
    let metadataBody: unknown = null;
    let uploadedMethod = "";
    let uploadedHeaders = new Headers();
    let uploadedBytes = 0;

    await Deno.writeTextFile(localPath, "quarterly report");

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url === "https://signed.example.test/upload/q1.pdf") {
        uploadedMethod = init?.method ?? "GET";
        uploadedHeaders = new Headers(init?.headers);
        uploadedBytes = init?.body instanceof Uint8Array ? init.body.byteLength : 0;
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const client = createMockClient({
        post: (path, body) => {
          metadataPath = path;
          metadataBody = body;
          return Promise.resolve({
            file_upload_url: "https://signed.example.test/upload/q1.pdf",
            file_path: "project-123/contracts/q1.pdf",
            upload_id: "upload-123",
            required_headers: {
              "Content-Type": "application/pdf",
            },
          });
        },
      });

      const result = await uploadLocalFileToUploads(
        client,
        "my-project",
        "contracts/q1.pdf",
        localPath,
      );

      assertEquals(metadataPath, "/projects/my-project/uploads");
      assertEquals(metadataBody, {
        file_path: "contracts/q1.pdf",
        content_type: "application/pdf",
        size: 16,
      });
      assertEquals(uploadedMethod, "PUT");
      assertEquals(uploadedHeaders.get("Content-Type"), "application/pdf");
      assertEquals(uploadedBytes, 16);
      assertEquals(result.upload_id, "upload-123");
    } finally {
      globalThis.fetch = originalFetch;
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("deleteUpload", () => {
  it("deletes an upload by path", async () => {
    let capturedPath = "";
    const client = createMockClient({
      delete: (path) => {
        capturedPath = path;
        return Promise.resolve({});
      },
    });

    await deleteUpload(client, "my-project", "contracts/q1.pdf");

    assertEquals(capturedPath, "/projects/my-project/uploads/contracts%2Fq1.pdf");
  });
});
