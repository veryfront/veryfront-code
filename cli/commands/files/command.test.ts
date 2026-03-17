import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildRemoteFileUrl,
  deleteRemoteFile,
  getRemoteFile,
  listRemoteFiles,
  putRemoteFileFromLocal,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";

function createMockClient(overrides: {
  get?: (path: string, params?: Record<string, string>) => Promise<unknown>;
  put?: (path: string, body?: unknown) => Promise<unknown>;
  delete?: (path: string) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: <T>(): Promise<T> => Promise.resolve({} as T),
    put: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.put?.(path, body) ?? Promise.resolve({ path }));
      return result as T;
    },
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: async <T>(path: string): Promise<T> => {
      const result = await (overrides.delete?.(path) ?? Promise.resolve({}));
      return result as T;
    },
  };
}

describe("buildRemoteFileUrl", () => {
  it("encodes project file paths", () => {
    assertEquals(
      buildRemoteFileUrl("my-project", "knowledge/contracts/q1-report.md"),
      "/projects/my-project/files/knowledge%2Fcontracts%2Fq1-report.md",
    );
  });
});

describe("listRemoteFiles", () => {
  it("lists remote files and filters by prefix when requested", async () => {
    const client = createMockClient({
      get: () =>
        Promise.resolve({
          data: [
            { path: "knowledge/q1.md", size: 10, type: "file", created_at: "", updated_at: "" },
            { path: "src/index.ts", size: 10, type: "file", created_at: "", updated_at: "" },
          ],
          page_info: { next: null },
        }),
    });

    const files = await listRemoteFiles(client, "my-project", { path: "knowledge/" });

    assertEquals(files.map((file: { path: string }) => file.path), ["knowledge/q1.md"]);
  });
});

describe("getRemoteFile", () => {
  it("reads remote file content from the project files API", async () => {
    let capturedPath = "";
    const client = createMockClient({
      get: (path) => {
        capturedPath = path;
        return Promise.resolve({ path: "knowledge/q1.md", content: "# Q1\n", size: 5 });
      },
    });

    const content = await getRemoteFile(client, "my-project", "knowledge/q1.md");

    assertEquals(capturedPath, "/projects/my-project/files/knowledge%2Fq1.md");
    assertEquals(content, "# Q1\n");
  });
});

describe("putRemoteFileFromLocal", () => {
  it("reads a local file and uploads it to the project files API", async () => {
    let capturedPath = "";
    let capturedBody: unknown = null;
    const tempDir = await Deno.makeTempDir();
    const localPath = `${tempDir}/q1-report.md`;

    await Deno.writeTextFile(localPath, "# Q1 Report\n");

    try {
      const client = createMockClient({
        put: (path, body) => {
          capturedPath = path;
          capturedBody = body;
          return Promise.resolve({ path: "knowledge/q1-report.md" });
        },
      });

      const result = await putRemoteFileFromLocal(
        client,
        "my-project",
        "knowledge/q1-report.md",
        localPath,
      );

      assertEquals(capturedPath, "/projects/my-project/files/knowledge%2Fq1-report.md");
      assertEquals(capturedBody, { content: "# Q1 Report\n" });
      assertEquals(result.path, "knowledge/q1-report.md");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("deleteRemoteFile", () => {
  it("deletes a remote project file", async () => {
    let capturedPath = "";
    const client = createMockClient({
      delete: (path) => {
        capturedPath = path;
        return Promise.resolve({});
      },
    });

    await deleteRemoteFile(client, "my-project", "knowledge/q1-report.md");

    assertEquals(capturedPath, "/projects/my-project/files/knowledge%2Fq1-report.md");
  });
});
