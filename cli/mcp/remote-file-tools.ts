/**
 * Remote File MCP Tools
 *
 * Tools for reading, writing, and managing files in remote Veryfront projects
 * via the REST API. These enable coding agents to edit project files without
 * direct filesystem access.
 *
 * Authentication: Uses the API token from environment or proxy context.
 * API Base: Configurable via VERYFRONT_API_BASE_URL (default: https://api.veryfront.com)
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "./tools.ts";
import { getEnvironmentConfig } from "veryfront/config";
import { withSpan } from "veryfront/observability/otlp-setup";
import { randomSuffix } from "#cli/shared/slug";

import { DEFAULT_LOCAL_API_URL } from "#cli/shared/constants";
import {
  buildProjectApiPath,
  buildProjectFilePath,
  getBranchParam,
  slugToName,
} from "./remote-file-tool-helpers.ts";

function getApiBaseUrl(): string {
  return getEnvironmentConfig().apiBaseUrl || DEFAULT_LOCAL_API_URL;
}

function getApiToken(): string | undefined {
  return getEnvironmentConfig().apiToken;
}

async function apiRequest<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  const token = options.token ?? getApiToken();
  if (!token) {
    return { ok: false, error: "No API token available. Set VERYFRONT_API_TOKEN.", status: 401 };
  }

  const url = `${getApiBaseUrl()}/api${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText || `HTTP ${response.status}`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
      } catch {
        // ignore JSON parse errors
      }

      return { ok: false, error: errorMessage, status: response.status };
    }

    if (response.status === 204) return { ok: true, status: 204 };

    return { ok: true, data: (await response.json()) as T, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error",
      status: 0,
    };
  }
}

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

interface Project {
  id: string;
  slug: string;
  name: string;
  description?: string;
  is_public?: boolean;
  created_at?: string;
}

const MAX_SLUG_ATTEMPTS = 10;

/**
 * Create a project with slug conflict retry.
 * On 409, appends a random suffix and retries (matches reserveProjectSlug behavior).
 * Name is derived from the base slug (without random suffix) for readability.
 */
async function createProjectWithRetry(
  slug: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Project; slug: string } | { ok: false; error: string }> {
  const name = slugToName(slug);
  let currentSlug = slug;

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const result = await apiRequest<Project>("POST", "/projects", {
      body: { ...body, slug: currentSlug, name },
    });

    if (result.ok && result.data) {
      return { ok: true, data: result.data, slug: currentSlug };
    }

    if (result.status !== 409) {
      return { ok: false, error: result.error ?? "Failed to create project" };
    }

    currentSlug = `${slug}-${randomSuffix()}`;
  }

  return { ok: false, error: `Could not find available slug after ${MAX_SLUG_ATTEMPTS} attempts` };
}

// ============================================================================
// Tool: vf_remote_list_files
// ============================================================================

const getRemoteListFilesInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    branch: v.string().optional().describe("Branch name (omit for main branch)"),
    pattern: v.string().optional().describe("File pattern filter (e.g., *.tsx, pages/*)"),
    limit: v.number().optional().default(50).describe(
      "Maximum number of files to return (default: 50)",
    ),
  })
);
const remoteListFilesInput = lazySchema(getRemoteListFilesInput);

type RemoteListFilesInput = InferSchema<ReturnType<typeof getRemoteListFilesInput>>;

interface RemoteListFilesOutput {
  success: boolean;
  files?: Array<{ path: string; type: string; size: number }>;
  error?: string;
  total?: number;
}

export const vfRemoteListFiles: MCPTool<RemoteListFilesInput, RemoteListFilesOutput> = {
  name: "vf_remote_list_files",
  title: "List Remote Files",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "List files in a remote Veryfront project. Returns file paths, types, and sizes. Use this to explore a project's structure.",
  inputSchema: remoteListFilesInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_remote_list_files",
      async () => {
        const params = new URLSearchParams();
        if (input.pattern) params.set("pattern", input.pattern);
        params.set("limit", String(input.limit));
        params.set("fields", "(path,type,size)");

        const apiPath = `${
          buildProjectApiPath(input.project, "files", input.branch)
        }?${params.toString()}`;
        const result = await apiRequest<FileListResponse>("GET", apiPath);
        if (!result.ok) return { success: false, error: result.error };

        const files = result.data?.data ?? [];
        return {
          success: true,
          files: files.map((f) => ({ path: f.path, type: f.type, size: f.size })),
          total: files.length,
        };
      },
      { "tool.project": input.project },
    ),
};

