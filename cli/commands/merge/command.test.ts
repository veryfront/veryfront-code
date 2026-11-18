import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for merge command
 * @module cli/commands/merge.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getBranchByName, MergeArgsSchema, mergeBranch, parseMergeArgs } from "./index.ts";
import {
  buildMergeTargetSyncFiles,
  getMergePreview,
  receiptNamesProject,
  selectMergeTargetBaselinePaths,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";

function createMockClient(
  overrides: {
    get?: (url: string, params?: unknown) => Promise<unknown>;
    post?: (url: string, body?: unknown) => Promise<unknown>;
  } = {},
): ApiClient {
  return {
    get: overrides.get ?? (() => Promise.resolve({ data: [] })),
    post: overrides.post ?? (() => Promise.resolve({})),
    put: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as ApiClient;
}

async function captureError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

describe("MergeArgsSchema", () => {
  it("should require branch name", () => {
    const result = MergeArgsSchema.safeParse({ branch: "" });
    assertEquals(result.success, false);

    if (result.success) return;
    assertEquals(result.error.issues[0]?.message, "Branch name is required");
  });

  it("should accept valid branch name", () => {
    const result = MergeArgsSchema.safeParse({ branch: "feature-x" });
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.branch, "feature-x");
    assertEquals(result.data.dryRun, false);
    assertEquals(result.data.force, false);
  });

  it("should accept optional into branch", () => {
    const result = MergeArgsSchema.safeParse({ branch: "feature", into: "staging" });
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.into, "staging");
  });

  it("should reject empty into branch", () => {
    const result = MergeArgsSchema.safeParse({ branch: "feature", into: "" });
    assertEquals(result.success, false);
  });
});

describe("parseMergeArgs", () => {
  it("should parse positional branch argument", () => {
    const args = { _: ["merge", "feature-branch"] } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.branch, "feature-branch");
  });

  it("should parse --into flag", () => {
    const args = { _: ["merge", "feature"], into: "staging" } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.into, "staging");
  });

  it("should parse --dry-run flag", () => {
    const args = { _: ["merge", "feature"], "dry-run": true } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.dryRun, true);
  });

  it("should parse -f flag as force", () => {
    const args = { _: ["merge", "feature"], f: true } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.force, true);
  });

  it("should parse --force flag", () => {
    const args = { _: ["merge", "feature"], force: true } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, true);

    if (!result.success) return;
    assertEquals(result.data.force, true);
  });

  it("should fail when branch is missing", () => {
    const args = { _: ["merge"] } as ParsedArgs;
    const result = parseMergeArgs(args);
    assertEquals(result.success, false);
  });
});

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

    const branch = await getBranchByName(mockClient, "my-project", "feature-x");
    assertEquals(branch, { id: "123", name: "feature-x", project_id: "proj" });
  });

  it("should return null when branch not found", async () => {
    const mockClient = createMockClient({
      get: () => Promise.resolve({ data: [] }),
    });

    const branch = await getBranchByName(mockClient, "my-project", "nonexistent");
    assertEquals(branch, null);
  });
});

describe("getBranchByName - error handling", () => {
  it("should handle API error gracefully", async () => {
    const mockClient = createMockClient({
      get: () => Promise.reject(new Error("Network error")),
    });

    const error = await captureError(() => getBranchByName(mockClient, "my-project", "feature"));
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

describe("MergeArgsSchema - invalid inputs", () => {
  it("should reject branch names with only whitespace", () => {
    const result = MergeArgsSchema.safeParse({ branch: "   " });
    assertEquals(result.success, true);
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

    const result = await mergeBranch(mockClient, "my-project", "branch-123");
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

    await mergeBranch(mockClient, "my-project", "branch-123", "target-456");
    assertEquals(capturedUrl, "/projects/my-project/branches/branch-123/merge");
    assertEquals(capturedBody, { target_branch_id: "target-456" });
  });
});

describe("mergeBranch - error handling", () => {
  it("should propagate API errors for merge conflicts", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Merge conflict: cannot automatically merge changes")),
    });

    const error = await captureError(() => mergeBranch(mockClient, "my-project", "branch-123"));
    assertEquals(error?.message, "Merge conflict: cannot automatically merge changes");
  });

  it("should propagate API errors for invalid branch ID", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Branch not found")),
    });

    const error = await captureError(() => mergeBranch(mockClient, "my-project", "invalid-id"));
    assertEquals(error?.message, "Branch not found");
  });

  it("should propagate API errors for permission denied", async () => {
    const mockClient = createMockClient({
      post: () => Promise.reject(new Error("Permission denied: cannot merge to protected branch")),
    });

    const error = await captureError(() =>
      mergeBranch(mockClient, "my-project", "branch-123", "protected-main")
    );
    assertEquals(error?.message, "Permission denied: cannot merge to protected branch");
  });
});

