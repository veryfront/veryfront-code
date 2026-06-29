import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for push command
 * @module cli/commands/push.test
 */

import { assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createBranch,
  ensureBranch,
  generateBranchName,
  resolvePushRemoteFiles,
  uploadFiles,
  type UploadOp,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";

type MockClientOverrides = Partial<{
  get: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  put: (path: string, body?: unknown) => Promise<unknown>;
}>;

function createMockClient(overrides: MockClientOverrides = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.post?.(path, body) ?? Promise.resolve({}));
      return result as T;
    },
    put: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.put?.(path, body) ?? Promise.resolve({}));
      return result as T;
    },
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: <T>(): Promise<T> => Promise.resolve({} as T),
  };
}

describe("generateBranchName", () => {
  it("should generate a branch name with push- prefix", () => {
    const name = generateBranchName();
    assertMatch(name, /^push-/);
  });

  it("should generate a branch name with timestamp", () => {
    const name = generateBranchName();
    assertMatch(name, /^push-\d{8}T\d{6}$/);
  });

  it("should generate unique names on successive calls", () => {
    const name1 = generateBranchName();
    const name2 = generateBranchName();
    assertMatch(name1, /^push-\d{8}T\d{6}$/);
    assertMatch(name2, /^push-\d{8}T\d{6}$/);
  });
});

describe("createBranch", () => {
  it("should call POST with correct URL and body", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          id: "branch-123",
          name: "feature-x",
          projectId: "proj-456",
        });
      },
    });

    const result = await createBranch(mockClient, "my-project", "feature-x");

    assertEquals(capturedUrl, "/projects/my-project/branches");
    assertEquals(capturedBody, { name: "feature-x" });
    assertEquals(result.id, "branch-123");
    assertEquals(result.name, "feature-x");
  });

  it("should handle branch names with special characters", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({
          id: "branch-123",
          name: "feature/new-stuff",
          projectId: "proj-456",
        });
      },
    });

    await createBranch(mockClient, "my-project", "feature/new-stuff");

    assertEquals(capturedBody, { name: "feature/new-stuff" });
  });
});

describe("ensureBranch", () => {
  it("creates a branch when it does not already exist", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        requests.push({ method: "POST", url, body });
        return Promise.resolve({
          id: "branch-created",
          name: "feature-x",
          projectId: "proj-456",
        });
      },
    });

    const result = await ensureBranch(mockClient, "my-project", "feature-x");

    assertEquals(result.id, "branch-created");
    assertEquals(result.name, "feature-x");
    assertEquals(requests, [
      {
        method: "POST",
        url: "/projects/my-project/branches",
        body: { name: "feature-x" },
      },
    ]);
  });

  it("returns an existing branch after a create conflict", async () => {
    const getRequests: Array<{ url: string; params?: Record<string, string> }> = [];
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const mockClient = createMockClient({
      post: () => Promise.reject(conflict),
      get: (url: string, params?: Record<string, string>) => {
        getRequests.push({ url, params });
        return Promise.resolve({
          data: [
            { id: "other-branch", name: "feature-x-old", project_id: "proj-456" },
            { id: "branch-existing", name: "feature-x", project_id: "proj-456" },
          ],
        });
      },
    });

    const result = await ensureBranch(mockClient, "my-project", "feature-x");

    assertEquals(result.id, "branch-existing");
    assertEquals(result.name, "feature-x");
    assertEquals(getRequests, [
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100" },
      },
    ]);
  });

  it("rethrows a create conflict when the existing branch cannot be found", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const mockClient = createMockClient({
      post: () => Promise.reject(conflict),
      get: () => Promise.resolve({ data: [] }),
    });

    const error = await assertRejects(
      () => ensureBranch(mockClient, "my-project", "feature-x"),
      Error,
      "conflict",
    );

    assertEquals((error as Error & { status?: number }).status, 409);
  });

  it("rethrows non-conflict create failures without branch lookup", async () => {
    let getCalls = 0;
    const serverError = Object.assign(new Error("server unavailable"), { status: 503 });
    const mockClient = createMockClient({
      post: () => Promise.reject(serverError),
      get: () => {
        getCalls++;
        return Promise.resolve({ data: [] });
      },
    });

    await assertRejects(
      () => ensureBranch(mockClient, "my-project", "feature-x"),
      Error,
      "server unavailable",
    );
    assertEquals(getCalls, 0);
  });
});