// ============================================================================
// Tool: vf_remote_get_file
// ============================================================================

const getRemoteGetFileInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    path: v.string().describe("File path (e.g., pages/index.mdx, app/page.tsx)"),
    branch: v.string().optional().describe("Branch name (omit for main branch)"),
  })
);
const remoteGetFileInput = lazySchema(getRemoteGetFileInput);

type RemoteGetFileInput = InferSchema<ReturnType<typeof getRemoteGetFileInput>>;

interface RemoteGetFileOutput {
  success: boolean;
  file?: { path: string; content: string; size: number; type: string };
  error?: string;
}

export const vfRemoteGetFile: MCPTool<RemoteGetFileInput, RemoteGetFileOutput> = {
  name: "vf_remote_get_file",
  title: "Get Remote File",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Read the content of a file from a remote Veryfront project. Always use this before modifying a file.",
  inputSchema: remoteGetFileInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_remote_get_file",
      async () => {
        const apiPath = buildProjectFilePath(input.project, input.path, input.branch);
        const result = await apiRequest<RemoteFile>("GET", apiPath);
        if (!result.ok) return { success: false, error: result.error };

        const file = result.data;
        if (!file) return { success: false, error: "File not found" };

        return {
          success: true,
          file: { path: file.path, content: file.content, size: file.size, type: file.type },
        };
      },
      { "tool.project": input.project, "tool.path": input.path },
    ),
};

// ============================================================================
// Tool: vf_remote_update_file
// ============================================================================

const getRemoteUpdateFileInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    path: v.string().describe("File path (e.g., pages/index.mdx)"),
    content: v.string().describe("New file content"),
    branch: v.string().optional().describe("Branch name (omit for main branch)"),
  })
);
const remoteUpdateFileInput = lazySchema(getRemoteUpdateFileInput);

type RemoteUpdateFileInput = InferSchema<ReturnType<typeof getRemoteUpdateFileInput>>;

interface RemoteUpdateFileOutput {
  success: boolean;
  path?: string;
  error?: string;
  created?: boolean;
}

export const vfRemoteUpdateFile: MCPTool<RemoteUpdateFileInput, RemoteUpdateFileOutput> = {
  name: "vf_remote_update_file",
  title: "Update Remote File",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Create or update a file in a remote Veryfront project. Always read the file first before updating to understand its current state.",
  inputSchema: remoteUpdateFileInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_remote_update_file",
      async () => {
        const apiPath = `${buildProjectFilePath(input.project, input.path)}${
          getBranchParam(input.branch)
        }`;
        const result = await apiRequest<{ id: string; path: string }>("PUT", apiPath, {
          body: { content: input.content },
        });

        if (!result.ok) return { success: false, error: result.error };

        return {
          success: true,
          path: result.data?.path ?? input.path,
          created: result.status === 201,
        };
      },
      { "tool.project": input.project, "tool.path": input.path },
    ),
};

// ============================================================================
// Tool: vf_remote_delete_file
// ============================================================================

const getRemoteDeleteFileInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    path: v.string().describe("File path to delete"),
    branch: v.string().optional().describe("Branch name (omit for main branch)"),
  })
);
const remoteDeleteFileInput = lazySchema(getRemoteDeleteFileInput);

type RemoteDeleteFileInput = InferSchema<ReturnType<typeof getRemoteDeleteFileInput>>;

interface RemoteDeleteFileOutput {
  success: boolean;
  error?: string;
}

export const vfRemoteDeleteFile: MCPTool<RemoteDeleteFileInput, RemoteDeleteFileOutput> = {
  name: "vf_remote_delete_file",
  title: "Delete Remote File",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: "Delete a file from a remote Veryfront project.",
  inputSchema: remoteDeleteFileInput,
  execute: async (input) => {
    const apiPath = `${buildProjectFilePath(input.project, input.path)}${
      getBranchParam(input.branch)
    }`;
    const result = await apiRequest<void>("DELETE", apiPath);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true };
  },
};