describe("merge command path encoding", () => {
  it("URL-encodes the project slug when listing branches", async () => {
    const requests: Array<{ url: string; params?: unknown }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: unknown) => {
        requests.push({ url, params });
        return Promise.resolve({ data: [] });
      },
    });

    await getBranchByName(mockClient, "my project/x", "feature-x");

    assertEquals(requests, [
      {
        url: "/projects/my%20project%2Fx/branches",
        params: { search: "feature-x", limit: "100" },
      },
    ]);
  });

  it("follows page_info.next with the same search and limit", async () => {
    const requests: Array<{ url: string; params?: unknown }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: unknown) => {
        requests.push({ url, params });
        if (requests.length === 1) {
          return Promise.resolve({
            data: [{ id: "1", name: "feature-x-old", project_id: "proj" }],
            page_info: { next: "cursor-2" },
          });
        }
        return Promise.resolve({
          data: [{ id: "2", name: "feature-x", project_id: "proj" }],
        });
      },
    });

    const branch = await getBranchByName(mockClient, "my-project", "feature-x");

    assertEquals(branch?.id, "2");
    assertEquals(requests, [
      { url: "/projects/my-project/branches", params: { search: "feature-x", limit: "100" } },
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100", cursor: "cursor-2" },
      },
    ]);
  });

  it("URL-encodes the project slug and branch ID when merging", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({ success: true });
      },
    });

    await mergeBranch(mockClient, "my project/x", "branch/1?x=y");

    assertEquals(capturedUrl, "/projects/my%20project%2Fx/branches/branch%2F1%3Fx%3Dy/merge");
    assertEquals(capturedBody, { target_branch_id: null });
  });

  it("URL-encodes the project slug and branch ID for the merge preview", async () => {
    const requests: Array<{ url: string; params?: unknown }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: unknown) => {
        requests.push({ url, params });
        return Promise.resolve({ diffs: [{ file_path: "app/page.tsx", has_conflicts: false }] });
      },
    });

    const diffs = await getMergePreview(mockClient, "my project/x", "branch/1?x=y", "target-456");

    assertEquals(diffs, [{ file_path: "app/page.tsx", has_conflicts: false }]);
    assertEquals(requests, [
      {
        url: "/projects/my%20project%2Fx/branches/branch%2F1%3Fx%3Dy/merge-preview",
        params: { target_branch_id: "target-456" },
      },
    ]);
  });

  it("keeps the merge preview URL and query unchanged for plain identifiers", async () => {
    const requests: Array<{ url: string; params?: unknown }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: unknown) => {
        requests.push({ url, params });
        return Promise.resolve({ diffs: [] });
      },
    });

    await getMergePreview(mockClient, "my-project", "branch-123");

    assertEquals(requests, [
      { url: "/projects/my-project/branches/branch-123/merge-preview", params: {} },
    ]);
  });
});

describe("buildMergeTargetSyncFiles", () => {
  it("takes digests and versions from the target for the given paths only", async () => {
    const files = [
      { path: "app/page.tsx", content: "page\n", version_id: "v1" },
      { path: "veryfront.json", content: "{}\n" },
      { path: "app/remote-only.tsx", content: "remote\n", version_id: "v3" },
    ];

    const baseline = await buildMergeTargetSyncFiles(
      ["app/page.tsx", "veryfront.json", "app/missing.tsx"],
      files,
    );

    // A file the directory never pushed, and a path the target does not hold,
    // stay out of the baseline.
    assertEquals(Object.keys(baseline).sort(), ["app/page.tsx", "veryfront.json"]);
    assertEquals(baseline["app/page.tsx"]?.versionId, "v1");
    assertEquals(baseline["veryfront.json"]?.versionId, undefined);
    assertEquals(/^sha256:|^[0-9a-f]{64}$/.test(baseline["app/page.tsx"]?.digest ?? ""), true);
    assertEquals(await buildMergeTargetSyncFiles([], files), {});
  });
});

describe("receiptNamesProject", () => {
  const receipt = { projectId: "550e8400-e29b-41d4-a716-446655440000", projectSlug: "desk" };

  it("matches the resolved project id when the configuration knows it", () => {
    assertEquals(
      receiptNamesProject(receipt, { projectSlug: "x", projectId: receipt.projectId }),
      true,
    );
    assertEquals(receiptNamesProject(receipt, { projectSlug: "desk", projectId: "other" }), false);
  });

  it("matches a slug, or a project id given where the slug goes", () => {
    assertEquals(receiptNamesProject(receipt, { projectSlug: "desk" }), true);
    assertEquals(receiptNamesProject(receipt, { projectSlug: receipt.projectId }), true);
    assertEquals(receiptNamesProject(receipt, { projectSlug: "other" }), false);
  });
});

describe("selectMergeTargetBaselinePaths", () => {
  it("keeps a source baseline to the paths this directory pushed", () => {
    // The push recorded a remote-only file in its baseline; a later local edit
    // to that path must still conflict on the merge target.
    assertEquals(
      selectMergeTargetBaselinePaths({
        sourceBaselinePaths: ["app/page.tsx", "app/remote-only.tsx"],
        localPaths: ["app/page.tsx", "veryfront.json"],
        targetHasBaseline: true,
      }),
      ["app/page.tsx"],
    );
  });

  it("uses the whole source baseline when the receipt lists no local paths", () => {
    assertEquals(
      selectMergeTargetBaselinePaths({
        sourceBaselinePaths: ["app/page.tsx", "app/other.tsx"],
        localPaths: undefined,
        targetHasBaseline: false,
      }),
      ["app/page.tsx", "app/other.tsx"],
    );
  });

  it("replaces a stale target baseline when the source has none", () => {
    assertEquals(
      selectMergeTargetBaselinePaths({
        sourceBaselinePaths: null,
        localPaths: ["app/page.tsx"],
        targetHasBaseline: true,
      }),
      ["app/page.tsx"],
    );
    assertEquals(
      selectMergeTargetBaselinePaths({
        sourceBaselinePaths: null,
        localPaths: undefined,
        targetHasBaseline: true,
      }),
      [],
    );
  });

  it("leaves a target without a baseline when neither branch has one", () => {
    assertEquals(
      selectMergeTargetBaselinePaths({
        sourceBaselinePaths: null,
        localPaths: ["app/page.tsx"],
        targetHasBaseline: false,
      }),
      null,
    );
  });
});
