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
import * as dntShim from "../../../_dnt.shims.js";
import { z } from "zod";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
// ============================================================================
// Configuration
// ============================================================================
const DEFAULT_API_URL = "http://api.lvh.me:4000";
function getApiBaseUrl() {
    return getRuntimeEnv().apiBaseUrl || DEFAULT_API_URL;
}
function getApiToken() {
    return getRuntimeEnv().apiToken;
}
/**
 * Make an authenticated request to the Veryfront API
 */
async function apiRequest(method, path, options = {}) {
    const token = options.token ?? getApiToken();
    if (!token) {
        return { ok: false, error: "No API token available. Set VERYFRONT_API_TOKEN.", status: 401 };
    }
    const url = `${getApiBaseUrl()}/api${path}`;
    try {
        const response = await dntShim.fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || errorText;
            }
            catch {
                errorMessage = errorText || `HTTP ${response.status}`;
            }
            return { ok: false, error: errorMessage, status: response.status };
        }
        if (response.status === 204) {
            return { ok: true, status: 204 };
        }
        const data = (await response.json());
        return { ok: true, data, status: response.status };
    }
    catch (error) {
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
function encodeFilePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
}
// ============================================================================
// Tool: vf_remote_list_files
// ============================================================================
const remoteListFilesInput = z.object({
    project: z.string().describe("Project slug or ID"),
    branch: z.string().optional().describe("Branch name (omit for main branch)"),
    pattern: z.string().optional().describe("File pattern filter (e.g., *.tsx, pages/*)"),
    limit: z.number().optional().default(50).describe("Maximum number of files to return (default: 50)"),
});
export const vfRemoteListFiles = {
    name: "vf_remote_list_files",
    description: "List files in a remote Veryfront project. Returns file paths, types, and sizes. Use this to explore a project's structure.",
    inputSchema: remoteListFilesInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_remote_list_files", async () => {
        const params = new URLSearchParams();
        if (input.pattern)
            params.set("pattern", input.pattern);
        params.set("limit", String(input.limit));
        params.set("fields", "(path,type,size)"); // Only fetch necessary fields
        const branchPath = input.branch ? `/branches/${input.branch}` : "";
        const path = `/${input.project}${branchPath}/files?${params.toString()}`;
        const result = await apiRequest("GET", path);
        if (!result.ok)
            return { success: false, error: result.error };
        const files = result.data?.data ?? [];
        return {
            success: true,
            files: files.map((f) => ({ path: f.path, type: f.type, size: f.size })),
            total: files.length,
        };
    }, { "tool.project": input.project }),
};
// ============================================================================
// Tool: vf_remote_get_file
// ============================================================================
const remoteGetFileInput = z.object({
    project: z.string().describe("Project slug or ID"),
    path: z.string().describe("File path (e.g., pages/index.mdx, app/page.tsx)"),
    branch: z.string().optional().describe("Branch name (omit for main branch)"),
});
export const vfRemoteGetFile = {
    name: "vf_remote_get_file",
    description: "Read the content of a file from a remote Veryfront project. Always use this before modifying a file.",
    inputSchema: remoteGetFileInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_remote_get_file", async () => {
        const encodedPath = encodeFilePath(input.path);
        const branchPath = input.branch ? `/branches/${input.branch}` : "";
        const apiPath = `/${input.project}${branchPath}/files/${encodedPath}`;
        const result = await apiRequest("GET", apiPath);
        if (!result.ok)
            return { success: false, error: result.error };
        const file = result.data;
        if (!file)
            return { success: false, error: "File not found" };
        return {
            success: true,
            file: { path: file.path, content: file.content, size: file.size, type: file.type },
        };
    }, { "tool.project": input.project, "tool.path": input.path }),
};
// ============================================================================
// Tool: vf_remote_update_file
// ============================================================================
const remoteUpdateFileInput = z.object({
    project: z.string().describe("Project slug or ID"),
    path: z.string().describe("File path (e.g., pages/index.mdx)"),
    content: z.string().describe("New file content"),
    branch: z.string().optional().describe("Branch name (omit for main branch)"),
});
export const vfRemoteUpdateFile = {
    name: "vf_remote_update_file",
    description: "Create or update a file in a remote Veryfront project. Always read the file first before updating to understand its current state.",
    inputSchema: remoteUpdateFileInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_remote_update_file", async () => {
        const encodedPath = encodeFilePath(input.path);
        const branchParam = input.branch ? `?branch_id=${input.branch}` : "";
        const apiPath = `/${input.project}/files/${encodedPath}${branchParam}`;
        const result = await apiRequest("PUT", apiPath, {
            body: { content: input.content },
        });
        if (!result.ok)
            return { success: false, error: result.error };
        return {
            success: true,
            path: result.data?.path ?? input.path,
            created: result.status === 201,
        };
    }, { "tool.project": input.project, "tool.path": input.path }),
};
// ============================================================================
// Tool: vf_remote_delete_file
// ============================================================================
const remoteDeleteFileInput = z.object({
    project: z.string().describe("Project slug or ID"),
    path: z.string().describe("File path to delete"),
    branch: z.string().optional().describe("Branch name (omit for main branch)"),
});
export const vfRemoteDeleteFile = {
    name: "vf_remote_delete_file",
    description: "Delete a file from a remote Veryfront project.",
    inputSchema: remoteDeleteFileInput,
    execute: async (input) => {
        const encodedPath = encodeFilePath(input.path);
        const branchParam = input.branch ? `?branch_id=${input.branch}` : "";
        const apiPath = `/${input.project}/files/${encodedPath}${branchParam}`;
        const result = await apiRequest("DELETE", apiPath);
        if (!result.ok)
            return { success: false, error: result.error };
        return { success: true };
    },
};
// ============================================================================
// Tool: vf_remote_search_files
// ============================================================================
const remoteSearchFilesInput = z.object({
    project: z.string().describe("Project slug or ID"),
    query: z.string().describe("Search query (text or regex pattern)"),
    pattern: z.string().optional().describe("File pattern filter (e.g., *.tsx)"),
    is_regex: z.boolean().optional().describe("Treat query as regex (default: false)"),
    case_sensitive: z.boolean().optional().describe("Case sensitive search (default: false)"),
    max_results: z.number().optional().default(50).describe("Maximum results (default: 50)"),
    branch: z.string().optional().describe("Branch name (omit for main branch)"),
});
export const vfRemoteSearchFiles = {
    name: "vf_remote_search_files",
    description: "Search for text patterns within file contents in a remote Veryfront project. Supports regex and glob patterns.",
    inputSchema: remoteSearchFilesInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_remote_search_files", async () => {
        const branchPath = input.branch ? `/branches/${input.branch}` : "";
        const apiPath = `/${input.project}${branchPath}/files/search`;
        const result = await apiRequest("POST", apiPath, {
            body: {
                query: input.query,
                pattern: input.pattern,
                is_regex: input.is_regex,
                case_sensitive: input.case_sensitive,
                max_results: input.max_results,
            },
        });
        if (!result.ok)
            return { success: false, error: result.error };
        return {
            success: true,
            results: result.data?.results ?? [],
            total_files: result.data?.total_files ?? 0,
        };
    }, { "tool.project": input.project, "tool.query": input.query }),
};
// ============================================================================
// Tool: vf_remote_move_file
// ============================================================================
const remoteMoveFileInput = z.object({
    project: z.string().describe("Project slug or ID"),
    source_path: z.string().describe("Current file path"),
    destination_path: z.string().describe("New file path"),
    branch: z.string().optional().describe("Branch name (omit for main branch)"),
});
export const vfRemoteMoveFile = {
    name: "vf_remote_move_file",
    description: "Move or rename a file in a remote Veryfront project.",
    inputSchema: remoteMoveFileInput,
    execute: async (input) => {
        const branchParam = input.branch ? `?branch_id=${input.branch}` : "";
        const apiPath = `/${input.project}/files/move${branchParam}`;
        const result = await apiRequest("POST", apiPath, {
            body: {
                source_path: input.source_path,
                destination_path: input.destination_path,
            },
        });
        if (!result.ok)
            return { success: false, error: result.error };
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
const remoteListBranchesInput = z.object({
    project: z.string().describe("Project slug or ID"),
    search: z.string().optional().describe("Search filter for branch name"),
    status: z.enum(["active", "merged", "all"]).optional().default("all").describe("Filter by branch status (default: all)"),
});
export const vfRemoteListBranches = {
    name: "vf_remote_list_branches",
    description: "List branches in a remote Veryfront project.",
    inputSchema: remoteListBranchesInput,
    execute: async (input) => {
        const params = new URLSearchParams();
        if (input.search)
            params.set("search", input.search);
        if (input.status)
            params.set("status", input.status);
        const path = `/${input.project}/branches?${params.toString()}`;
        const result = await apiRequest("GET", path);
        if (!result.ok)
            return { success: false, error: result.error };
        return { success: true, branches: result.data?.data ?? [] };
    },
};
// ============================================================================
// Tool: vf_remote_create_branch
// ============================================================================
const remoteCreateBranchInput = z.object({
    project: z.string().describe("Project slug or ID"),
    name: z.string().describe("Branch name"),
    base_branch_id: z.string().optional().describe("Base branch ID to create from (omit for main branch)"),
});
export const vfRemoteCreateBranch = {
    name: "vf_remote_create_branch",
    description: "Create a new branch in a remote Veryfront project. Branch from main by default, or specify a base branch.",
    inputSchema: remoteCreateBranchInput,
    execute: async (input) => {
        const path = `/${input.project}/branches`;
        const result = await apiRequest("POST", path, {
            body: { name: input.name, base_branch_id: input.base_branch_id || null },
        });
        if (!result.ok)
            return { success: false, error: result.error };
        return { success: true, branch: result.data };
    },
};
// ============================================================================
// Tool: vf_remote_merge_branch
// ============================================================================
const remoteMergeBranchInput = z.object({
    project: z.string().describe("Project slug or ID"),
    branch_id: z.string().describe("Branch ID to merge"),
    target_branch_id: z.string().optional().describe("Target branch ID to merge into (omit to merge into main)"),
});
export const vfRemoteMergeBranch = {
    name: "vf_remote_merge_branch",
    description: "Merge a branch into the target branch (or main if not specified).",
    inputSchema: remoteMergeBranchInput,
    execute: async (input) => {
        const path = `/${input.project}/branches/${input.branch_id}/merge`;
        const result = await apiRequest("POST", path, {
            body: { target_branch_id: input.target_branch_id || null },
        });
        if (!result.ok)
            return { success: false, error: result.error };
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
    project: z.string().describe("Project slug or ID"),
    branch_id: z.string().describe("Branch ID to delete"),
});
export const vfRemoteDeleteBranch = {
    name: "vf_remote_delete_branch",
    description: "Delete a branch from a remote Veryfront project.",
    inputSchema: remoteDeleteBranchInput,
    execute: async (input) => {
        const path = `/${input.project}/branches/${input.branch_id}`;
        const result = await apiRequest("DELETE", path);
        if (!result.ok)
            return { success: false, error: result.error };
        return { success: true };
    },
};
// ============================================================================
// Tool: vf_remote_create_project
// ============================================================================
const remoteCreateProjectInput = z.object({
    name: z.string().describe("Project name"),
    slug: z.string().describe("Project slug (lowercase letters, numbers, hyphens only)"),
    template: z.string().optional().describe("Template to use (e.g., 'blank', 'blog', 'docs')"),
    is_public: z.boolean().optional().describe("Whether the project is public (default: false)"),
});
export const vfRemoteCreateProject = {
    name: "vf_remote_create_project",
    description: "Create a new Veryfront project. Returns the project details including ID and slug.",
    inputSchema: remoteCreateProjectInput,
    execute: async (input) => {
        const result = await apiRequest("POST", "/projects", {
            body: {
                name: input.name,
                slug: input.slug,
                template: input.template,
                isPublic: input.is_public,
            },
        });
        if (!result.ok)
            return { success: false, error: result.error };
        return { success: true, project: result.data };
    },
};
// ============================================================================
// Tool: vf_remote_clone_project
// ============================================================================
const remoteCloneProjectInput = z.object({
    source_project: z.string().describe("Source project slug or ID to clone from"),
    target_name: z.string().describe("Name for the new project"),
    target_slug: z.string().describe("Slug for the new project (lowercase letters, numbers, hyphens only)"),
    file_pattern: z.string().optional().describe("Optional file pattern to filter which files to clone (e.g., '*.tsx')"),
});
export const vfRemoteCloneProject = {
    name: "vf_remote_clone_project",
    description: "Clone a Veryfront project by creating a new project and copying all files from the source.",
    inputSchema: remoteCloneProjectInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_remote_clone_project", async () => {
        const createResult = await apiRequest("POST", "/projects", {
            body: { name: input.target_name, slug: input.target_slug },
        });
        if (!createResult.ok) {
            return { success: false, error: `Failed to create project: ${createResult.error}` };
        }
        const newProject = createResult.data;
        if (!newProject) {
            return { success: false, error: "Project created but no data returned" };
        }
        const params = new URLSearchParams();
        params.set("limit", "1000");
        if (input.file_pattern)
            params.set("pattern", input.file_pattern);
        const listResult = await apiRequest("GET", `/${input.source_project}/files?${params.toString()}`);
        if (!listResult.ok) {
            return {
                success: false,
                error: `Project created but failed to list source files: ${listResult.error}`,
                project: newProject,
            };
        }
        const sourceFiles = listResult.data?.data ?? [];
        let filesCopied = 0;
        const errors = [];
        for (const file of sourceFiles) {
            const getResult = await apiRequest("GET", `/${input.source_project}/files/${encodeFilePath(file.path)}`);
            if (!getResult.ok || !getResult.data) {
                errors.push(`Failed to read ${file.path}`);
                continue;
            }
            const createFileResult = await apiRequest("PUT", `/${input.target_slug}/files/${encodeFilePath(file.path)}`, { body: { content: getResult.data.content } });
            if (createFileResult.ok) {
                filesCopied++;
            }
            else {
                errors.push(`Failed to create ${file.path}: ${createFileResult.error}`);
            }
        }
        return {
            success: errors.length === 0,
            project: newProject,
            files_copied: filesCopied,
            error: errors.length ? errors.join("; ") : undefined,
        };
    }, { "tool.source_project": input.source_project, "tool.target_slug": input.target_slug }),
};
// ============================================================================
// All Remote File Tools
// ============================================================================
export const remoteFileTools = [
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
