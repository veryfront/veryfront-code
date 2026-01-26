import { z } from "zod";
import type { MCPTool } from "./tools.js";
interface SearchResult {
    id?: string;
    path: string;
    matches: Array<{
        line: number;
        content: string;
    }>;
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
declare const remoteListFilesInput: z.ZodObject<{
    project: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
    pattern: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    project: string;
    limit: number;
    pattern?: string | undefined;
    branch?: string | undefined;
}, {
    project: string;
    limit?: number | undefined;
    pattern?: string | undefined;
    branch?: string | undefined;
}>;
type RemoteListFilesInput = z.infer<typeof remoteListFilesInput>;
interface RemoteListFilesOutput {
    success: boolean;
    files?: Array<{
        path: string;
        type: string;
        size: number;
    }>;
    error?: string;
    total?: number;
}
export declare const vfRemoteListFiles: MCPTool<RemoteListFilesInput, RemoteListFilesOutput>;
declare const remoteGetFileInput: z.ZodObject<{
    project: z.ZodString;
    path: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    path: string;
    project: string;
    branch?: string | undefined;
}, {
    path: string;
    project: string;
    branch?: string | undefined;
}>;
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
export declare const vfRemoteGetFile: MCPTool<RemoteGetFileInput, RemoteGetFileOutput>;
declare const remoteUpdateFileInput: z.ZodObject<{
    project: z.ZodString;
    path: z.ZodString;
    content: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    path: string;
    content: string;
    project: string;
    branch?: string | undefined;
}, {
    path: string;
    content: string;
    project: string;
    branch?: string | undefined;
}>;
type RemoteUpdateFileInput = z.infer<typeof remoteUpdateFileInput>;
interface RemoteUpdateFileOutput {
    success: boolean;
    path?: string;
    error?: string;
    created?: boolean;
}
export declare const vfRemoteUpdateFile: MCPTool<RemoteUpdateFileInput, RemoteUpdateFileOutput>;
declare const remoteDeleteFileInput: z.ZodObject<{
    project: z.ZodString;
    path: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    path: string;
    project: string;
    branch?: string | undefined;
}, {
    path: string;
    project: string;
    branch?: string | undefined;
}>;
type RemoteDeleteFileInput = z.infer<typeof remoteDeleteFileInput>;
interface RemoteDeleteFileOutput {
    success: boolean;
    error?: string;
}
export declare const vfRemoteDeleteFile: MCPTool<RemoteDeleteFileInput, RemoteDeleteFileOutput>;
declare const remoteSearchFilesInput: z.ZodObject<{
    project: z.ZodString;
    query: z.ZodString;
    pattern: z.ZodOptional<z.ZodString>;
    is_regex: z.ZodOptional<z.ZodBoolean>;
    case_sensitive: z.ZodOptional<z.ZodBoolean>;
    max_results: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    branch: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project: string;
    query: string;
    max_results: number;
    pattern?: string | undefined;
    branch?: string | undefined;
    is_regex?: boolean | undefined;
    case_sensitive?: boolean | undefined;
}, {
    project: string;
    query: string;
    pattern?: string | undefined;
    branch?: string | undefined;
    is_regex?: boolean | undefined;
    case_sensitive?: boolean | undefined;
    max_results?: number | undefined;
}>;
type RemoteSearchFilesInput = z.infer<typeof remoteSearchFilesInput>;
interface RemoteSearchFilesOutput {
    success: boolean;
    results?: SearchResult[];
    total_files?: number;
    error?: string;
}
export declare const vfRemoteSearchFiles: MCPTool<RemoteSearchFilesInput, RemoteSearchFilesOutput>;
declare const remoteMoveFileInput: z.ZodObject<{
    project: z.ZodString;
    source_path: z.ZodString;
    destination_path: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project: string;
    source_path: string;
    destination_path: string;
    branch?: string | undefined;
}, {
    project: string;
    source_path: string;
    destination_path: string;
    branch?: string | undefined;
}>;
type RemoteMoveFileInput = z.infer<typeof remoteMoveFileInput>;
interface RemoteMoveFileOutput {
    success: boolean;
    source_path?: string;
    destination_path?: string;
    error?: string;
}
export declare const vfRemoteMoveFile: MCPTool<RemoteMoveFileInput, RemoteMoveFileOutput>;
declare const remoteListBranchesInput: z.ZodObject<{
    project: z.ZodString;
    search: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<["active", "merged", "all"]>>>;
}, "strip", z.ZodTypeAny, {
    status: "all" | "active" | "merged";
    project: string;
    search?: string | undefined;
}, {
    project: string;
    status?: "all" | "active" | "merged" | undefined;
    search?: string | undefined;
}>;
type RemoteListBranchesInput = z.infer<typeof remoteListBranchesInput>;
interface RemoteListBranchesOutput {
    success: boolean;
    branches?: Branch[];
    error?: string;
}
export declare const vfRemoteListBranches: MCPTool<RemoteListBranchesInput, RemoteListBranchesOutput>;
declare const remoteCreateBranchInput: z.ZodObject<{
    project: z.ZodString;
    name: z.ZodString;
    base_branch_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    project: string;
    base_branch_id?: string | undefined;
}, {
    name: string;
    project: string;
    base_branch_id?: string | undefined;
}>;
type RemoteCreateBranchInput = z.infer<typeof remoteCreateBranchInput>;
interface RemoteCreateBranchOutput {
    success: boolean;
    branch?: Branch;
    error?: string;
}
export declare const vfRemoteCreateBranch: MCPTool<RemoteCreateBranchInput, RemoteCreateBranchOutput>;
declare const remoteMergeBranchInput: z.ZodObject<{
    project: z.ZodString;
    branch_id: z.ZodString;
    target_branch_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    branch_id: string;
    project: string;
    target_branch_id?: string | undefined;
}, {
    branch_id: string;
    project: string;
    target_branch_id?: string | undefined;
}>;
type RemoteMergeBranchInput = z.infer<typeof remoteMergeBranchInput>;
interface RemoteMergeBranchOutput {
    success: boolean;
    branch?: Branch;
    merged_documents?: number;
    added_documents?: number;
    deleted_documents?: number;
    error?: string;
}
export declare const vfRemoteMergeBranch: MCPTool<RemoteMergeBranchInput, RemoteMergeBranchOutput>;
declare const remoteDeleteBranchInput: z.ZodObject<{
    project: z.ZodString;
    branch_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    branch_id: string;
    project: string;
}, {
    branch_id: string;
    project: string;
}>;
type RemoteDeleteBranchInput = z.infer<typeof remoteDeleteBranchInput>;
interface RemoteDeleteBranchOutput {
    success: boolean;
    error?: string;
}
export declare const vfRemoteDeleteBranch: MCPTool<RemoteDeleteBranchInput, RemoteDeleteBranchOutput>;
declare const remoteCreateProjectInput: z.ZodObject<{
    name: z.ZodString;
    slug: z.ZodString;
    template: z.ZodOptional<z.ZodString>;
    is_public: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    slug: string;
    template?: string | undefined;
    is_public?: boolean | undefined;
}, {
    name: string;
    slug: string;
    template?: string | undefined;
    is_public?: boolean | undefined;
}>;
type RemoteCreateProjectInput = z.infer<typeof remoteCreateProjectInput>;
interface RemoteCreateProjectOutput {
    success: boolean;
    project?: Project;
    error?: string;
}
export declare const vfRemoteCreateProject: MCPTool<RemoteCreateProjectInput, RemoteCreateProjectOutput>;
declare const remoteCloneProjectInput: z.ZodObject<{
    source_project: z.ZodString;
    target_name: z.ZodString;
    target_slug: z.ZodString;
    file_pattern: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    source_project: string;
    target_name: string;
    target_slug: string;
    file_pattern?: string | undefined;
}, {
    source_project: string;
    target_name: string;
    target_slug: string;
    file_pattern?: string | undefined;
}>;
type RemoteCloneProjectInput = z.infer<typeof remoteCloneProjectInput>;
interface RemoteCloneProjectOutput {
    success: boolean;
    project?: Project;
    files_copied?: number;
    error?: string;
}
export declare const vfRemoteCloneProject: MCPTool<RemoteCloneProjectInput, RemoteCloneProjectOutput>;
export declare const remoteFileTools: MCPTool[];
export {};
//# sourceMappingURL=remote-file-tools.d.ts.map