// ============================================================================
// Tool: vf_remote_search_files
// ============================================================================

const getRemoteSearchFilesInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    query: v.string().describe("Search query (text or regex pattern)"),
    pattern: v.string().optional().describe("File pattern filter (e.g., *.tsx)"),
    is_regex: v.boolean().optional().describe("Treat query as regex (default: false)"),
    case_sensitive: v.boolean().optional().describe("Case sensitive search (default: false)"),
    max_results: v.number().optional().default(50).describe("Maximum results (default: 50)"),
    branch: v.string().optional().describe("Branch name (omit for main branch)"),
  })
);
const remoteSearchFilesInput = lazySchema(getRemoteSearchFilesInput);

type RemoteSearchFilesInput = InferSchema<ReturnType<typeof getRemoteSearchFilesInput>>;

interface RemoteSearchFilesOutput {
  success: boolean;
  results?: SearchResult[];
  total_files?: number;
  error?: string;
}

export const vfRemoteSearchFiles: MCPTool<RemoteSearchFilesInput, RemoteSearchFilesOutput> = {
  name: "vf_remote_search_files",
  title: "Search Remote Files",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Search for text patterns within file contents in a remote Veryfront project. Supports regex and glob patterns.",
  inputSchema: remoteSearchFilesInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_remote_search_files",
      async () => {
        const apiPath = buildProjectApiPath(input.project, "files/search", input.branch);
        const result = await apiRequest<SearchResponse>("POST", apiPath, {
          body: {
            query: input.query,
            pattern: input.pattern,
            is_regex: input.is_regex,
            case_sensitive: input.case_sensitive,
            max_results: input.max_results,
          },
        });

        if (!result.ok) return { success: false, error: result.error };

        return {
          success: true,
          results: result.data?.results ?? [],
          total_files: result.data?.total_files ?? 0,
        };
      },
      { "tool.project": input.project, "tool.query": input.query },
    ),
};

// ============================================================================
// Tool: vf_remote_move_file
// ============================================================================

const getRemoteMoveFileInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    source_path: v.string().describe("Current file path"),
    destination_path: v.string().describe("New file path"),
    branch: v.string().optional().describe("Branch name (omit for main branch)"),
  })
);
const remoteMoveFileInput = lazySchema(getRemoteMoveFileInput);

type RemoteMoveFileInput = InferSchema<ReturnType<typeof getRemoteMoveFileInput>>;

interface RemoteMoveFileOutput {
  success: boolean;
  source_path?: string;
  destination_path?: string;
  error?: string;
}

export const vfRemoteMoveFile: MCPTool<RemoteMoveFileInput, RemoteMoveFileOutput> = {
  name: "vf_remote_move_file",
  title: "Move Remote File",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description: "Move or rename a file in a remote Veryfront project.",
  inputSchema: remoteMoveFileInput,
  execute: async (input) => {
    const apiPath = `${buildProjectApiPath(input.project, "files/move")}${
      getBranchParam(
        input.branch,
      )
    }`;
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

    if (!result.ok) return { success: false, error: result.error };

    return {
      success: true,
      source_path: result.data?.source_path ?? input.source_path,
      destination_path: result.data?.destination_path ?? input.destination_path,
    };
  },
};

// ============================================================================
// Tool: vf_remote_list_branches
// ============================================================================

const getRemoteListBranchesInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    search: v.string().optional().describe("Search filter for branch name"),
    status: v.enum(["active", "merged", "all"]).optional().default("all").describe(
      "Filter by branch status (default: all)",
    ),
  })
);
const remoteListBranchesInput = lazySchema(getRemoteListBranchesInput);

type RemoteListBranchesInput = InferSchema<ReturnType<typeof getRemoteListBranchesInput>>;

interface RemoteListBranchesOutput {
  success: boolean;
  branches?: Branch[];
  error?: string;
}

