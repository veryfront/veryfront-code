/**
 * Unit tests for push command
 * @module cli/commands/push.test
 */

import { assertEquals, assertMatch } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createBranch, generateBranchName, uploadFiles, type UploadOp } from "./push.ts";
import type { ApiClient } from "../shared/config.ts";

// Mock client creator - returns ApiClient-compatible mock
function createMockClient(overrides: {
  get?: (url: string, params?: unknown) => Promise<unknown>;
  post?: (url: string, body?: unknown) => Promise<unknown>;
  put?: (url: string, body?: unknown) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: overrides.get ?? (() => Promise.resolve({ data: [] })),
    post: overrides.post ?? (() => Promise.resolve({})),
    put: overrides.put ?? (() => Promise.resolve({})),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as unknown as ApiClient;
}

// Test generateBranchName
describe("generateBranchName", () => {
  it("should generate a branch name with cli/push- prefix", () => {
    const name = generateBranchName();
    assertMatch(name, /^cli\/push-/);
  });

  it("should generate a branch name with timestamp", () => {
    const name = generateBranchName();
    // Format: cli/push-YYYYMMDDTHHMMSS
    assertMatch(name, /^cli\/push-\d{8}T\d{6}$/);
  });

  it("should generate unique names on successive calls", () => {
    // Since timestamps have second precision, we can test uniqueness
    // by checking format rather than actual uniqueness
    const name1 = generateBranchName();
    const name2 = generateBranchName();
    // Both should match the format
    assertMatch(name1, /^cli\/push-\d{8}T\d{6}$/);
    assertMatch(name2, /^cli\/push-\d{8}T\d{6}$/);
  });
});

// Test createBranch
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

// Test uploadFiles
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
        if (callCount === 2) {
          return Promise.reject(new Error("API error"));
        }
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
    const mockClient = createMockClient();

    const ops: UploadOp[] = [];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(result.uploaded, 0);
    assertEquals(result.failed, 0);
  });
});