describe("resolvePushRemoteFiles", () => {
  it("uses main files when pushing to main", async () => {
    let getCalls = 0;
    const mockClient = createMockClient({
      get: () => {
        getCalls++;
        return Promise.resolve({ data: [] });
      },
    });
    const mainFiles = [{ path: "app/page.tsx" }];

    const result = await resolvePushRemoteFiles(mockClient, "my-project", "main", mainFiles);

    assertEquals(result.branchId, null);
    assertEquals(result.source, { type: "main" });
    assertEquals(result.remoteFiles, mainFiles);
    assertEquals(getCalls, 0);
  });

  it("uses main files when a named branch does not exist yet", async () => {
    const getRequests: Array<{ url: string; params?: Record<string, string> }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: Record<string, string>) => {
        getRequests.push({ url, params });
        return Promise.resolve({ data: [] });
      },
    });
    const mainFiles = [{ path: "app/page.tsx" }];

    const result = await resolvePushRemoteFiles(
      mockClient,
      "my-project",
      "feature-x",
      mainFiles,
    );

    assertEquals(result.branchId, null);
    assertEquals(result.source, { type: "main" });
    assertEquals(result.remoteFiles, mainFiles);
    assertEquals(getRequests, [
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100" },
      },
    ]);
  });

  it("uses branch files when the named branch already exists", async () => {
    const getRequests: Array<{ url: string; params?: Record<string, string> }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: Record<string, string>) => {
        getRequests.push({ url, params });
        if (url === "/projects/my-project/branches") {
          return Promise.resolve({
            data: [
              { id: "branch-existing", name: "feature-x", project_id: "proj-456" },
            ],
          });
        }
        return Promise.resolve({
          data: [
            { path: "app/page.tsx", size: 12, type: "file", created_at: "", updated_at: "" },
            { path: "stale.ts", size: 8, type: "file", created_at: "", updated_at: "" },
          ],
        });
      },
    });

    const result = await resolvePushRemoteFiles(
      mockClient,
      "my-project",
      "feature-x",
      [{ path: "app/page.tsx" }],
    );

    assertEquals(result.branchId, "branch-existing");
    assertEquals(result.source, { type: "branch", name: "feature-x" });
    assertEquals(result.remoteFiles.map((file) => file.path), ["app/page.tsx", "stale.ts"]);
    assertEquals(getRequests, [
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100" },
      },
      {
        url: "/projects/my-project/files?branch=feature-x",
        params: { limit: "100", sort_by: "updated_at", sort_order: "desc" },
      },
    ]);
  });
});

describe("uploadFiles", () => {
  it("should upload files to branch endpoint when branchId is provided", async () => {
    const capturedUrls: string[] = [];
    const capturedBodies: unknown[] = [];

    const mockClient = createMockClient({
      put: (url: string, body?: unknown) => {
        capturedUrls.push(url);
        capturedBodies.push(body);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "export default function Home() {}" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(capturedUrls.length, 1);
    assertEquals(
      capturedUrls[0],
      "/projects/my-project/files/pages%2Findex.tsx?branch_id=branch-123",
    );
    assertEquals(capturedBodies[0], { content: "export default function Home() {}" });
    assertEquals(result.uploaded, 1);
    assertEquals(result.failed, 0);
  });

  it("should upload files to main endpoint when branchId is null", async () => {
    const capturedUrls: string[] = [];

    const mockClient = createMockClient({
      put: (url: string) => {
        capturedUrls.push(url);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "export default function Home() {}" },
    ];

    const result = await uploadFiles(mockClient, "my-project", null, ops, false);

    assertEquals(capturedUrls.length, 1);
    assertEquals(capturedUrls[0], "/projects/my-project/files/pages%2Findex.tsx");
    assertEquals(result.uploaded, 1);
    assertEquals(result.failed, 0);
  });

  it("should handle multiple files", async () => {
    const capturedUrls: string[] = [];

    const mockClient = createMockClient({
      put: (url: string) => {
        capturedUrls.push(url);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "content1" },
      { path: "pages/about.tsx", content: "content2" },
      { path: "api/users.ts", content: "content3" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(capturedUrls.length, 3);
    assertEquals(result.uploaded, 3);
    assertEquals(result.failed, 0);
  });

  it("should encode file paths with special characters", async () => {
    const capturedUrls: string[] = [];

    const mockClient = createMockClient({
      put: (url: string) => {
        capturedUrls.push(url);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/[id]/index.tsx", content: "content" },
    ];

    const result = await uploadFiles(mockClient, "my-project", null, ops, false);

    assertEquals(capturedUrls[0], "/projects/my-project/files/pages%2F%5Bid%5D%2Findex.tsx");
    assertEquals(result.uploaded, 1);
  });

  it("should handle dry run without making API calls", async () => {
    let putCalled = false;

    const mockClient = createMockClient({
      put: () => {
        putCalled = true;
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "content" },
      { path: "pages/about.tsx", content: "content2" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, true);

    assertEquals(putCalled, false);
    assertEquals(result.uploaded, 2);
    assertEquals(result.failed, 0);
  });

  it("should count failed uploads correctly", async () => {
    let callCount = 0;

    const mockClient = createMockClient({
      put: () => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error("API error"));
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "content1" },
      { path: "pages/about.tsx", content: "content2" },
      { path: "pages/contact.tsx", content: "content3" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(result.uploaded, 2);
    assertEquals(result.failed, 1);
  });

  it("should handle empty ops array", async () => {
    const mockClient = createMockClient({
      put: () => Promise.resolve({}),
    });

    const result = await uploadFiles(mockClient, "my-project", "branch-123", [], false);

    assertEquals(result.uploaded, 0);
    assertEquals(result.failed, 0);
  });
});