export const vfRemoteListBranches: MCPTool<RemoteListBranchesInput, RemoteListBranchesOutput> = {
  name: "vf_remote_list_branches",
  title: "List Remote Branches",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description: "List branches in a remote Veryfront project.",
  inputSchema: remoteListBranchesInput,
  execute: async (input) => {
    const params = new URLSearchParams();
    if (input.search) params.set("search", input.search);
    if (input.status) params.set("status", input.status);

    const apiPath = `/${input.project}/branches?${params.toString()}`;
    const result = await apiRequest<{ data: Branch[] }>("GET", apiPath);
    if (!result.ok) return { success: false, error: result.error };

    return { success: true, branches: result.data?.data ?? [] };
  },
};

// ============================================================================
// Tool: vf_remote_create_branch
// ============================================================================

const getRemoteCreateBranchInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    name: v.string().describe("Branch name"),
    base_branch_id: v.string().optional().describe(
      "Base branch ID to create from (omit for main branch)",
    ),
  })
);
const remoteCreateBranchInput = lazySchema(getRemoteCreateBranchInput);

type RemoteCreateBranchInput = InferSchema<ReturnType<typeof getRemoteCreateBranchInput>>;

interface RemoteCreateBranchOutput {
  success: boolean;
  branch?: Branch;
  error?: string;
}

export const vfRemoteCreateBranch: MCPTool<RemoteCreateBranchInput, RemoteCreateBranchOutput> = {
  name: "vf_remote_create_branch",
  title: "Create Remote Branch",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description:
    "Create a new branch in a remote Veryfront project. Branch from main by default, or specify a base branch.",
  inputSchema: remoteCreateBranchInput,
  execute: async (input) => {
    const result = await apiRequest<Branch>("POST", `/${input.project}/branches`, {
      body: { name: input.name, base_branch_id: input.base_branch_id || null },
    });

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, branch: result.data };
  },
};

// ============================================================================
// Tool: vf_remote_merge_branch
// ============================================================================

const getRemoteMergeBranchInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    branch_id: v.string().describe("Branch ID to merge"),
    target_branch_id: v.string().optional().describe(
      "Target branch ID to merge into (omit to merge into main)",
    ),
  })
);
const remoteMergeBranchInput = lazySchema(getRemoteMergeBranchInput);

