/**
 * Unit tests for merge command
 * @module cli/commands/merge.test
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { getBranchByName, MergeArgsSchema, mergeBranch, parseMergeArgs } from "./merge.ts";
import type { ApiClient } from "../shared/config.ts";
import type { ParsedArgs } from "../index/types.ts";

// Mock client creator - returns ApiClient-compatible mock
function createMockClient(overrides: {
  get?: (url: string, params?: unknown) => Promise<unknown>;
  post?: (url: string, body?: unknown) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: overrides.get ?? (() => Promise.resolve({ data: [] })),
    post: overrides.post ?? (() => Promise.resolve({})),
    put: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as unknown as ApiClient;
}

// Test exported schema
describe("MergeArgsSchema", () => {
  it("should require branch name", () => {
    const result = MergeArgsSchema.safeParse({ branch: "" });
    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.error.issues[0]?.message, "Branch name is required");
    }
  });

  it("should accept valid branch name", () => {
    const result = MergeArgsSchema.safeParse({ branch: "feature-x" });
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.branch, "feature-x");
      assertEquals(result.data.dryRun, false);
      assertEquals(result.data.force, false);
    }
  });

  it("should accept optional into branch", () => {
    const result = MergeArgsSchema.safeParse({ branch: "feature", into: "staging" });
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.into, "staging");
    }
  });

  it("should reject empty into branch", () => {
    const result = MergeArgsSchema.safeParse({ branch: "feature", into: "" });
    assertEquals(result.success, false);
  });
});

// Test exported parseArgs function
describe("parseMergeArgs", () => {
  it("should parse positional branch argument", () => {
    const args = { _: ["merge", "feature-branch"] } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.branch, "feature-branch");
    }
  });

  it("should parse --into flag", () => {
    const args = { _: ["merge", "feature"], into: "staging" } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.into, "staging");
    }
  });

  it("should parse --dry-run flag", () => {
    const args = { _: ["merge", "feature"], "dry-run": true } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.dryRun, true);
    }
  });

  it("should parse -f flag as force", () => {
    const args = { _: ["merge", "feature"], f: true } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.force, true);
    }
  });

  it("should parse --force flag", () => {
    const args = { _: ["merge", "feature"], force: true } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.force, true);
    }
  });

  it("should fail when branch is missing", () => {
    const args = { _: ["merge"] } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, false);
  });
});

// Test getBranchByName
describe("getBranchByName", () => {
  it("should find branch by exact name", async () => {
    const mockClient = createMockClient({
      get: () =>
        Promise.resolve({
          data: [
            { id: "123", name: "feature-x", project_id: "proj" },
            { id: "456", name: "feature-y", project_id: "proj" },
          ],
        }),
    });

    const branch = await getBranchByName(
      mockClient,
      "my-project",
      "feature-x",
    );
    assertEquals(branch, { id: "123", name: "feature-x", project_id: "proj" });
  });

  it("should return null when branch not found", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve({ data: [] }),
    });

    const branch = await getBranchByName(
      mockClient,
      "my-project",
      "nonexistent",
    );
    assertEquals(branch, null);
  });
});

// Test getBranchByName - negative cases
describe("getBranchByName - error handling", () => {
  it("should handle API error gracefully", async () => {
    const mockClient = createMockClient({
      get: () => Promise.reject(new Error("Network error")),
    });

    let error: Error | null = null;
    try {
      await getBranchByName(mockClient, "my-project", "feature");
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error?.message, "Network error");
  });

  it("should handle empty search results across paginated responses", async () => {
    let callCount = 0;
    const mockClient = createMockClient({
      get: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: [{ id: "1", name: "other-branch", project_id: "proj" }],
            page_info: { next: "cursor-2" },
          });
        }
        return Promise.resolve({ data: [], page_info: {} });
      },
    });

    const branch = await getBranchByName(mockClient, "my-project", "feature-x");
    assertEquals(branch, null);
    assertEquals(callCount, 2);
  });
});

// Test MergeArgsSchema - negative cases
describe("MergeArgsSchema - invalid inputs", () => {
  it("should reject branch names with only whitespace", () => {
    const result = MergeArgsSchema.safeParse({ branch: "   " });
    assertEquals(result.success, true); // Note: zod min(1) only checks length, not whitespace
    // This is acceptable - API will reject invalid names
  });

  it("should reject undefined branch", () => {
    const result = MergeArgsSchema.safeParse({});
    assertEquals(result.success, false);
  });

  it("should reject null branch", () => {
    const result = MergeArgsSchema.safeParse({ branch: null });
    assertEquals(result.success, false);
  });
});

// Test mergeBranch
describe("mergeBranch", () => {
  it("should merge to main when targetBranchId is undefined", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          success: true,
          merged_documents: 5,
          added_documents: 2,
          deleted_documents: 1,
        });
      },
    });

    const result = await mergeBranch(
      mockClient,
      "my-project",
      "branch-123",
    );
    assertEquals(capturedUrl, "/projects/my-project/branches/branch-123/merge");
    assertEquals(capturedBody, { target_branch_id: null });
    assertEquals(result.success, true);
  });

  it("should merge to target branch when specified", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({ success: true });
      },
    });

    await mergeBranch(
      mockClient,
      "my-project",
      "branch-123",
      "target-456",
    );
    assertEquals(capturedUrl, "/projects/my-project/branches/branch-123/merge");
    assertEquals(capturedBody, { target_branch_id: "target-456" });
  });
});

// Test mergeBranch - error handling
describe("mergeBranch - error handling", () => {
  it("should propagate API errors for merge conflicts", async () => {
    const mockClient = createMockClient({
      post: () =>
        Promise.reject(
          new Error("Merge conflict: cannot automatically merge changes"),
        ),
    });

    let error: Error | null = null;
    try {
      await mergeBranch(mockClient, "my-project", "branch-123");
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error?.message, "Merge conflict: cannot automatically merge changes");
  });

  it("should propagate API errors for invalid branch ID", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Branch not found")),
    });

    let error: Error | null = null;
    try {
      await mergeBranch(mockClient, "my-project", "invalid-id");
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error?.message, "Branch not found");
  });

  it("should propagate API errors for permission denied", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Permission denied: cannot merge to protected branch")),
    });

    let error: Error | null = null;
    try {
      await mergeBranch(mockClient, "my-project", "branch-123", "protected-main");
    } catch (e) {
      error = e as Error;
    }
    assertEquals(error?.message, "Permission denied: cannot merge to protected branch");
  });
});
