/**
 * Remote File MCP Tools
 *
 * Tools for reading, writing, and managing files in remote Veryfront projects
 * via the REST API. These enable coding agents to edit project files without
 * direct filesystem access.
 *
 * Authentication: Uses the API token from environment or proxy context.
 * API Base: Configurable via VERYFRONT_API_BASE_URL (default: http://api.lvh.me:4000)
 */

import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";
import type { MCPTool } from "./tools.ts";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_API_URL = "http://api.lvh.me:4000";

function getApiBaseUrl(): string {
  return getEnv("VERYFRONT_API_BASE_URL") || DEFAULT_API_URL;
}

function getApiToken(): string | undefined {
  return getEnv("VERYFRONT_API_TOKEN");
}

/**
 * Make an authenticated request to the Veryfront API
 */
async function apiRequest<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    token?: string;
  } = {},
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  const baseUrl = getApiBaseUrl();
  const token = options.token || getApiToken();

  if (!token) {
    return { ok: false, error: "No API token available. Set VERYFRONT_API_TOKEN.", status: 401 };
  }

  const url = `${baseUrl}/api${path}`;

  try {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorText;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}`;
      }
      return { ok: false, error: errorMessage, status: response.status };
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return { ok: true, status: 204 };
    }

    const data = await response.json() as T;
    return { ok: true, data, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error",
      status: 0,
    };
  }
}

/**
 * URL-encode a file path for use in API URLs
 */
function encodeFilePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

// ============================================================================
// Types
// ============================================================================

interface RemoteFile {
  id?: string;
  path: string;
  content: string;
  size: number;
  type: string;
  updated_at: string;
}

interface FileListResponse {
  data: RemoteFile[];
  page_info: {
    has_next_page: boolean;
    has_previous_page: boolean;
    next_cursor?: string;
  };
}

interface SearchResult {
  id?: string;
  path: string;
  matches: Array<{ line: number; content: string }>;
}

interface SearchResponse {
  results: SearchResult[];
  total_files: number;
}

// ============================================================================
// Tool: vf_remote_list_files
// ============================================================================

const remoteListFilesInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  branch: z.string().optional()
    .describe("Branch name (omit for main branch)"),
  pattern: z.string().optional()
    .describe("File pattern filter (e.g., *.tsx, pages/*)"),
  limit: z.number().optional().default(50)
    .describe("Maximum number of files to return (default: 50)"),
});

type RemoteListFilesInput = z.infer<typeof remoteListFilesInput>;

interface RemoteListFilesOutput {
  success: boolean;
  files?: Array<{ path: string; type: string; size: number }>;
  error?: string;
  total?: number;
}

export const vfRemoteListFiles: MCPTool<RemoteListFilesInput, RemoteListFilesOutput> = {
  name: "vf_remote_list_files",
  description:
    "List files in a remote Veryfront project. Returns file paths, types, and sizes. Use this to explore a project's structure.",
  inputSchema: remoteListFilesInput,
  execute: async (input) => {
    const params = new URLSearchParams();
    if (input.pattern) params.set("pattern", input.pattern);
    params.set("limit", String(input.limit));
    params.set("fields", "(path,type,size)"); // Only fetch necessary fields

    const branchPath = input.branch ? `/branches/${input.branch}` : "";
    const path = `/${input.project}${branchPath}/files?${params.toString()}`;

    const result = await apiRequest<FileListResponse>("GET", path);

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    const files = result.data?.data || [];
    return {
      success: true,
      files: files.map((f) => ({ path: f.path, type: f.type, size: f.size })),
      total: files.length,
    };
  },
};

// ============================================================================
// Tool: vf_remote_get_file
// ============================================================================

const remoteGetFileInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  path: z.string()
    .describe("File path (e.g., pages/index.mdx, app/page.tsx)"),
  branch: z.string().optional()
    .describe("Branch name (omit for main branch)"),
});

type RemoteGetFileInput = z.infer<typeof remoteGetFileInput>;

interface RemoteGetFileOutput {
  success: boolean;
  file?: {
    path: string;
    content: string;
    size: number;
    type: string;
  };
  error?: string;
}

export const vfRemoteGetFile: MCPTool<RemoteGetFileInput, RemoteGetFileOutput> = {
  name: "vf_remote_get_file",
  description:
    "Read the content of a file from a remote Veryfront project. Always use this before modifying a file.",
  inputSchema: remoteGetFileInput,
  execute: async (input) => {
    const encodedPath = encodeFilePath(input.path);
    const branchPath = input.branch ? `/branches/${input.branch}` : "";
    const apiPath = `/${input.project}${branchPath}/files/${encodedPath}`;

    const result = await apiRequest<RemoteFile>("GET", apiPath);

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    const file = result.data;
    if (!file) {
      return { success: false, error: "File not found" };
    }

    return {
      success: true,
      file: {
        path: file.path,
        content: file.content,
        size: file.size,
        type: file.type,
      },
    };
  },
};

// ============================================================================
// Tool: vf_remote_update_file
// ============================================================================

const remoteUpdateFileInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  path: z.string()
    .describe("File path (e.g., pages/index.mdx)"),
  content: z.string()
    .describe("New file content"),
  branch: z.string().optional()
    .describe("Branch name (omit for main branch)"),
});

type RemoteUpdateFileInput = z.infer<typeof remoteUpdateFileInput>;

interface RemoteUpdateFileOutput {
  success: boolean;
  path?: string;
  error?: string;
  created?: boolean;
}

export const vfRemoteUpdateFile: MCPTool<RemoteUpdateFileInput, RemoteUpdateFileOutput> = {
  name: "vf_remote_update_file",
  description:
    "Create or update a file in a remote Veryfront project. Always read the file first before updating to understand its current state.",
  inputSchema: remoteUpdateFileInput,
  execute: async (input) => {
    const encodedPath = encodeFilePath(input.path);
    const branchParam = input.branch ? `?branch_id=${input.branch}` : "";
    const apiPath = `/${input.project}/files/${encodedPath}${branchParam}`;

    const result = await apiRequest<{ id: string; path: string }>("PUT", apiPath, {
      body: { content: input.content },
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      path: result.data?.path || input.path,
      created: result.status === 201,
    };
  },
};

// ============================================================================
// Tool: vf_remote_delete_file
// ============================================================================

const remoteDeleteFileInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  path: z.string()
    .describe("File path to delete"),
  branch: z.string().optional()
    .describe("Branch name (omit for main branch)"),
});

type RemoteDeleteFileInput = z.infer<typeof remoteDeleteFileInput>;

interface RemoteDeleteFileOutput {
  success: boolean;
  error?: string;
}

export const vfRemoteDeleteFile: MCPTool<RemoteDeleteFileInput, RemoteDeleteFileOutput> = {
  name: "vf_remote_delete_file",
  description: "Delete a file from a remote Veryfront project.",
  inputSchema: remoteDeleteFileInput,
  execute: async (input) => {
    const encodedPath = encodeFilePath(input.path);
    const branchParam = input.branch ? `?branch_id=${input.branch}` : "";
    const apiPath = `/${input.project}/files/${encodedPath}${branchParam}`;

    const result = await apiRequest<void>("DELETE", apiPath);

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return { success: true };
  },
};

// ============================================================================
// Tool: vf_remote_search_files
// ============================================================================

const remoteSearchFilesInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  query: z.string()
    .describe("Search query (text or regex pattern)"),
  pattern: z.string().optional()
    .describe("File pattern filter (e.g., *.tsx)"),
  is_regex: z.boolean().optional()
    .describe("Treat query as regex (default: false)"),
  case_sensitive: z.boolean().optional()
    .describe("Case sensitive search (default: false)"),
  max_results: z.number().optional().default(50)
    .describe("Maximum results (default: 50)"),
  branch: z.string().optional()
    .describe("Branch name (omit for main branch)"),
});

type RemoteSearchFilesInput = z.infer<typeof remoteSearchFilesInput>;

interface RemoteSearchFilesOutput {
  success: boolean;
  results?: SearchResult[];
  total_files?: number;
  error?: string;
}

export const vfRemoteSearchFiles: MCPTool<RemoteSearchFilesInput, RemoteSearchFilesOutput> = {
  name: "vf_remote_search_files",
  description:
    "Search for text patterns within file contents in a remote Veryfront project. Supports regex and glob patterns.",
  inputSchema: remoteSearchFilesInput,
  execute: async (input) => {
    const branchPath = input.branch ? `/branches/${input.branch}` : "";
    const apiPath = `/${input.project}${branchPath}/files/search`;

    const result = await apiRequest<SearchResponse>("POST", apiPath, {
      body: {
        query: input.query,
        pattern: input.pattern,
        is_regex: input.is_regex,
        case_sensitive: input.case_sensitive,
        max_results: input.max_results,
      },
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      results: result.data?.results || [],
      total_files: result.data?.total_files || 0,
    };
  },
};

// ============================================================================
// Tool: vf_remote_move_file
// ============================================================================

const remoteMoveFileInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  source_path: z.string()
    .describe("Current file path"),
  destination_path: z.string()
    .describe("New file path"),
  branch: z.string().optional()
    .describe("Branch name (omit for main branch)"),
});

type RemoteMoveFileInput = z.infer<typeof remoteMoveFileInput>;

interface RemoteMoveFileOutput {
  success: boolean;
  source_path?: string;
  destination_path?: string;
  error?: string;
}

export const vfRemoteMoveFile: MCPTool<RemoteMoveFileInput, RemoteMoveFileOutput> = {
  name: "vf_remote_move_file",
  description: "Move or rename a file in a remote Veryfront project.",
  inputSchema: remoteMoveFileInput,
  execute: async (input) => {
    const branchParam = input.branch ? `?branch_id=${input.branch}` : "";
    const apiPath = `/${input.project}/files/move${branchParam}`;

    const result = await apiRequest<{ source_path: string; destination_path: string }>(
      "POST",
      apiPath,
      {
        body: {
          source_path: input.source_path,
          destination_path: input.destination_path,
        },
      },
    );

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      source_path: result.data?.source_path || input.source_path,
      destination_path: result.data?.destination_path || input.destination_path,
    };
  },
};

// ============================================================================
// Tool: vf_remote_list_branches
// ============================================================================

const remoteListBranchesInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  search: z.string().optional()
    .describe("Search filter for branch name"),
  status: z.enum(["active", "merged", "all"]).optional().default("all")
    .describe("Filter by branch status (default: all)"),
});

type RemoteListBranchesInput = z.infer<typeof remoteListBranchesInput>;

interface Branch {
  id: string;
  name: string;
  project_id: string;
  base_branch_id?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  merged_at?: string | null;
  merged_by?: string | null;
}

interface RemoteListBranchesOutput {
  success: boolean;
  branches?: Branch[];
  error?: string;
}

export const vfRemoteListBranches: MCPTool<RemoteListBranchesInput, RemoteListBranchesOutput> = {
  name: "vf_remote_list_branches",
  description: "List branches in a remote Veryfront project.",
  inputSchema: remoteListBranchesInput,
  execute: async (input) => {
    const params = new URLSearchParams();
    if (input.search) params.set("search", input.search);
    if (input.status) params.set("status", input.status);

    const path = `/${input.project}/branches?${params.toString()}`;
    const result = await apiRequest<{ data: Branch[] }>("GET", path);

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      branches: result.data?.data || [],
    };
  },
};

// ============================================================================
// Tool: vf_remote_create_branch
// ============================================================================

const remoteCreateBranchInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  name: z.string()
    .describe("Branch name"),
  base_branch_id: z.string().optional()
    .describe("Base branch ID to create from (omit for main branch)"),
});

type RemoteCreateBranchInput = z.infer<typeof remoteCreateBranchInput>;

interface RemoteCreateBranchOutput {
  success: boolean;
  branch?: Branch;
  error?: string;
}

export const vfRemoteCreateBranch: MCPTool<RemoteCreateBranchInput, RemoteCreateBranchOutput> = {
  name: "vf_remote_create_branch",
  description:
    "Create a new branch in a remote Veryfront project. Branch from main by default, or specify a base branch.",
  inputSchema: remoteCreateBranchInput,
  execute: async (input) => {
    const path = `/${input.project}/branches`;
    const result = await apiRequest<Branch>("POST", path, {
      body: {
        name: input.name,
        base_branch_id: input.base_branch_id || null,
      },
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      branch: result.data,
    };
  },
};

// ============================================================================
// Tool: vf_remote_merge_branch
// ============================================================================

const remoteMergeBranchInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  branch_id: z.string()
    .describe("Branch ID to merge"),
  target_branch_id: z.string().optional()
    .describe("Target branch ID to merge into (omit to merge into main)"),
});

type RemoteMergeBranchInput = z.infer<typeof remoteMergeBranchInput>;

interface RemoteMergeBranchOutput {
  success: boolean;
  branch?: Branch;
  merged_documents?: number;
  added_documents?: number;
  deleted_documents?: number;
  error?: string;
}

export const vfRemoteMergeBranch: MCPTool<RemoteMergeBranchInput, RemoteMergeBranchOutput> = {
  name: "vf_remote_merge_branch",
  description: "Merge a branch into the target branch (or main if not specified).",
  inputSchema: remoteMergeBranchInput,
  execute: async (input) => {
    const path = `/${input.project}/branches/${input.branch_id}/merge`;
    const result = await apiRequest<{
      success: boolean;
      branch: Branch;
      merged_documents: number;
      added_documents: number;
      deleted_documents: number;
    }>("POST", path, {
      body: {
        target_branch_id: input.target_branch_id || null,
      },
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      branch: result.data?.branch,
      merged_documents: result.data?.merged_documents,
      added_documents: result.data?.added_documents,
      deleted_documents: result.data?.deleted_documents,
    };
  },
};

// ============================================================================
// Tool: vf_remote_delete_branch
// ============================================================================

const remoteDeleteBranchInput = z.object({
  project: z.string()
    .describe("Project slug or ID"),
  branch_id: z.string()
    .describe("Branch ID to delete"),
});

type RemoteDeleteBranchInput = z.infer<typeof remoteDeleteBranchInput>;

interface RemoteDeleteBranchOutput {
  success: boolean;
  error?: string;
}

export const vfRemoteDeleteBranch: MCPTool<RemoteDeleteBranchInput, RemoteDeleteBranchOutput> = {
  name: "vf_remote_delete_branch",
  description: "Delete a branch from a remote Veryfront project.",
  inputSchema: remoteDeleteBranchInput,
  execute: async (input) => {
    const path = `/${input.project}/branches/${input.branch_id}`;
    const result = await apiRequest<{ success: boolean }>("DELETE", path);

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return { success: true };
  },
};

// ============================================================================
// Tool: vf_remote_create_project
// ============================================================================

const remoteCreateProjectInput = z.object({
  name: z.string()
    .describe("Project name"),
  slug: z.string()
    .describe("Project slug (lowercase letters, numbers, hyphens only)"),
  template: z.string().optional()
    .describe("Template to use (e.g., 'blank', 'blog', 'docs')"),
  is_public: z.boolean().optional()
    .describe("Whether the project is public (default: false)"),
});

type RemoteCreateProjectInput = z.infer<typeof remoteCreateProjectInput>;

interface Project {
  id: string;
  slug: string;
  name: string;
  description?: string;
  is_public?: boolean;
  created_at?: string;
}

interface RemoteCreateProjectOutput {
  success: boolean;
  project?: Project;
  error?: string;
}

export const vfRemoteCreateProject: MCPTool<RemoteCreateProjectInput, RemoteCreateProjectOutput> = {
  name: "vf_remote_create_project",
  description: "Create a new Veryfront project. Returns the project details including ID and slug.",
  inputSchema: remoteCreateProjectInput,
  execute: async (input) => {
    const result = await apiRequest<Project>("POST", "/projects", {
      body: {
        name: input.name,
        slug: input.slug,
        template: input.template,
        isPublic: input.is_public,
      },
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      project: result.data,
    };
  },
};

// ============================================================================
// Tool: vf_remote_clone_project
// ============================================================================

const remoteCloneProjectInput = z.object({
  source_project: z.string()
    .describe("Source project slug or ID to clone from"),
  target_name: z.string()
    .describe("Name for the new project"),
  target_slug: z.string()
    .describe("Slug for the new project (lowercase letters, numbers, hyphens only)"),
  file_pattern: z.string().optional()
    .describe("Optional file pattern to filter which files to clone (e.g., '*.tsx')"),
});

type RemoteCloneProjectInput = z.infer<typeof remoteCloneProjectInput>;

interface RemoteCloneProjectOutput {
  success: boolean;
  project?: Project;
  files_copied?: number;
  error?: string;
}

export const vfRemoteCloneProject: MCPTool<RemoteCloneProjectInput, RemoteCloneProjectOutput> = {
  name: "vf_remote_clone_project",
  description:
    "Clone a Veryfront project by creating a new project and copying all files from the source.",
  inputSchema: remoteCloneProjectInput,
  execute: async (input) => {
    // Step 1: Create the new project
    const createResult = await apiRequest<Project>("POST", "/projects", {
      body: {
        name: input.target_name,
        slug: input.target_slug,
      },
    });

    if (!createResult.ok) {
      return { success: false, error: `Failed to create project: ${createResult.error}` };
    }

    const newProject = createResult.data;
    if (!newProject) {
      return { success: false, error: "Project created but no data returned" };
    }

    // Step 2: List all files from source project
    const params = new URLSearchParams();
    params.set("limit", "1000");
    if (input.file_pattern) params.set("pattern", input.file_pattern);

    const listResult = await apiRequest<FileListResponse>(
      "GET",
      `/${input.source_project}/files?${params.toString()}`,
    );

    if (!listResult.ok) {
      return {
        success: false,
        error: `Project created but failed to list source files: ${listResult.error}`,
        project: newProject,
      };
    }

    const sourceFiles = listResult.data?.data || [];

    // Step 3: Copy each file to the new project
    let filesCopied = 0;
    const errors: string[] = [];

    for (const file of sourceFiles) {
      // Get full file content
      const getResult = await apiRequest<RemoteFile>(
        "GET",
        `/${input.source_project}/files/${encodeFilePath(file.path)}`,
      );

      if (!getResult.ok || !getResult.data) {
        errors.push(`Failed to read ${file.path}`);
        continue;
      }

      // Create file in new project
      const createFileResult = await apiRequest<{ id: string; path: string }>(
        "PUT",
        `/${input.target_slug}/files/${encodeFilePath(file.path)}`,
        { body: { content: getResult.data.content } },
      );

      if (createFileResult.ok) {
        filesCopied++;
      } else {
        errors.push(`Failed to create ${file.path}: ${createFileResult.error}`);
      }
    }

    return {
      success: errors.length === 0,
      project: newProject,
      files_copied: filesCopied,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  },
};

// ============================================================================
// All Remote File Tools
// ============================================================================

export const remoteFileTools: MCPTool[] = [
  // Project operations
  vfRemoteCreateProject,
  vfRemoteCloneProject,
  // File operations
  vfRemoteListFiles,
  vfRemoteGetFile,
  vfRemoteUpdateFile,
  vfRemoteDeleteFile,
  vfRemoteSearchFiles,
  vfRemoteMoveFile,
  // Branch operations
  vfRemoteListBranches,
  vfRemoteCreateBranch,
  vfRemoteMergeBranch,
  vfRemoteDeleteBranch,
];
