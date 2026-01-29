import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  remoteFileTools,
  vfRemoteCloneProject,
  vfRemoteCreateBranch,
  vfRemoteCreateProject,
  vfRemoteDeleteBranch,
  vfRemoteDeleteFile,
  vfRemoteGetFile,
  vfRemoteListBranches,
  vfRemoteListFiles,
  vfRemoteMergeBranch,
  vfRemoteMoveFile,
  vfRemoteSearchFiles,
  vfRemoteUpdateFile,
} from "./remote-file-tools.ts";

describe("cli/mcp/remote-file-tools", () => {
  describe("remoteFileTools array", () => {
    it("should export all remote tools", () => {
      assertEquals(remoteFileTools.length, 12);
    });

    it("should have unique names", () => {
      const names = remoteFileTools.map((t) => t.name);
      const unique = new Set(names);
      assertEquals(names.length, unique.size);
    });

    it("should have name and description for each tool", () => {
      for (const tool of remoteFileTools) {
        assertExists(tool.name);
        assertExists(tool.description);
        assertEquals(typeof tool.name, "string");
        assertEquals(typeof tool.description, "string");
        assertEquals(tool.name.length > 0, true);
        assertEquals(tool.description.length > 0, true);
      }
    });

    it("should have inputSchema for each tool", () => {
      for (const tool of remoteFileTools) {
        assertExists(tool.inputSchema);
        assertEquals(typeof tool.execute, "function");
      }
    });

    it("should include all expected tool names", () => {
      const expectedNames = [
        "vf_remote_create_project",
        "vf_remote_clone_project",
        "vf_remote_list_files",
        "vf_remote_get_file",
        "vf_remote_update_file",
        "vf_remote_delete_file",
        "vf_remote_search_files",
        "vf_remote_move_file",
        "vf_remote_list_branches",
        "vf_remote_create_branch",
        "vf_remote_merge_branch",
        "vf_remote_delete_branch",
      ];
      const actualNames = remoteFileTools.map((t) => t.name);
      for (const name of expectedNames) {
        assertEquals(actualNames.includes(name), true, `Missing tool: ${name}`);
      }
    });
  });

  describe("vfRemoteListFiles", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteListFiles.name, "vf_remote_list_files");
    });

    it("should validate input schema - requires project", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({ project: "my-project" });
      assertEquals(result.success, true);
    });

    it("should validate input schema - rejects empty", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({});
      assertEquals(result.success, false);
    });

    it("should accept optional branch and pattern", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({
        project: "my-project",
        branch: "feature",
        pattern: "*.tsx",
        limit: 10,
      });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.project, "my-project");
        assertEquals(result.data.branch, "feature");
        assertEquals(result.data.pattern, "*.tsx");
        assertEquals(result.data.limit, 10);
      }
    });

    it("should default limit to 50", () => {
      const result = vfRemoteListFiles.inputSchema.safeParse({ project: "my-project" });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.limit, 50);
      }
    });
  });

  describe("vfRemoteGetFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteGetFile.name, "vf_remote_get_file");
    });

    it("should require project and path", () => {
      const valid = vfRemoteGetFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
      });
      assertEquals(valid.success, true);

      const missingPath = vfRemoteGetFile.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingPath.success, false);

      const missingProject = vfRemoteGetFile.inputSchema.safeParse({
        path: "pages/index.tsx",
      });
      assertEquals(missingProject.success, false);
    });

    it("should accept optional branch", () => {
      const result = vfRemoteGetFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
        branch: "dev",
      });
      assertEquals(result.success, true);
    });
  });

  describe("vfRemoteUpdateFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteUpdateFile.name, "vf_remote_update_file");
    });

    it("should require project, path, and content", () => {
      const valid = vfRemoteUpdateFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
        content: "export default function Page() { return <div>Hello</div> }",
      });
      assertEquals(valid.success, true);

      const missingContent = vfRemoteUpdateFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/index.tsx",
      });
      assertEquals(missingContent.success, false);
    });
  });

  describe("vfRemoteDeleteFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteDeleteFile.name, "vf_remote_delete_file");
    });

    it("should require project and path", () => {
      const valid = vfRemoteDeleteFile.inputSchema.safeParse({
        project: "my-project",
        path: "pages/old.tsx",
      });
      assertEquals(valid.success, true);
    });
  });

  describe("vfRemoteSearchFiles", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteSearchFiles.name, "vf_remote_search_files");
    });

    it("should require project and query", () => {
      const valid = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
        query: "useState",
      });
      assertEquals(valid.success, true);

      const missingQuery = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingQuery.success, false);
    });

    it("should accept all optional params", () => {
      const result = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
        query: "useState",
        pattern: "*.tsx",
        is_regex: true,
        case_sensitive: true,
        max_results: 100,
        branch: "feature",
      });
      assertEquals(result.success, true);
    });

    it("should default max_results to 50", () => {
      const result = vfRemoteSearchFiles.inputSchema.safeParse({
        project: "my-project",
        query: "test",
      });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.max_results, 50);
      }
    });
  });

  describe("vfRemoteMoveFile", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteMoveFile.name, "vf_remote_move_file");
    });

    it("should require project, source_path, and destination_path", () => {
      const valid = vfRemoteMoveFile.inputSchema.safeParse({
        project: "my-project",
        source_path: "old/path.tsx",
        destination_path: "new/path.tsx",
      });
      assertEquals(valid.success, true);

      const missingDest = vfRemoteMoveFile.inputSchema.safeParse({
        project: "my-project",
        source_path: "old/path.tsx",
      });
      assertEquals(missingDest.success, false);
    });
  });

  describe("vfRemoteListBranches", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteListBranches.name, "vf_remote_list_branches");
    });

    it("should require project", () => {
      const valid = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(valid.success, true);
    });

    it("should accept optional search and status", () => {
      const result = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
        search: "feature",
        status: "active",
      });
      assertEquals(result.success, true);
    });

    it("should validate status enum", () => {
      const valid = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
        status: "merged",
      });
      assertEquals(valid.success, true);

      const invalid = vfRemoteListBranches.inputSchema.safeParse({
        project: "my-project",
        status: "invalid",
      });
      assertEquals(invalid.success, false);
    });
  });

  describe("vfRemoteCreateBranch", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteCreateBranch.name, "vf_remote_create_branch");
    });

    it("should require project and name", () => {
      const valid = vfRemoteCreateBranch.inputSchema.safeParse({
        project: "my-project",
        name: "feature-branch",
      });
      assertEquals(valid.success, true);

      const missingName = vfRemoteCreateBranch.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingName.success, false);
    });

    it("should accept optional base_branch_id", () => {
      const result = vfRemoteCreateBranch.inputSchema.safeParse({
        project: "my-project",
        name: "feature-branch",
        base_branch_id: "abc123",
      });
      assertEquals(result.success, true);
    });
  });

  describe("vfRemoteMergeBranch", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteMergeBranch.name, "vf_remote_merge_branch");
    });

    it("should require project and branch_id", () => {
      const valid = vfRemoteMergeBranch.inputSchema.safeParse({
        project: "my-project",
        branch_id: "branch-123",
      });
      assertEquals(valid.success, true);

      const missingBranch = vfRemoteMergeBranch.inputSchema.safeParse({
        project: "my-project",
      });
      assertEquals(missingBranch.success, false);
    });
  });

  describe("vfRemoteDeleteBranch", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteDeleteBranch.name, "vf_remote_delete_branch");
    });

    it("should require project and branch_id", () => {
      const valid = vfRemoteDeleteBranch.inputSchema.safeParse({
        project: "my-project",
        branch_id: "branch-123",
      });
      assertEquals(valid.success, true);
    });
  });

  describe("vfRemoteCreateProject", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteCreateProject.name, "vf_remote_create_project");
    });

    it("should require name and slug", () => {
      const valid = vfRemoteCreateProject.inputSchema.safeParse({
        name: "My Project",
        slug: "my-project",
      });
      assertEquals(valid.success, true);

      const missingSlug = vfRemoteCreateProject.inputSchema.safeParse({
        name: "My Project",
      });
      assertEquals(missingSlug.success, false);
    });

    it("should accept optional template and is_public", () => {
      const result = vfRemoteCreateProject.inputSchema.safeParse({
        name: "My Project",
        slug: "my-project",
        template: "blog",
        is_public: true,
      });
      assertEquals(result.success, true);
    });
  });

  describe("vfRemoteCloneProject", () => {
    it("should have correct name", () => {
      assertEquals(vfRemoteCloneProject.name, "vf_remote_clone_project");
    });

    it("should require source_project, target_name, target_slug", () => {
      const valid = vfRemoteCloneProject.inputSchema.safeParse({
        source_project: "source-proj",
        target_name: "Clone Project",
        target_slug: "clone-project",
      });
      assertEquals(valid.success, true);

      const missingTarget = vfRemoteCloneProject.inputSchema.safeParse({
        source_project: "source-proj",
        target_name: "Clone Project",
      });
      assertEquals(missingTarget.success, false);
    });

    it("should accept optional file_pattern", () => {
      const result = vfRemoteCloneProject.inputSchema.safeParse({
        source_project: "source-proj",
        target_name: "Clone Project",
        target_slug: "clone-project",
        file_pattern: "*.tsx",
      });
      assertEquals(result.success, true);
    });
  });

  describe("tool execute without API token", () => {
    it("should return error for list files without token", async () => {
      const result = await vfRemoteListFiles.execute({
        project: "test",
        limit: 50,
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for get file without token", async () => {
      const result = await vfRemoteGetFile.execute({
        project: "test",
        path: "index.tsx",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for delete file without token", async () => {
      const result = await vfRemoteDeleteFile.execute({
        project: "test",
        path: "index.tsx",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for move file without token", async () => {
      const result = await vfRemoteMoveFile.execute({
        project: "test",
        source_path: "a.tsx",
        destination_path: "b.tsx",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for list branches without token", async () => {
      const result = await vfRemoteListBranches.execute({
        project: "test",
        status: "all",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for create branch without token", async () => {
      const result = await vfRemoteCreateBranch.execute({
        project: "test",
        name: "feature",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for merge branch without token", async () => {
      const result = await vfRemoteMergeBranch.execute({
        project: "test",
        branch_id: "branch-1",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for delete branch without token", async () => {
      const result = await vfRemoteDeleteBranch.execute({
        project: "test",
        branch_id: "branch-1",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it("should return error for create project without token", async () => {
      const result = await vfRemoteCreateProject.execute({
        name: "Test",
        slug: "test",
      });
      assertEquals(result.success, false);
      assertExists(result.error);
    });
  });
});