type RemoteMergeBranchInput = InferSchema<ReturnType<typeof getRemoteMergeBranchInput>>;

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
  title: "Merge Remote Branch",
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  description: "Merge a branch into the target branch (or main if not specified).",
  inputSchema: remoteMergeBranchInput,
  execute: async (input) => {
    const apiPath = `/${input.project}/branches/${input.branch_id}/merge`;
    const result = await apiRequest<{
      success: boolean;
      branch: Branch;
      merged_documents: number;
      added_documents: number;
      deleted_documents: number;
    }>("POST", apiPath, {
      body: { target_branch_id: input.target_branch_id || null },
    });

    if (!result.ok) return { success: false, error: result.error };

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

const getRemoteDeleteBranchInput = defineSchema((v) =>
  v.object({
    project: v.string().describe("Project slug or ID"),
    branch_id: v.string().describe("Branch ID to delete"),
  })
);
const remoteDeleteBranchInput = lazySchema(getRemoteDeleteBranchInput);

type RemoteDeleteBranchInput = InferSchema<ReturnType<typeof getRemoteDeleteBranchInput>>;

interface RemoteDeleteBranchOutput {
  success: boolean;
  error?: string;
}

export const vfRemoteDeleteBranch: MCPTool<RemoteDeleteBranchInput, RemoteDeleteBranchOutput> = {
  name: "vf_remote_delete_branch",
  title: "Delete Remote Branch",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: "Delete a branch from a remote Veryfront project.",
  inputSchema: remoteDeleteBranchInput,
  execute: async (input) => {
    const result = await apiRequest<{ success: boolean }>(
      "DELETE",
      `/${input.project}/branches/${input.branch_id}`,
    );

    if (!result.ok) return { success: false, error: result.error };
    return { success: true };
  },
};

// ============================================================================
// Tool: vf_remote_create_project
// ============================================================================

const getRemoteCreateProjectInput = defineSchema((v) =>
  v.object({
    slug: v.string().describe(
      "Project slug (lowercase letters, numbers, hyphens only). A random suffix is appended if the slug is already taken.",
    ),
    templateSlug: v.string().optional().describe(
      "Template project slug to fork from (e.g., 'blank', 'ai-agent', 'docs-agent')",
    ),
    is_public: v.boolean().optional().describe("Whether the project is public (default: false)"),
  })
);
const remoteCreateProjectInput = lazySchema(getRemoteCreateProjectInput);

type RemoteCreateProjectInput = InferSchema<ReturnType<typeof getRemoteCreateProjectInput>>;

interface RemoteCreateProjectOutput {
  success: boolean;
  project?: Project;
  error?: string;
}

export const vfRemoteCreateProject: MCPTool<RemoteCreateProjectInput, RemoteCreateProjectOutput> = {
  name: "vf_remote_create_project",
  title: "Create Remote Project",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description: "Create a new Veryfront project. Returns the project details including ID and slug.",
  inputSchema: remoteCreateProjectInput,
  execute: async (input) => {
    const result = await createProjectWithRetry(input.slug, {
      templateSlug: input.templateSlug,
      isPublic: input.is_public,
    });

    if (!result.ok) return { success: false, error: result.error };
    return { success: true, project: result.data };
  },
};

// ============================================================================
// Tool: vf_remote_clone_project
// ============================================================================

const getRemoteCloneProjectInput = defineSchema((v) =>
  v.object({
    source_project: v.string().describe("Source project slug or ID to clone from"),
    target_slug: v.string().describe(
      "Slug for the new project (lowercase letters, numbers, hyphens only). A random suffix is appended if the slug is already taken.",
    ),
    file_pattern: v.string().optional().describe(
      "Optional file pattern to filter which files to clone (e.g., '*.tsx')",
    ),
  })
);
const remoteCloneProjectInput = lazySchema(getRemoteCloneProjectInput);

type RemoteCloneProjectInput = InferSchema<ReturnType<typeof getRemoteCloneProjectInput>>;

interface RemoteCloneProjectOutput {
  success: boolean;
  project?: Project;
  files_copied?: number;
  error?: string;
}

export const vfRemoteCloneProject: MCPTool<RemoteCloneProjectInput, RemoteCloneProjectOutput> = {
  name: "vf_remote_clone_project",
  title: "Clone Remote Project",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description:
    "Clone a Veryfront project by creating a new project and copying all files from the source.",
  inputSchema: remoteCloneProjectInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_remote_clone_project",
      async () => {
        const createResult = await createProjectWithRetry(input.target_slug, {});

        if (!createResult.ok) {
          return { success: false, error: `Failed to create project: ${createResult.error}` };
        }

        const newProject = createResult.data;
        if (!newProject) return { success: false, error: "Project created but no data returned" };

        const params = new URLSearchParams();
        params.set("limit", "1000");
        if (input.file_pattern) params.set("pattern", input.file_pattern);

        const listResult = await apiRequest<FileListResponse>(
          "GET",
          `${buildProjectApiPath(input.source_project, "files")}?${params.toString()}`,
        );

        if (!listResult.ok) {
          return {
            success: false,
            error: `Project created but failed to list source files: ${listResult.error}`,
            project: newProject,
          };
        }

        const sourceFiles = listResult.data?.data ?? [];
        let filesCopied = 0;
        const errors: string[] = [];

        for (const file of sourceFiles) {
          const getResult = await apiRequest<RemoteFile>(
            "GET",
            buildProjectFilePath(input.source_project, file.path),
          );

          if (!getResult.ok || !getResult.data) {
            errors.push(`Failed to read ${file.path}`);
            continue;
          }

          const createFileResult = await apiRequest<{ id: string; path: string }>(
            "PUT",
            buildProjectFilePath(createResult.slug, file.path),
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
          error: errors.length ? errors.join("; ") : undefined,
        };
      },
      { "tool.source_project": input.source_project, "tool.target_slug": input.target_slug },
    ),
};

// ============================================================================
// All Remote File Tools
// ============================================================================

export const remoteFileTools: MCPTool[] = [
  vfRemoteCreateProject,
  vfRemoteCloneProject,
  vfRemoteListFiles,
  vfRemoteGetFile,
  vfRemoteUpdateFile,
  vfRemoteDeleteFile,
  vfRemoteSearchFiles,
  vfRemoteMoveFile,
  vfRemoteListBranches,
  vfRemoteCreateBranch,
  vfRemoteMergeBranch,
  vfRemoteDeleteBranch,
];
